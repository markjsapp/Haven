use axum::{extract::State, Json};
use chrono::{Duration, Utc};
use validator::Validate;

use crate::auth;
use crate::db::queries;
use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::*;
use crate::AppState;

/// POST /api/v1/auth/register
pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> AppResult<Json<AuthResponse>> {
    // Validate request
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    // Hash password
    let password_hash = auth::hash_password(&req.password)?;

    // Hash email if provided
    let email_hash = req.email.as_deref().map(auth::hash_email);

    // Decode crypto keys from base64
    let identity_key = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.identity_key,
    )
    .map_err(|_| AppError::Validation("Invalid identity_key encoding".into()))?;

    let signed_prekey = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.signed_prekey,
    )
    .map_err(|_| AppError::Validation("Invalid signed_prekey encoding".into()))?;

    let signed_prekey_sig = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.signed_prekey_signature,
    )
    .map_err(|_| AppError::Validation("Invalid signed_prekey_signature encoding".into()))?;

    // Create user
    let user = queries::create_user(
        &state.db,
        &req.username,
        req.display_name.as_deref(),
        email_hash.as_deref(),
        &password_hash,
        &identity_key,
        &signed_prekey,
        &signed_prekey_sig,
    )
    .await?;

    // Store one-time prekeys
    if !req.one_time_prekeys.is_empty() {
        let prekeys: Result<Vec<(i32, Vec<u8>)>, _> = req
            .one_time_prekeys
            .iter()
            .enumerate()
            .map(|(i, key_b64)| {
                base64::Engine::decode(
                    &base64::engine::general_purpose::STANDARD,
                    key_b64,
                )
                .map(|bytes| (i as i32, bytes))
                .map_err(|_| AppError::Validation(format!("Invalid prekey encoding at index {}", i)))
            })
            .collect();

        queries::insert_prekeys(&state.db, user.id, &prekeys?).await?;
    }

    // Generate tokens
    let access_token = auth::generate_access_token(user.id, &state.config)?;
    let refresh_token = auth::generate_refresh_token();
    let refresh_hash = auth::hash_refresh_token(&refresh_token);

    let expiry = Utc::now() + Duration::days(state.config.refresh_token_expiry_days);
    queries::store_refresh_token(&state.db, user.id, &refresh_hash, expiry).await?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user: user.into(),
    }))
}

/// POST /api/v1/auth/login
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    // Find user
    let user = queries::find_user_by_username(&state.db, &req.username)
        .await?
        .ok_or(AppError::AuthError("Invalid username or password".into()))?;

    // Verify password
    if !auth::verify_password(&req.password, &user.password_hash)? {
        return Err(AppError::AuthError("Invalid username or password".into()));
    }

    // Verify TOTP if enabled
    if let Some(ref secret) = user.totp_secret {
        let code = req
            .totp_code
            .as_deref()
            .ok_or(AppError::AuthError("TOTP code required".into()))?;
        if !auth::verify_totp(secret, code)? {
            return Err(AppError::AuthError("Invalid TOTP code".into()));
        }
    }

    // Generate tokens
    let access_token = auth::generate_access_token(user.id, &state.config)?;
    let refresh_token = auth::generate_refresh_token();
    let refresh_hash = auth::hash_refresh_token(&refresh_token);

    let expiry = Utc::now() + Duration::days(state.config.refresh_token_expiry_days);
    queries::store_refresh_token(&state.db, user.id, &refresh_hash, expiry).await?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user: user.into(),
    }))
}

/// POST /api/v1/auth/refresh
pub async fn refresh_token(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> AppResult<Json<AuthResponse>> {
    let token_hash = auth::hash_refresh_token(&req.refresh_token);

    // Find and validate refresh token
    let stored_token = queries::find_refresh_token(&state.db, &token_hash)
        .await?
        .ok_or(AppError::AuthError("Invalid or expired refresh token".into()))?;

    // Revoke old token (rotation)
    queries::revoke_refresh_token(&state.db, &token_hash).await?;

    // Get user
    let user = queries::find_user_by_id(&state.db, stored_token.user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    // Generate new token pair
    let access_token = auth::generate_access_token(user.id, &state.config)?;
    let new_refresh_token = auth::generate_refresh_token();
    let new_refresh_hash = auth::hash_refresh_token(&new_refresh_token);

    let expiry = Utc::now() + Duration::days(state.config.refresh_token_expiry_days);
    queries::store_refresh_token(&state.db, user.id, &new_refresh_hash, expiry).await?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token: new_refresh_token,
        user: user.into(),
    }))
}

/// POST /api/v1/auth/logout
pub async fn logout(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    // Revoke all refresh tokens for this user
    queries::revoke_all_user_refresh_tokens(&state.db, user_id).await?;

    Ok(Json(serde_json::json!({ "message": "Logged out" })))
}

/// POST /api/v1/auth/totp/setup
pub async fn totp_setup(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<TotpSetupResponse>> {
    let user = queries::find_user_by_id(&state.db, user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    if user.totp_secret.is_some() {
        return Err(AppError::BadRequest("TOTP already enabled".into()));
    }

    let (secret, uri) = auth::generate_totp_secret(&user.username)?;

    // Store secret temporarily (not confirmed yet — in a real app you'd use
    // a pending_totp field or a separate table until verified)
    queries::set_user_totp_secret(&state.db, user_id, &secret).await?;

    Ok(Json(TotpSetupResponse {
        secret,
        qr_code_uri: uri,
    }))
}

/// POST /api/v1/auth/totp/verify
pub async fn totp_verify(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(req): Json<TotpVerifyRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let user = queries::find_user_by_id(&state.db, user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    let secret = user
        .totp_secret
        .ok_or(AppError::BadRequest("TOTP not set up".into()))?;

    if !auth::verify_totp(&secret, &req.code)? {
        return Err(AppError::AuthError("Invalid TOTP code".into()));
    }

    Ok(Json(serde_json::json!({ "message": "TOTP verified and enabled" })))
}

/// PUT /api/v1/auth/password
pub async fn change_password(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(req): Json<ChangePasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    // Validate new password length
    if req.new_password.len() < 8 || req.new_password.len() > 128 {
        return Err(AppError::Validation("New password must be 8-128 characters".into()));
    }

    // Fetch user and verify current password
    let user = queries::find_user_by_id(&state.db, user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    if !auth::verify_password(&req.current_password, &user.password_hash)? {
        return Err(AppError::AuthError("Current password is incorrect".into()));
    }

    // Hash and save new password
    let new_hash = auth::hash_password(&req.new_password)?;
    queries::update_user_password(&state.db, user_id, &new_hash).await?;

    // Revoke all refresh tokens (force re-login everywhere)
    queries::revoke_all_user_refresh_tokens(&state.db, user_id).await?;

    Ok(Json(serde_json::json!({ "message": "Password changed" })))
}

/// DELETE /api/v1/auth/totp
pub async fn totp_disable(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    queries::clear_user_totp_secret(&state.db, user_id).await?;
    Ok(Json(serde_json::json!({ "message": "TOTP disabled" })))
}
