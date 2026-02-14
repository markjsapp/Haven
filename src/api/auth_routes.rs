use axum::{extract::State, http::StatusCode, Json};
use chrono::{Duration, Utc};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use validator::Validate;

use crate::auth;
use crate::db::queries;
use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::*;
use crate::storage;
use crate::AppState;

/// Number of leading zero bits required for PoW (20 ≈ ~1M hashes, sub-second on modern hardware)
const POW_DIFFICULTY: u32 = 20;
/// TTL for PoW challenges in Redis (seconds)
const POW_CHALLENGE_TTL: u64 = 300;

/// GET /api/v1/auth/challenge — generate a PoW challenge for registration
pub async fn pow_challenge(
    State(state): State<AppState>,
) -> AppResult<Json<PowChallengeResponse>> {
    // Generate a random 32-byte challenge
    let challenge = Uuid::new_v4().to_string();

    // Store in Redis with TTL
    let redis_key = format!("haven:pow:{}", challenge);
    let mut redis = state.redis.clone();
    let _: Result<(), redis::RedisError> = redis::cmd("SET")
        .arg(&redis_key)
        .arg("1")
        .arg("EX")
        .arg(POW_CHALLENGE_TTL)
        .query_async(&mut redis)
        .await;

    Ok(Json(PowChallengeResponse {
        challenge,
        difficulty: POW_DIFFICULTY,
    }))
}

/// Verify a Proof-of-Work solution: SHA-256(challenge + nonce) must have `difficulty` leading zero bits.
fn verify_pow(challenge: &str, nonce: &str, difficulty: u32) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(challenge.as_bytes());
    hasher.update(nonce.as_bytes());
    let hash = hasher.finalize();

    // Check leading zero bits
    let mut zero_bits = 0u32;
    for &byte in hash.as_slice() {
        if byte == 0 {
            zero_bits += 8;
        } else {
            zero_bits += byte.leading_zeros();
            break;
        }
        if zero_bits >= difficulty {
            break;
        }
    }
    zero_bits >= difficulty
}

/// POST /api/v1/auth/register
pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> AppResult<Json<AuthResponse>> {
    // Validate request
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    // Verify Proof-of-Work
    let redis_key = format!("haven:pow:{}", req.pow_challenge);
    let mut redis = state.redis.clone();
    let exists: Option<String> = redis::cmd("GET")
        .arg(&redis_key)
        .query_async(&mut redis)
        .await
        .unwrap_or(None);

    if exists.is_none() {
        return Err(AppError::Validation(
            "Invalid or expired PoW challenge — request a new one from /auth/challenge".into(),
        ));
    }

    // Delete challenge so it can't be reused
    let _: Result<(), redis::RedisError> = redis::cmd("DEL")
        .arg(&redis_key)
        .query_async(&mut redis)
        .await;

    if !verify_pow(&req.pow_challenge, &req.pow_nonce, POW_DIFFICULTY) {
        return Err(AppError::Validation("Invalid Proof-of-Work solution".into()));
    }

    // Hash password
    let password_hash = auth::hash_password(&req.password)?;

    // Hash email if provided (HMAC-SHA256 with server secret to resist rainbow tables)
    let email_hash = req.email.as_deref().map(|e| auth::hash_email(e, &state.config.jwt_secret));

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
        state.db.write(),
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

        queries::insert_prekeys(state.db.write(), user.id, &prekeys?).await?;
    }

    // Generate tokens with a new token family
    let family_id = Uuid::new_v4();
    let access_token = auth::generate_access_token(user.id, &state.config)?;
    let refresh_token = auth::generate_refresh_token();
    let refresh_hash = auth::hash_refresh_token(&refresh_token);

    let expiry = Utc::now() + Duration::days(state.config.refresh_token_expiry_days);
    queries::store_refresh_token_with_family(
        state.db.write(), user.id, &refresh_hash, expiry, Some(family_id),
    ).await?;

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
    let user = queries::find_user_by_username(state.db.read(), &req.username)
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

    // Generate tokens with a new token family
    let family_id = Uuid::new_v4();
    let access_token = auth::generate_access_token(user.id, &state.config)?;
    let refresh_token = auth::generate_refresh_token();
    let refresh_hash = auth::hash_refresh_token(&refresh_token);

    let expiry = Utc::now() + Duration::days(state.config.refresh_token_expiry_days);
    queries::store_refresh_token_with_family(
        state.db.write(), user.id, &refresh_hash, expiry, Some(family_id),
    ).await?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user: user.into(),
    }))
}

