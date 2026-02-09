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

/// POST /api/v1/servers
pub async fn create_server(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(req): Json<CreateServerRequest>,
) -> AppResult<Json<ServerResponse>> {
    let encrypted_meta = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.encrypted_meta,
    )
    .map_err(|_| AppError::Validation("Invalid encrypted_meta encoding".into()))?;

    let server = queries::create_server(&state.db, user_id, &encrypted_meta).await?;

    // Add creator as owner member
    let owner_role = b"owner"; // In practice, this would be encrypted
    queries::add_server_member(&state.db, server.id, user_id, owner_role).await?;

    // Create a default "general" channel
    let default_channel_meta = b"general"; // Would be encrypted in practice
    let channel = queries::create_channel(
        &state.db,
        Some(server.id),
        default_channel_meta,
        "text",
        0,
    )
    .await?;

    // Add owner to the default channel
    queries::add_channel_member(&state.db, channel.id, user_id).await?;

    Ok(Json(ServerResponse {
        id: server.id,
        encrypted_meta: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &server.encrypted_meta,
        ),
        owner_id: server.owner_id,
        created_at: server.created_at,
    }))
}

/// GET /api/v1/servers/:server_id
pub async fn get_server(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<ServerResponse>> {
    // Verify membership
    if !queries::is_server_member(&state.db, server_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    let server = queries::find_server_by_id(&state.db, server_id)
        .await?
        .ok_or(AppError::NotFound("Server not found".into()))?;

    Ok(Json(ServerResponse {
        id: server.id,
        encrypted_meta: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &server.encrypted_meta,
        ),
        owner_id: server.owner_id,
        created_at: server.created_at,
    }))
}

/// GET /api/v1/servers
/// List servers the authenticated user is a member of.
pub async fn list_servers(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<Vec<ServerResponse>>> {
    let servers = queries::get_user_servers(&state.db, user_id).await?;

    let responses: Vec<ServerResponse> = servers
        .into_iter()
        .map(|s| ServerResponse {
            id: s.id,
            encrypted_meta: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &s.encrypted_meta,
            ),
            owner_id: s.owner_id,
            created_at: s.created_at,
        })
        .collect();

    Ok(Json(responses))
}

/// GET /api/v1/servers/:server_id/channels
pub async fn list_server_channels(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<ChannelResponse>>> {
    if !queries::is_server_member(&state.db, server_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    let channels = queries::get_server_channels(&state.db, server_id).await?;

    let responses: Vec<ChannelResponse> = channels
        .into_iter()
        .map(|c| ChannelResponse {
            id: c.id,
            server_id: c.server_id,
            encrypted_meta: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &c.encrypted_meta,
            ),
            channel_type: c.channel_type,
            position: c.position,
            created_at: c.created_at,
        })
        .collect();

    Ok(Json(responses))
}
