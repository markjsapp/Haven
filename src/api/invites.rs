use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;
use rand::Rng;
use uuid::Uuid;

use crate::db::queries;
use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::*;
use crate::permissions;
use crate::AppState;

/// POST /api/v1/servers/:server_id/invites
/// Create an invite code for a server (owner/admin only).
pub async fn create_invite(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateInviteRequest>,
) -> AppResult<Json<InviteResponse>> {
    queries::require_server_permission(
        &state.db,
        server_id,
        user_id,
        permissions::CREATE_INVITES,
    )
    .await?;

    // Generate a random 8-char invite code
    let code = generate_invite_code();

    let expires_at = req.expires_in_hours.map(|hours| {
        Utc::now() + chrono::Duration::hours(hours)
    });

    let invite = queries::create_invite(
        &state.db,
        server_id,
        user_id,
        &code,
        req.max_uses,
        expires_at,
    )
    .await?;

    Ok(Json(InviteResponse::from(invite)))
}

/// GET /api/v1/servers/:server_id/invites
/// List all invites for a server (owner/admin only).
pub async fn list_invites(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<InviteResponse>>> {
    queries::require_server_permission(
        &state.db,
        server_id,
        user_id,
        permissions::MANAGE_INVITES,
    )
    .await?;

    let invites = queries::get_server_invites(&state.db, server_id).await?;
    let responses: Vec<InviteResponse> = invites.into_iter().map(InviteResponse::from).collect();

    Ok(Json(responses))
}

/// DELETE /api/v1/servers/:server_id/invites/:invite_id
/// Revoke an invite (owner/admin only).
pub async fn delete_invite(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path((server_id, invite_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    queries::require_server_permission(
        &state.db,
        server_id,
        user_id,
        permissions::MANAGE_INVITES,
    )
    .await?;

    queries::delete_invite(&state.db, invite_id).await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// POST /api/v1/invites/:code/join
/// Join a server by invite code.
pub async fn join_by_invite(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(code): Path<String>,
) -> AppResult<Json<ServerResponse>> {
    // Find the invite
    let invite = queries::find_invite_by_code(&state.db, &code)
        .await?
        .ok_or(AppError::NotFound("Invalid invite code".into()))?;

    // Check expiry
    if let Some(expires_at) = invite.expires_at {
        if Utc::now() > expires_at {
            return Err(AppError::Validation("Invite has expired".into()));
        }
    }

    // Check max uses
    if let Some(max_uses) = invite.max_uses {
        if invite.use_count >= max_uses {
            return Err(AppError::Validation("Invite has reached max uses".into()));
        }
    }

    // Check if already a member
    if queries::is_server_member(&state.db, invite.server_id, user_id).await? {
        return Err(AppError::Validation("Already a member of this server".into()));
    }

    // Add user to the server
    let member_role = b"member";
    queries::add_server_member(&state.db, invite.server_id, user_id, member_role).await?;

    // Add user to all server channels
    let channels = queries::get_server_channels(&state.db, invite.server_id).await?;
    for channel in &channels {
        queries::add_channel_member(&state.db, channel.id, user_id).await?;
    }

    // Increment invite use count
    queries::increment_invite_uses(&state.db, invite.id).await?;

    // Return the server info
    let server = queries::find_server_by_id(&state.db, invite.server_id)
        .await?
        .ok_or(AppError::Internal(anyhow::anyhow!("Server not found after join")))?;

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

/// GET /api/v1/servers/:server_id/members
/// List members of a server.
pub async fn list_members(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<ServerMemberResponse>>> {
    if !queries::is_server_member(&state.db, server_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    let members = queries::get_server_members(&state.db, server_id).await?;
    Ok(Json(members))
}

/// DELETE /api/v1/servers/:server_id/members/:target_user_id
/// Kick a member from the server (owner only).
pub async fn kick_member(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path((server_id, target_user_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    queries::require_server_permission(
        &state.db,
        server_id,
        user_id,
        permissions::KICK_MEMBERS,
    )
    .await?;

    if target_user_id == user_id {
        return Err(AppError::Validation("Cannot kick yourself".into()));
    }

    queries::remove_server_member(&state.db, server_id, target_user_id).await?;

    Ok(Json(serde_json::json!({ "kicked": true })))
}

fn generate_invite_code() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}
