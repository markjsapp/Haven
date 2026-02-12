use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::db::queries;
use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::*;
use crate::permissions;
use crate::AppState;

/// POST /api/v1/servers/:server_id/bans/:target_user_id
/// Ban a member from the server. Also kicks them if they are a member.
pub async fn ban_member(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path((server_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateBanRequest>,
) -> AppResult<Json<BanResponse>> {
    queries::require_server_permission(
        &state.db,
        server_id,
        user_id,
        permissions::BAN_MEMBERS,
    )
    .await?;

    if target_user_id == user_id {
        return Err(AppError::Validation("Cannot ban yourself".into()));
    }

    // Create the ban record
    let ban = queries::create_ban(
        &state.db,
        server_id,
        target_user_id,
        body.reason.as_deref(),
        user_id,
    )
    .await?;

    // Also kick them from the server if they are a member
    let _ = queries::remove_server_member(&state.db, server_id, target_user_id).await;

    // Look up username for response
    let target = queries::find_user_by_id(&state.db, target_user_id)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    Ok(Json(BanResponse {
        id: ban.id,
        user_id: ban.user_id,
        username: target.username,
        reason: ban.reason,
        banned_by: ban.banned_by,
        created_at: ban.created_at.to_rfc3339(),
    }))
}

/// DELETE /api/v1/servers/:server_id/bans/:target_user_id
/// Revoke a ban.
pub async fn revoke_ban(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path((server_id, target_user_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    queries::require_server_permission(
        &state.db,
        server_id,
        user_id,
        permissions::BAN_MEMBERS,
    )
    .await?;

    queries::remove_ban(&state.db, server_id, target_user_id).await?;

    Ok(Json(serde_json::json!({ "unbanned": true })))
}

/// GET /api/v1/servers/:server_id/bans
/// List all bans for a server.
pub async fn list_bans(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<BanResponse>>> {
    queries::require_server_permission(
        &state.db,
        server_id,
        user_id,
        permissions::BAN_MEMBERS,
    )
    .await?;

    let bans = queries::list_bans(&state.db, server_id).await?;
    Ok(Json(bans))
}