/// POST /api/v1/auth/refresh
/// Implements token family rotation with theft detection:
/// - If the token is valid and not revoked: rotate normally, mark old as revoked
/// - If the token was already revoked (replayed): THEFT DETECTED — revoke entire family
pub async fn refresh_token(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> AppResult<Json<AuthResponse>> {
    let token_hash = auth::hash_refresh_token(&req.refresh_token);

    // Find the token (including revoked ones for theft detection)
    let stored_token = queries::find_refresh_token(state.db.read(), &token_hash)
        .await?
        .ok_or(AppError::AuthError("Invalid or expired refresh token".into()))?;

    // THEFT DETECTION: if this token was already revoked, someone is replaying it.
    // Revoke the entire token family to protect the user.
    if stored_token.revoked {
        tracing::warn!(
            "Refresh token reuse detected for user {}! Revoking token family {:?}",
            stored_token.user_id,
            stored_token.family_id,
        );
        if let Some(family_id) = stored_token.family_id {
            queries::revoke_token_family(state.db.write(), family_id).await?;
        }
        // Also revoke all tokens for this user as a safety measure
        queries::revoke_all_user_refresh_tokens(state.db.write(), stored_token.user_id).await?;
        return Err(AppError::AuthError(
            "Token reuse detected — all sessions revoked for security. Please log in again.".into(),
        ));
    }

    // Mark old token as revoked (soft-delete — kept for theft detection)
    queries::revoke_refresh_token(state.db.write(), &token_hash).await?;

    // Get user
    let user = queries::find_user_by_id(state.db.read(), stored_token.user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    // Generate new token in the same family
    let access_token = auth::generate_access_token(user.id, &state.config)?;
    let new_refresh_token = auth::generate_refresh_token();
    let new_refresh_hash = auth::hash_refresh_token(&new_refresh_token);

    let expiry = Utc::now() + Duration::days(state.config.refresh_token_expiry_days);
    queries::store_refresh_token_with_family(
        state.db.write(), user.id, &new_refresh_hash, expiry, stored_token.family_id,
    ).await?;

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
    queries::revoke_all_user_refresh_tokens(state.db.write(), user_id).await?;

    // Broadcast offline presence and clean up voice state
    crate::ws::broadcast_presence(user_id, "offline", &state).await;
    crate::api::voice::cleanup_voice_state(&state, user_id).await;

    Ok(Json(serde_json::json!({ "message": "Logged out" })))
}

/// POST /api/v1/auth/totp/setup
pub async fn totp_setup(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<TotpSetupResponse>> {
    let user = queries::find_user_by_id(state.db.read(), user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    if user.totp_secret.is_some() {
        return Err(AppError::BadRequest("TOTP already enabled".into()));
    }

    let (secret, uri) = auth::generate_totp_secret(&user.username)?;

    // Store in pending column — NOT active until user verifies with a valid code.
    // This prevents lockout if the setup dialog is closed before scanning the QR.
    queries::set_pending_totp_secret(state.db.write(), user_id, &secret).await?;

    Ok(Json(TotpSetupResponse {
        secret,
        qr_code_uri: uri,
    }))
}

/// POST /api/v1/auth/totp/verify
/// Verifies the user can produce a valid TOTP code, then promotes the
/// pending secret to active.
pub async fn totp_verify(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(req): Json<TotpVerifyRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let user = queries::find_user_by_id(state.db.read(), user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    // Check pending secret first (setup flow), then active secret (re-verify flow)
    let secret = user
        .pending_totp_secret
        .or(user.totp_secret)
        .ok_or(AppError::BadRequest("TOTP not set up".into()))?;

    if !auth::verify_totp(&secret, &req.code)? {
        return Err(AppError::AuthError("Invalid TOTP code".into()));
    }

    // Promote pending secret to active (idempotent if already active)
    queries::promote_pending_totp(state.db.write(), user_id).await?;

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
    let user = queries::find_user_by_id(state.db.read(), user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    if !auth::verify_password(&req.current_password, &user.password_hash)? {
        return Err(AppError::AuthError("Current password is incorrect".into()));
    }

    // Hash and save new password
    let new_hash = auth::hash_password(&req.new_password)?;
    queries::update_user_password(state.db.write(), user_id, &new_hash).await?;

    // Revoke all refresh tokens (force re-login everywhere)
    queries::revoke_all_user_refresh_tokens(state.db.write(), user_id).await?;

    Ok(Json(serde_json::json!({ "message": "Password changed" })))
}

/// DELETE /api/v1/auth/totp
pub async fn totp_disable(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    queries::clear_user_totp_secret(state.db.write(), user_id).await?;
    Ok(Json(serde_json::json!({ "message": "TOTP disabled" })))
}

/// POST /api/v1/auth/delete-account — permanently delete the user's account
pub async fn delete_account(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(req): Json<DeleteAccountRequest>,
) -> AppResult<StatusCode> {
    // Verify password
    let user = queries::find_user_by_id(state.db.read(), user_id)
        .await?
        .ok_or(AppError::UserNotFound)?;

    if !auth::verify_password(&req.password, &user.password_hash)? {
        return Err(AppError::AuthError("Incorrect password".into()));
    }

    // 1. Delete servers owned by this user (cascade removes channels, members, etc.)
    let owned_servers = queries::get_servers_owned_by(state.db.read(), user_id).await?;
    for server in &owned_servers {
        // Clean up custom emoji storage for this server
        let emojis = queries::list_server_emojis(state.db.read(), server.id).await.unwrap_or_default();
        for emoji in &emojis {
            let _ = state.storage.delete_blob(&emoji.storage_key).await;
        }
        // Delete server (CASCADE handles members, channels, emojis, etc.)
        sqlx::query("DELETE FROM servers WHERE id = $1")
            .bind(server.id)
            .execute(state.db.write())
            .await
            .ok();
    }

    // 2. Clean up message children that reference the partitioned messages table
    //    (no FK cascade on partitioned tables in PG < 17)
    sqlx::query("DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE sender_id = $1)")
        .bind(user_id)
        .execute(state.db.write())
        .await
        .ok();
    sqlx::query("DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE sender_id = $1)")
        .bind(user_id)
        .execute(state.db.write())
        .await
        .ok();
    sqlx::query("DELETE FROM pinned_messages WHERE message_id IN (SELECT id FROM messages WHERE sender_id = $1)")
        .bind(user_id)
        .execute(state.db.write())
        .await
        .ok();
    sqlx::query("DELETE FROM reports WHERE message_id IN (SELECT id FROM messages WHERE sender_id = $1)")
        .bind(user_id)
        .execute(state.db.write())
        .await
        .ok();

    // 3. Delete user's messages
    sqlx::query("DELETE FROM messages WHERE sender_id = $1")
        .bind(user_id)
        .execute(state.db.write())
        .await
        .ok();

    // 4. Also delete reactions by this user on other messages
    sqlx::query("DELETE FROM reactions WHERE user_id = $1")
        .bind(user_id)
        .execute(state.db.write())
        .await
        .ok();

    // 5. Revoke tokens, broadcast offline, clean up voice
    queries::revoke_all_user_refresh_tokens(state.db.write(), user_id).await.ok();
    crate::ws::broadcast_presence(user_id, "offline", &state).await;
    crate::api::voice::cleanup_voice_state(&state, user_id).await;

    // 6. Close active WS connections
    if let Some((_, conns)) = state.connections.remove(&user_id) {
        for tx in conns {
            let _ = tx.send(WsServerMessage::Error {
                message: "Account deleted".into(),
            });
        }
    }

    // 7. Delete user (FK CASCADE handles server_members, channel_members,
    //    friendships, blocks, prekeys, key_backups, sender_key_distributions, etc.)
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(state.db.write())
        .await
        .map_err(|e| AppError::Database(e))?;

    // 8. Clean up stored files (avatar, banner)
    let avatar_key = storage::obfuscated_key(&state.storage_key, &format!("avatar:{}", user_id));
    let banner_key = storage::obfuscated_key(&state.storage_key, &format!("banner:{}", user_id));
    let _ = state.storage.delete_blob(&avatar_key).await;
    let _ = state.storage.delete_blob(&banner_key).await;

    // 9. Invalidate Redis caches
    crate::cache::invalidate(&mut state.redis.clone(), &format!("haven:user:{}", user_id)).await;

    Ok(StatusCode::NO_CONTENT)
}
