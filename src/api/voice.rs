use axum::{
    extract::{Path, State},
    Json,
};
use livekit_api::access_token::{AccessToken, VideoGrants};
use std::time::Duration;
use uuid::Uuid;

use crate::db::queries;
use crate::errors::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::{VoiceDeafenRequest, VoiceMuteRequest, VoiceParticipantResponse, VoiceTokenResponse, WsServerMessage};
use crate::AppState;

/// POST /api/v1/voice/:channel_id/join
///
/// Join a voice channel. Returns a LiveKit token for the client to connect with.
/// Automatically leaves any previously joined voice channel.
pub async fn join_voice(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<VoiceTokenResponse>> {
    // Verify LiveKit is configured
    if !state.config.livekit_enabled() {
        return Err(AppError::BadRequest("Voice chat is not configured".into()));
    }

    // Verify channel exists and is type "voice"
    let channel = queries::find_channel_by_id(state.db.read(), channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    if channel.channel_type != "voice" {
        return Err(AppError::BadRequest("Channel is not a voice channel".into()));
    }

    // Verify user can access this channel
    if !queries::can_access_channel(state.db.read(), channel_id, user_id).await? {
        return Err(AppError::Forbidden(
            "Not a member of this channel".into(),
        ));
    }

    let mut redis = state.redis.clone();
    let user_id_str = user_id.to_string();

    // Remove user from any current voice channel
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg("haven:voice:*")
        .query_async(&mut redis)
        .await
        .unwrap_or_default();

    for key in &keys {
        let removed: i64 = redis::cmd("SREM")
            .arg(key)
            .arg(&user_id_str)
            .query_async(&mut redis)
            .await
            .unwrap_or(0);

        if removed > 0 {
            // Broadcast leave for the old channel
            if let Some(old_channel_id_str) = key.strip_prefix("haven:voice:") {
                if let Ok(old_channel_id) = Uuid::parse_str(old_channel_id_str) {
                    if old_channel_id != channel_id {
                        broadcast_voice_state(
                            &state, old_channel_id, user_id, &user_id_str, false,
                        )
                        .await;
                    }
                }
            }
        }
    }

    // Add user to the new voice channel
    let _: () = redis::cmd("SADD")
        .arg(format!("haven:voice:{}", channel_id))
        .arg(&user_id_str)
        .query_async(&mut redis)
        .await?;

    // Generate LiveKit token
    let token = AccessToken::with_api_key(
        &state.config.livekit_api_key,
        &state.config.livekit_api_secret,
    )
    .with_identity(&user_id_str)
    .with_ttl(Duration::from_secs(6 * 3600)) // 6 hours
    .with_grants(VideoGrants {
        room_join: true,
        room: channel_id.to_string(),
        can_publish: true,
        can_subscribe: true,
        ..Default::default()
    })
    .to_jwt()
    .map_err(|e| AppError::BadRequest(format!("Failed to generate voice token: {}", e)))?;

    // Broadcast join to channel subscribers
    broadcast_voice_state(&state, channel_id, user_id, &user_id_str, true).await;

    Ok(Json(VoiceTokenResponse {
        token,
        url: state.config.livekit_url.clone(),
        channel_id,
    }))
}

/// POST /api/v1/voice/:channel_id/leave
///
/// Leave a voice channel.
pub async fn leave_voice(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let mut redis = state.redis.clone();
    let user_id_str = user_id.to_string();

    let removed: i64 = redis::cmd("SREM")
        .arg(format!("haven:voice:{}", channel_id))
        .arg(&user_id_str)
        .query_async(&mut redis)
        .await
        .unwrap_or(0);

    if removed > 0 {
        // Clean up server mute/deafen state
        let _: Result<(), _> = redis::cmd("SREM")
            .arg(format!("haven:voice:{}:smuted", channel_id))
            .arg(&user_id_str)
            .query_async(&mut redis)
            .await;
        let _: Result<(), _> = redis::cmd("SREM")
            .arg(format!("haven:voice:{}:sdeafened", channel_id))
            .arg(&user_id_str)
            .query_async(&mut redis)
            .await;
        broadcast_voice_state(&state, channel_id, user_id, &user_id_str, false).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /api/v1/voice/:channel_id/participants
///
/// List users currently in a voice channel.
pub async fn get_participants(
    State(state): State<AppState>,
    AuthUser(_user_id): AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Vec<VoiceParticipantResponse>>> {
    let mut redis = state.redis.clone();

    let member_ids: Vec<String> = redis::cmd("SMEMBERS")
        .arg(format!("haven:voice:{}", channel_id))
        .query_async(&mut redis)
        .await
        .unwrap_or_default();

    // Fetch server mute/deafen sets
    let muted_ids: Vec<String> = redis::cmd("SMEMBERS")
        .arg(format!("haven:voice:{}:smuted", channel_id))
        .query_async(&mut redis)
        .await
        .unwrap_or_default();
    let deafened_ids: Vec<String> = redis::cmd("SMEMBERS")
        .arg(format!("haven:voice:{}:sdeafened", channel_id))
        .query_async(&mut redis)
        .await
        .unwrap_or_default();

    let mut participants = Vec::new();
    for id_str in &member_ids {
        if let Ok(uid) = Uuid::parse_str(id_str) {
            if let Ok(Some(user)) = queries::find_user_by_id(state.db.read(), uid).await {
                participants.push(VoiceParticipantResponse {
                    user_id: uid,
                    username: user.username,
                    display_name: user.display_name,
                    avatar_url: user.avatar_url,
                    server_muted: muted_ids.contains(id_str),
                    server_deafened: deafened_ids.contains(id_str),
                });
            }
        }
    }

    Ok(Json(participants))
}

/// PUT /api/v1/voice/:channel_id/members/:user_id/mute
///
/// Server-mute a user in a voice channel. Requires MUTE_MEMBERS permission.
pub async fn server_mute(
    State(state): State<AppState>,
    AuthUser(caller_id): AuthUser,
    Path((channel_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<VoiceMuteRequest>,
) -> AppResult<Json<serde_json::Value>> {
    // Get channel to find server_id
    let channel = queries::find_channel_by_id(state.db.read(), channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;
    let server_id = channel.server_id
        .ok_or_else(|| AppError::BadRequest("Not a server channel".into()))?;

    // Check MUTE_MEMBERS permission
    let (is_owner, perms) = queries::get_member_permissions(state.db.read(), server_id, caller_id).await?;
    if !is_owner && !crate::permissions::has_permission(perms, crate::permissions::MUTE_MEMBERS) {
        return Err(AppError::Forbidden("Missing MUTE_MEMBERS permission".into()));
    }

    // Verify target is in the voice channel
    let mut redis = state.redis.clone();
    let target_str = target_user_id.to_string();
    let in_channel: bool = redis::cmd("SISMEMBER")
        .arg(format!("haven:voice:{}", channel_id))
        .arg(&target_str)
        .query_async(&mut redis)
        .await
        .unwrap_or(false);
    if !in_channel {
        return Err(AppError::BadRequest("User is not in this voice channel".into()));
    }

    let key = format!("haven:voice:{}:smuted", channel_id);
    if req.muted {
        let _: () = redis::cmd("SADD").arg(&key).arg(&target_str).query_async(&mut redis).await?;
    } else {
        let _: () = redis::cmd("SREM").arg(&key).arg(&target_str).query_async(&mut redis).await?;
    }

    // Get current deafen state
    let is_deafened: bool = redis::cmd("SISMEMBER")
        .arg(format!("haven:voice:{}:sdeafened", channel_id))
        .arg(&target_str)
        .query_async(&mut redis)
        .await
        .unwrap_or(false);

    // Broadcast to channel
    broadcast_voice_mute_state(&state, channel_id, target_user_id, req.muted, is_deafened).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// PUT /api/v1/voice/:channel_id/members/:user_id/deafen
///
/// Server-deafen a user in a voice channel. Requires MUTE_MEMBERS permission.
pub async fn server_deafen(
    State(state): State<AppState>,
    AuthUser(caller_id): AuthUser,
    Path((channel_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<VoiceDeafenRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let channel = queries::find_channel_by_id(state.db.read(), channel_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;
    let server_id = channel.server_id
        .ok_or_else(|| AppError::BadRequest("Not a server channel".into()))?;

    let (is_owner, perms) = queries::get_member_permissions(state.db.read(), server_id, caller_id).await?;
    if !is_owner && !crate::permissions::has_permission(perms, crate::permissions::MUTE_MEMBERS) {
        return Err(AppError::Forbidden("Missing MUTE_MEMBERS permission".into()));
    }

    let mut redis = state.redis.clone();
    let target_str = target_user_id.to_string();
    let in_channel: bool = redis::cmd("SISMEMBER")
        .arg(format!("haven:voice:{}", channel_id))
        .arg(&target_str)
        .query_async(&mut redis)
        .await
        .unwrap_or(false);
    if !in_channel {
        return Err(AppError::BadRequest("User is not in this voice channel".into()));
    }

    let key = format!("haven:voice:{}:sdeafened", channel_id);
    if req.deafened {
        let _: () = redis::cmd("SADD").arg(&key).arg(&target_str).query_async(&mut redis).await?;
    } else {
        let _: () = redis::cmd("SREM").arg(&key).arg(&target_str).query_async(&mut redis).await?;
    }

    // Get current mute state
    let is_muted: bool = redis::cmd("SISMEMBER")
        .arg(format!("haven:voice:{}:smuted", channel_id))
        .arg(&target_str)
        .query_async(&mut redis)
        .await
        .unwrap_or(false);

    broadcast_voice_mute_state(&state, channel_id, target_user_id, is_muted, req.deafened).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Remove a user from all voice channels and broadcast their departure.
/// Called during WebSocket disconnect cleanup.
pub async fn cleanup_voice_state(state: &AppState, user_id: Uuid) {
    let mut redis = state.redis.clone();
    let user_id_str = user_id.to_string();

    let keys: Vec<String> = redis::cmd("KEYS")
        .arg("haven:voice:*")
        .query_async(&mut redis)
        .await
        .unwrap_or_default();

    for key in &keys {
        let removed: i64 = redis::cmd("SREM")
            .arg(key)
            .arg(&user_id_str)
            .query_async(&mut redis)
            .await
            .unwrap_or(0);

        if removed > 0 {
            if let Some(channel_id_str) = key.strip_prefix("haven:voice:") {
                if let Ok(channel_id) = Uuid::parse_str(channel_id_str) {
                    broadcast_voice_state(state, channel_id, user_id, &user_id_str, false).await;
                }
            }
        }
    }
}

/// Broadcast a VoiceStateUpdate event to all subscribers of a channel.
async fn broadcast_voice_state(
    state: &AppState,
    channel_id: Uuid,
    user_id: Uuid,
    _user_id_str: &str,
    joined: bool,
) {
    // Look up username for the event
    let username = match queries::find_user_by_id(state.db.read(), user_id).await {
        Ok(Some(user)) => user.display_name.unwrap_or(user.username),
        _ => return,
    };

    let msg = WsServerMessage::VoiceStateUpdate {
        channel_id,
        user_id,
        username,
        joined,
    };

    if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
        let _ = broadcaster.send(msg.clone());
    }

    // Also broadcast to all channels in the same server so sidebar can update
    if let Ok(Some(channel)) = queries::find_channel_by_id(state.db.read(), channel_id).await {
        if let Some(server_id) = channel.server_id {
            if let Ok(channels) = queries::get_server_channels(state.db.read(), server_id).await {
                for ch in channels {
                    if ch.id != channel_id {
                        if let Some(broadcaster) = state.channel_broadcasts.get(&ch.id) {
                            let _ = broadcaster.send(msg.clone());
                        }
                    }
                }
            }
        }
    }
}

/// Broadcast a VoiceMuteUpdate event to the voice channel.
async fn broadcast_voice_mute_state(
    state: &AppState,
    channel_id: Uuid,
    user_id: Uuid,
    server_muted: bool,
    server_deafened: bool,
) {
    let msg = WsServerMessage::VoiceMuteUpdate {
        channel_id,
        user_id,
        server_muted,
        server_deafened,
    };

    if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
        let _ = broadcaster.send(msg.clone());
    }

    // Broadcast to all channels in the same server
    if let Ok(Some(channel)) = queries::find_channel_by_id(state.db.read(), channel_id).await {
        if let Some(server_id) = channel.server_id {
            if let Ok(channels) = queries::get_server_channels(state.db.read(), server_id).await {
                for ch in channels {
                    if ch.id != channel_id {
                        if let Some(broadcaster) = state.channel_broadcasts.get(&ch.id) {
                            let _ = broadcaster.send(msg.clone());
                        }
                    }
                }
            }
        }
    }
}
