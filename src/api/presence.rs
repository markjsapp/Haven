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

    // Bulk-fetch presence from Redis hash
    let mut redis = state.redis.clone();
    let mut cmd = redis::cmd("HMGET");
    cmd.arg("haven:presence");
    for uid in &user_ids {
        cmd.arg(uid.to_string());
    }
    let statuses: Vec<Option<String>> = cmd
        .query_async(&mut redis)
        .await
        .unwrap_or_else(|_| vec![None; user_ids.len()]);

    let entries: Vec<PresenceEntry> = user_ids
        .iter()
        .zip(statuses.iter())
        .map(|(uid, status)| {
            let s = match status.as_deref() {
                // Never leak "invisible" to other users
                Some("invisible") | None => "offline",
                Some(s) => s,
            };
            PresenceEntry {
                user_id: *uid,
                status: s.to_string(),
            }
        })
        .collect();

    Ok(Json(entries))
}
