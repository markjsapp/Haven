use axum::{extract::{Query, State}, Json};
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{PresenceEntry, PresenceQuery};
use crate::AppState;

/// Bulk presence check: returns online/offline status for a list of user IDs.
/// GET /api/v1/presence?user_ids=uuid1,uuid2,...
pub async fn get_presence(
    State(state): State<AppState>,
    Query(query): Query<PresenceQuery>,
) -> Result<Json<Vec<PresenceEntry>>, AppError> {
    let user_ids: Vec<Uuid> = query
        .user_ids
        .split(',')
        .filter_map(|s| s.trim().parse::<Uuid>().ok())
        .collect();

    if user_ids.is_empty() {
        return Ok(Json(vec![]));
    }

    // Check Redis for each user
    let mut redis = state.redis.clone();
    let mut entries = Vec::with_capacity(user_ids.len());

    for uid in &user_ids {
        let is_online: bool = redis::cmd("SISMEMBER")
            .arg("haven:online")
            .arg(uid.to_string())
            .query_async(&mut redis)
            .await
            .unwrap_or(false);

        entries.push(PresenceEntry {
            user_id: *uid,
            status: if is_online { "online" } else { "offline" }.to_string(),
        });
    }

    Ok(Json(entries))
}
