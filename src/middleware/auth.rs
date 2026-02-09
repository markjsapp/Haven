use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use uuid::Uuid;

use crate::auth::{user_id_from_claims, validate_access_token};
use crate::errors::AppError;
use crate::AppState;

/// Extractor that validates JWT and provides the authenticated user ID.
/// Use in handler signatures: `AuthUser(user_id): AuthUser`
#[derive(Debug, Clone)]
pub struct AuthUser(pub Uuid);

#[axum::async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::AuthError("Missing authorization header".into()))?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or(AppError::AuthError("Invalid authorization format".into()))?;

        let claims = validate_access_token(token, &state.config)?;
        let user_id = user_id_from_claims(&claims)?;

        Ok(AuthUser(user_id))
    }
}

/// Optional auth extractor — returns None if no valid token present.
/// Useful for endpoints that behave differently for authenticated users.
#[derive(Debug, Clone)]
pub struct OptionalAuthUser(pub Option<Uuid>);

#[axum::async_trait]
impl FromRequestParts<AppState> for OptionalAuthUser {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let user_id = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .and_then(|token| validate_access_token(token, &state.config).ok())
            .and_then(|claims| user_id_from_claims(&claims).ok());

        Ok(OptionalAuthUser(user_id))
    }
}
