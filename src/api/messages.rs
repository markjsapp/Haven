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
