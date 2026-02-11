use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::db::queries;
use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::*;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct MessageQuery {
    pub before: Option<DateTime<Utc>>,
    pub limit: Option<i64>,
}

/// GET /api/v1/channels/:channel_id/messages
/// Paginated message history (encrypted blobs).
pub async fn get_messages(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(params): Query<MessageQuery>,
) -> AppResult<Json<Vec<MessageResponse>>> {
    // Verify membership
    if !queries::is_channel_member(&state.db, channel_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    let limit = params.limit.unwrap_or(50).min(100); // Cap at 100

    let messages =
        queries::get_channel_messages(&state.db, channel_id, params.before, limit).await?;

    let responses: Vec<MessageResponse> = messages.into_iter().map(|m| m.into()).collect();

    Ok(Json(responses))
}

/// GET /api/v1/channels/:channel_id/reactions
/// Returns grouped reactions for the most recent messages in a channel.
pub async fn get_channel_reactions(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Vec<ReactionGroup>>> {
    // Verify membership
    if !queries::is_channel_member(&state.db, channel_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    // Get recent message IDs for this channel
    let messages = queries::get_channel_messages(&state.db, channel_id, None, 50).await?;
    let message_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();

    let reactions = queries::get_reactions_for_messages(&state.db, &message_ids).await?;

    // Group by (message_id, emoji)
    let mut groups: std::collections::HashMap<(Uuid, String), Vec<Uuid>> = std::collections::HashMap::new();
    for r in &reactions {
        groups
            .entry((r.message_id, r.emoji.clone()))
            .or_default()
            .push(r.user_id);
    }

    // Flatten into a response format that includes message_id
    let result: Vec<ReactionGroup> = groups
        .into_iter()
        .map(|((message_id, emoji), user_ids)| ReactionGroup {
            message_id,
            emoji,
            count: user_ids.len() as i64,
            user_ids,
        })
        .collect();

    Ok(Json(result))
}

/// POST /api/v1/channels/:channel_id/messages
/// REST fallback for sending messages (primary path is WebSocket).
pub async fn send_message(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<SendMessageRequest>,
) -> AppResult<Json<MessageResponse>> {
    // Verify membership
    if !queries::is_channel_member(&state.db, channel_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    let sender_token = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.sender_token,
    )
    .map_err(|_| AppError::Validation("Invalid sender_token encoding".into()))?;

    let encrypted_body = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.encrypted_body,
    )
    .map_err(|_| AppError::Validation("Invalid encrypted_body encoding".into()))?;

    let message = queries::insert_message(
        &state.db,
        channel_id,
        &sender_token,
        &encrypted_body,
        req.expires_at,
        req.has_attachments,
        user_id,
    )
    .await?;

    let response: MessageResponse = message.into();

    // Fan out via WebSocket to channel members
    if let Ok(member_ids) = queries::get_channel_member_ids(&state.db, channel_id).await {
        for member_id in member_ids {
            if let Some(conns) = state.connections.get(&member_id) {
                for sender in conns.iter() {
                    let _ = sender.send(WsServerMessage::NewMessage(response.clone()));
                }
            }
        }
    }

    Ok(Json(response))
}
