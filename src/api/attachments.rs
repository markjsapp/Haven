use std::path::Path;

use axum::{
    body::Bytes,
    extract::{Path as AxumPath, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use uuid::Uuid;

use crate::db::queries;
use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::*;
use crate::storage;
use crate::AppState;

/// POST /api/v1/attachments/upload
/// Receives encrypted blob bytes, encrypts at rest, and stores locally.
pub async fn upload(
    State(state): State<AppState>,
    AuthUser(_user_id): AuthUser,
    body: Bytes,
) -> AppResult<Json<UploadResponse>> {
    // Validate file size
    if body.len() as u64 > state.config.max_upload_size_bytes {
        return Err(AppError::BadRequest(format!(
            "File too large (max {} bytes)",
            state.config.max_upload_size_bytes
        )));
    }

    if body.is_empty() {
        return Err(AppError::Validation("Empty upload body".into()));
    }

    let attachment_id = Uuid::new_v4();
    let storage_key = storage::obfuscated_key(&state.storage_key, &attachment_id.to_string());

    // Encrypt at rest and write to disk
    storage::store_blob(
        Path::new(&state.config.storage_dir),
        &storage_key,
        &body,
        &state.storage_key,
    )
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to store attachment: {}", e)))?;

    tracing::debug!("Stored attachment {} ({} bytes)", attachment_id, body.len());

    Ok(Json(UploadResponse {
        attachment_id,
        storage_key,
    }))
}

/// GET /api/v1/attachments/:attachment_id
/// Reads encrypted-at-rest blob from disk, decrypts server-side layer, returns raw bytes.
pub async fn download(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    AxumPath(attachment_id): AxumPath<Uuid>,
) -> AppResult<impl IntoResponse> {
    // Look up the attachment
    let att = queries::find_attachment_by_id(&state.db, attachment_id)
        .await?
        .ok_or(AppError::NotFound("Attachment not found".into()))?;

    // Verify the user has access to the message's channel
    let message = queries::find_message_by_id(&state.db, att.message_id)
        .await?
        .ok_or(AppError::NotFound("Message not found".into()))?;

    if !queries::is_channel_member(&state.db, message.channel_id, user_id).await? {
        return Err(AppError::Forbidden("Not a member of this channel".into()));
    }

    // Read and decrypt server-side encryption from disk
    let data = storage::load_blob(
        Path::new(&state.config.storage_dir),
        &att.storage_key,
        &state.storage_key,
    )
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to load attachment: {}", e)))?;

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/octet-stream")],
        data,
    ))
}
