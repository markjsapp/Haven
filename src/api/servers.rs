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

    // Create @everyone default role
    queries::create_role(
        &state.db,
        server.id,
        "@everyone",
        None,
        crate::permissions::DEFAULT_PERMISSIONS,
        0,
        true,
    )
    .await?;

    // Create a default "general" channel
    let default_channel_meta = b"general"; // Would be encrypted in practice
    let channel = queries::create_channel(
        &state.db,
        Some(server.id),
        default_channel_meta,
        "text",
        0,
        None,
    )
    .await?;

    // Add owner to the default channel
    queries::add_channel_member(&state.db, channel.id, user_id).await?;

    // Set the default channel as system channel
    queries::update_system_channel(&state.db, server.id, Some(channel.id)).await?;

    // Owner always has all permissions
    Ok(Json(ServerResponse {
        id: server.id,
        encrypted_meta: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &server.encrypted_meta,
        ),
        owner_id: server.owner_id,
        created_at: server.created_at,
        my_permissions: Some(i64::MAX.to_string()),
        system_channel_id: Some(channel.id),
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

    let (_, perms) = queries::get_member_permissions(&state.db, server_id, user_id).await?;

    Ok(Json(ServerResponse {
        id: server.id,
        encrypted_meta: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &server.encrypted_meta,
        ),
        owner_id: server.owner_id,
        created_at: server.created_at,
        my_permissions: Some(perms.to_string()),
        system_channel_id: server.system_channel_id,
    }))
}

/// GET /api/v1/servers
/// List servers the authenticated user is a member of.
pub async fn list_servers(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<Vec<ServerResponse>>> {
    let servers = queries::get_user_servers(&state.db, user_id).await?;

    let mut responses = Vec::with_capacity(servers.len());
    for s in servers {
        let (_, perms) = queries::get_member_permissions(&state.db, s.id, user_id).await?;
        responses.push(ServerResponse {
            id: s.id,
            encrypted_meta: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &s.encrypted_meta,
            ),
            owner_id: s.owner_id,
            created_at: s.created_at,
            my_permissions: Some(perms.to_string()),
            system_channel_id: s.system_channel_id,
        });
    }

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
            category_id: c.category_id,
            dm_status: c.dm_status,
        })
        .collect();

    Ok(Json(responses))
}

/// GET /api/v1/servers/:server_id/members/@me/permissions
/// Get the current user's effective permissions for a server.
pub async fn get_my_permissions(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    if !queries::is_server_member(&state.db, server_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    let (is_owner, perms) = queries::get_member_permissions(&state.db, server_id, user_id).await?;

    Ok(Json(serde_json::json!({
        "permissions": perms.to_string(),
        "is_owner": is_owner,
    })))
}

/// PATCH /api/v1/servers/:server_id
/// Update server settings (system channel, etc.).
pub async fn update_server(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(server_id): Path<Uuid>,
    Json(req): Json<UpdateServerRequest>,
) -> AppResult<Json<serde_json::Value>> {
    if !queries::is_server_member(&state.db, server_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    // Require MANAGE_SERVER permission
    let (is_owner, perms) = queries::get_member_permissions(&state.db, server_id, user_id).await?;
    if !is_owner && !crate::permissions::has_permission(perms, crate::permissions::MANAGE_SERVER) {
        return Err(AppError::Forbidden("Missing MANAGE_SERVER permission".into()));
    }

    // Validate channel belongs to server if provided
    if let Some(channel_id) = req.system_channel_id {
        let channels = queries::get_server_channels(&state.db, server_id).await?;
        if !channels.iter().any(|c| c.id == channel_id) {
            return Err(AppError::Validation("Channel does not belong to this server".into()));
        }
    }

    queries::update_system_channel(&state.db, server_id, req.system_channel_id).await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// PUT /api/v1/servers/:server_id/nickname
/// Set or clear per-server nickname for the authenticated user.
pub async fn set_nickname(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(server_id): Path<Uuid>,
    Json(req): Json<UpdateNicknameRequest>,
) -> AppResult<Json<serde_json::Value>> {
    if !queries::is_server_member(&state.db, server_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    if let Some(ref nick) = req.nickname {
        if nick.len() > 32 || nick.trim().is_empty() {
            return Err(AppError::Validation("Nickname must be 1-32 characters".into()));
        }
    }

    queries::update_member_nickname(&state.db, server_id, user_id, req.nickname.as_deref()).await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
