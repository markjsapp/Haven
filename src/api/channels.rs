use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::db::queries;
use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::*;
use crate::AppState;

/// POST /api/v1/servers/:server_id/channels
pub async fn create_channel(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateChannelRequest>,
) -> AppResult<Json<ChannelResponse>> {
    // Verify user is a server member (ideally check admin/owner role)
    if !queries::is_server_member(&state.db, server_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    let encrypted_meta = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.encrypted_meta,
    )
    .map_err(|_| AppError::Validation("Invalid encrypted_meta encoding".into()))?;

    let channel_type = req.channel_type.as_deref().unwrap_or("text");
    let position = req.position.unwrap_or(0);

    let channel = queries::create_channel(
        &state.db,
        Some(server_id),
        &encrypted_meta,
        channel_type,
        position,
    )
    .await?;

    // Add creator to the channel
    queries::add_channel_member(&state.db, channel.id, user_id).await?;

    Ok(Json(ChannelResponse {
        id: channel.id,
        server_id: channel.server_id,
        encrypted_meta: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &channel.encrypted_meta,
        ),
        channel_type: channel.channel_type,
        position: channel.position,
        created_at: channel.created_at,
    }))
}

/// POST /api/v1/channels/:channel_id/join
pub async fn join_channel(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    // Verify the channel exists
    let channel = queries::find_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(AppError::NotFound("Channel not found".into()))?;

    // If the channel belongs to a server, verify server membership
    if let Some(server_id) = channel.server_id {
        if !queries::is_server_member(&state.db, server_id, user_id).await? {
            return Err(AppError::Forbidden("Not a member of the server".into()));
        }
    }

    queries::add_channel_member(&state.db, channel_id, user_id).await?;

    Ok(Json(serde_json::json!({ "message": "Joined channel" })))
}

/// POST /api/v1/dm
/// Create a DM channel between two users, or return existing one.
pub async fn create_dm(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(req): Json<CreateDmRequest>,
) -> AppResult<Json<ChannelResponse>> {
    // Verify target user exists
    let _target = queries::find_user_by_id(&state.db, req.target_user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    // Check for existing DM channel between these two users
    if let Some(existing) = queries::find_dm_channel(&state.db, user_id, req.target_user_id).await? {
        return Ok(Json(ChannelResponse {
            id: existing.id,
            server_id: None,
            encrypted_meta: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &existing.encrypted_meta,
            ),
            channel_type: existing.channel_type,
            position: existing.position,
            created_at: existing.created_at,
        }));
    }

    // Create a new DM channel (no server association)
    let encrypted_meta = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.encrypted_meta,
    )
    .map_err(|_| AppError::Validation("Invalid encrypted_meta encoding".into()))?;

    let channel = queries::create_channel(&state.db, None, &encrypted_meta, "dm", 0).await?;

    // Add both users
    queries::add_channel_member(&state.db, channel.id, user_id).await?;
    queries::add_channel_member(&state.db, channel.id, req.target_user_id).await?;

    Ok(Json(ChannelResponse {
        id: channel.id,
        server_id: None,
        encrypted_meta: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &channel.encrypted_meta,
        ),
        channel_type: channel.channel_type,
        position: channel.position,
        created_at: channel.created_at,
    }))
}

/// GET /api/v1/dm
/// List all DM channels for the authenticated user.
pub async fn list_dm_channels(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<Vec<ChannelResponse>>> {
    let channels = queries::get_user_dm_channels(&state.db, user_id).await?;
    let responses: Vec<ChannelResponse> = channels
        .into_iter()
        .map(|ch| ChannelResponse {
            id: ch.id,
            server_id: ch.server_id,
            encrypted_meta: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &ch.encrypted_meta,
            ),
            channel_type: ch.channel_type,
            position: ch.position,
            created_at: ch.created_at,
        })
        .collect();
    Ok(Json(responses))
}

/// Helper request type for DM creation.
#[derive(Debug, serde::Deserialize)]
pub struct CreateDmRequest {
    pub target_user_id: Uuid,
    pub encrypted_meta: String, // base64
}
