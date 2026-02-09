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

/// GET /api/v1/users/:user_id/keys
/// Fetch a user's key bundle for establishing an E2EE session (X3DH).
/// Consumes one one-time prekey atomically.
pub async fn get_key_bundle(
    State(state): State<AppState>,
    AuthUser(_requester_id): AuthUser,
    Path(user_id): Path<Uuid>,
) -> AppResult<Json<KeyBundle>> {
    // Fetch the target user
    let user = queries::find_user_by_id(&state.db, user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    // Try to consume a one-time prekey
    let one_time_prekey = queries::consume_prekey(&state.db, user_id).await?;

    let bundle = KeyBundle {
        identity_key: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &user.identity_key,
        ),
        signed_prekey: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &user.signed_prekey,
        ),
        signed_prekey_sig: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &user.signed_prekey_sig,
        ),
        one_time_prekey: one_time_prekey.map(|pk| {
            base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &pk.public_key,
            )
        }),
    };

    // Log a warning if prekeys are running low
    if let Ok(remaining) = queries::count_unused_prekeys(&state.db, user_id).await {
        if remaining < 10 {
            tracing::warn!(
                "User {} has only {} prekeys remaining. Client should replenish.",
                user_id,
                remaining
            );
        }
    }

    Ok(Json(bundle))
}

/// POST /api/v1/keys/prekeys
/// Upload new one-time prekeys (clients should call this when running low).
pub async fn upload_prekeys(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(req): Json<UploadPreKeysRequest>,
) -> AppResult<Json<serde_json::Value>> {
    if req.prekeys.is_empty() {
        return Err(AppError::Validation("No prekeys provided".into()));
    }

    if req.prekeys.len() > 100 {
        return Err(AppError::Validation("Maximum 100 prekeys per upload".into()));
    }

    // Get current max key_id for this user to continue the sequence
    let current_count = queries::count_unused_prekeys(&state.db, user_id).await?;
    let start_id = current_count as i32;

    let prekeys: Result<Vec<(i32, Vec<u8>)>, _> = req
        .prekeys
        .iter()
        .enumerate()
        .map(|(i, key_b64)| {
            base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                key_b64,
            )
            .map(|bytes| (start_id + i as i32, bytes))
            .map_err(|_| AppError::Validation(format!("Invalid prekey encoding at index {}", i)))
        })
        .collect();

    queries::insert_prekeys(&state.db, user_id, &prekeys?).await?;

    let total = queries::count_unused_prekeys(&state.db, user_id).await?;

    Ok(Json(serde_json::json!({
        "message": "Prekeys uploaded",
        "total_available": total,
    })))
}

/// GET /api/v1/keys/prekeys/count
/// Check how many unused prekeys the authenticated user has remaining.
pub async fn prekey_count(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    let count = queries::count_unused_prekeys(&state.db, user_id).await?;

    Ok(Json(serde_json::json!({
        "count": count,
        "needs_replenishment": count < 20,
    })))
}
