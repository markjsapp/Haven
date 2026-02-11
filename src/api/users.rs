use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::db::queries;
use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::*;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct UserSearchQuery {
    pub username: String,
}

/// GET /api/v1/users/search?username=Mork
pub async fn get_user_by_username(
    State(state): State<AppState>,
    AuthUser(_user_id): AuthUser,
    Query(query): Query<UserSearchQuery>,
) -> AppResult<Json<UserPublic>> {
    let user = queries::find_user_by_username(&state.db, &query.username).await?;
    let user = user.ok_or(AppError::UserNotFound)?;
    Ok(Json(UserPublic::from(user)))
}

/// GET /api/v1/users/:user_id/profile
pub async fn get_profile(
    State(state): State<AppState>,
    AuthUser(requester_id): AuthUser,
    Path(user_id): Path<Uuid>,
) -> AppResult<Json<UserProfileResponse>> {
    let user = queries::find_user_by_id(&state.db, user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    let is_blocked = queries::is_blocked(&state.db, requester_id, user_id).await?;

    Ok(Json(UserProfileResponse {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        about_me: user.about_me,
        avatar_url: user.avatar_url,
        custom_status: user.custom_status,
        custom_status_emoji: user.custom_status_emoji,
        created_at: user.created_at,
        is_blocked,
    }))
}

/// PUT /api/v1/users/profile
pub async fn update_profile(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(req): Json<UpdateProfileRequest>,
) -> AppResult<Json<UserPublic>> {
    let user = queries::update_user_profile(
        &state.db,
        user_id,
        req.display_name.as_deref(),
        req.about_me.as_deref(),
        req.custom_status.as_deref(),
        req.custom_status_emoji.as_deref(),
    )
    .await?;

    Ok(Json(UserPublic::from(user)))
}

/// POST /api/v1/users/:user_id/block
pub async fn block_user(
    State(state): State<AppState>,
    AuthUser(blocker_id): AuthUser,
    Path(blocked_id): Path<Uuid>,
) -> AppResult<Json<()>> {
    if blocker_id == blocked_id {
        return Err(AppError::Validation("Cannot block yourself".into()));
    }

    // Verify target user exists
    queries::find_user_by_id(&state.db, blocked_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    queries::block_user(&state.db, blocker_id, blocked_id).await?;
    Ok(Json(()))
}

/// DELETE /api/v1/users/:user_id/block
pub async fn unblock_user(
    State(state): State<AppState>,
    AuthUser(blocker_id): AuthUser,
    Path(blocked_id): Path<Uuid>,
) -> AppResult<Json<()>> {
    queries::unblock_user(&state.db, blocker_id, blocked_id).await?;
    Ok(Json(()))
}

/// GET /api/v1/users/blocked
pub async fn get_blocked_users(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<Vec<BlockedUserResponse>>> {
    let blocked = queries::get_blocked_users(&state.db, user_id).await?;
    Ok(Json(blocked))
}
