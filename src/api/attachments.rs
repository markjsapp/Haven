use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::*;
use crate::AppState;

/// POST /api/v1/attachments/upload
/// Generate a presigned URL for uploading an encrypted attachment.
pub async fn request_upload(
    State(state): State<AppState>,
    AuthUser(_user_id): AuthUser,
) -> AppResult<Json<UploadUrlResponse>> {
    let attachment_id = Uuid::new_v4();
    let storage_key = format!("attachments/{}/{}", Uuid::new_v4(), attachment_id);

    // Generate presigned PUT URL
    let presigned = state
        .s3_client
        .put_object()
        .bucket(&state.config.s3_bucket)
        .key(&storage_key)
        .content_type("application/octet-stream") // All uploads are opaque encrypted blobs
        .presigned(
            aws_sdk_s3::presigning::PresigningConfig::builder()
                .expires_in(std::time::Duration::from_secs(3600))
                .build()
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Presign config error: {}", e)))?,
        )
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to generate presigned URL: {}", e)))?;

    Ok(Json(UploadUrlResponse {
        upload_url: presigned.uri().to_string(),
        attachment_id,
        storage_key,
    }))
}

/// GET /api/v1/attachments/:attachment_id
/// Generate a presigned URL for downloading an encrypted attachment.
pub async fn request_download(
    State(state): State<AppState>,
    AuthUser(_user_id): AuthUser,
    Path(attachment_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    // Look up the attachment
    let att = sqlx::query_as::<_, crate::models::Attachment>(
        "SELECT * FROM attachments WHERE id = $1",
    )
    .bind(attachment_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Attachment not found".into()))?;

    // TODO: Verify the requesting user has access to the message's channel

    // Generate presigned GET URL
    let presigned = state
        .s3_client
        .get_object()
        .bucket(&state.config.s3_bucket)
        .key(&att.storage_key)
        .presigned(
            aws_sdk_s3::presigning::PresigningConfig::builder()
                .expires_in(std::time::Duration::from_secs(3600))
                .build()
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Presign config error: {}", e)))?,
        )
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to generate presigned URL: {}", e)))?;

    Ok(Json(serde_json::json!({
        "download_url": presigned.uri().to_string(),
        "attachment_id": att.id,
    })))
}
