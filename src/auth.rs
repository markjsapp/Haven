use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config::AppConfig;
use crate::errors::{AppError, AppResult};

// ─── JWT Claims ────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String, // user ID
    pub exp: usize,  // expiry timestamp
    pub iat: usize,  // issued at
    pub jti: String, // unique token ID
}

// ─── Password Hashing (Argon2id) ───────────────────────

/// Hash a password using Argon2id with a random salt.
pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Password hashing failed: {}", e)))?;
    Ok(hash.to_string())
}

/// Verify a password against a stored Argon2id hash.
pub fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Invalid password hash: {}", e)))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

/// Hash an email for storage (one-way, for account recovery matching).
pub fn hash_email(email: &str) -> String {
    let normalized = email.trim().to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ─── JWT Token Generation ──────────────────────────────

/// Generate a JWT access token for a user.
pub fn generate_access_token(user_id: Uuid, config: &AppConfig) -> AppResult<String> {
    let now = Utc::now();
    let expiry = now + Duration::hours(config.jwt_expiry_hours);

    let claims = Claims {
        sub: user_id.to_string(),
        exp: expiry.timestamp() as usize,
        iat: now.timestamp() as usize,
        jti: Uuid::new_v4().to_string(),
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("JWT encoding failed: {}", e)))?;

    Ok(token)
}

/// Validate a JWT access token and extract claims.
pub fn validate_access_token(token: &str, config: &AppConfig) -> AppResult<Claims> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| match e.kind() {
        jsonwebtoken::errors::ErrorKind::ExpiredSignature => AppError::TokenExpired,
        _ => AppError::InvalidToken,
    })?;

    Ok(token_data.claims)
}

/// Extract the user ID from validated claims.
pub fn user_id_from_claims(claims: &Claims) -> AppResult<Uuid> {
    Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::InvalidToken)
}

// ─── Refresh Tokens ────────────────────────────────────

/// Generate a cryptographically random refresh token.
pub fn generate_refresh_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..48).map(|_| rng.gen()).collect();
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &bytes)
}

/// Hash a refresh token for storage (we never store the raw token).
pub fn hash_refresh_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ─── TOTP (2FA) ────────────────────────────────────────

/// Generate a new TOTP secret and return it with the provisioning URI.
pub fn generate_totp_secret(username: &str) -> AppResult<(String, String)> {
    use totp_rs::{Algorithm, Secret, TOTP};

    let secret = Secret::generate_secret();
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret.to_bytes().unwrap(),
        Some("Haven".into()),
        username.into(),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("TOTP generation failed: {}", e)))?;

    let uri = totp.get_url();
    let secret_b32 = secret.to_encoded().to_string();

    Ok((secret_b32, uri))
}

/// Verify a TOTP code against a stored secret.
pub fn verify_totp(secret_b32: &str, code: &str) -> AppResult<bool> {
    use totp_rs::{Algorithm, Secret, TOTP};

    let secret = Secret::Encoded(secret_b32.into());
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret.to_bytes().map_err(|e| {
            AppError::Internal(anyhow::anyhow!("Invalid TOTP secret: {}", e))
        })?,
        Some("Haven".into()),
        String::new(),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("TOTP creation failed: {}", e)))?;

    Ok(totp.check_current(code).unwrap_or(false))
}
