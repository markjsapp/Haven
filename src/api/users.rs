use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;

use crate::db::queries;
use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::UserPublic;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct UserSearchQuery {
    pub username: String,
}

/// GET /api/v1/users/search?username=Mork
/// Look up a user by their username. Requires authentication.
pub async fn get_user_by_username(
    State(state): State<AppState>,
    AuthUser(_user_id): AuthUser,
    Query(query): Query<UserSearchQuery>,
) -> AppResult<Json<UserPublic>> {
    tracing::info!("get_user_by_username called with username={:?}", query.username);

    let user = queries::find_user_by_username(&state.db, &query.username).await?;
    tracing::info!("find_user_by_username result: {:?}", user.as_ref().map(|u| &u.username));

    let user = user.ok_or(AppError::UserNotFound)?;
    Ok(Json(UserPublic::from(user)))
}
