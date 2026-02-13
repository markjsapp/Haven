use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::auth::{validate_access_token, user_id_from_claims};
use crate::db::queries;
use crate::errors::AppError;
use crate::models::{MessageResponse, WsClientMessage, WsServerMessage};
use crate::pubsub;
use crate::AppState;

/// Tracks all connected clients. Maps user_id -> list of sender channels.
/// Each user can have multiple connections (multi-device).
pub type ConnectionMap = Arc<DashMap<Uuid, Vec<mpsc::UnboundedSender<WsServerMessage>>>>;

/// Tracks channel subscriptions. Maps channel_id -> broadcast sender.
pub type ChannelBroadcastMap = Arc<DashMap<Uuid, broadcast::Sender<WsServerMessage>>>;

/// Query params for WebSocket upgrade — token passed as query param
/// since WebSocket doesn't support custom headers in browsers.
#[derive(Debug, Deserialize)]
pub struct WsAuthQuery {
    pub token: String,
}

/// WebSocket upgrade handler.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(auth): Query<WsAuthQuery>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    // Authenticate before upgrading
    let claims = validate_access_token(&auth.token, &state.config)?;
    let user_id = user_id_from_claims(&claims)?;

    // Check connection limit
    let conn_count = state
        .connections
        .get(&user_id)
        .map(|v| v.len())
        .unwrap_or(0);

    if conn_count >= state.config.max_ws_connections_per_user as usize {
        return Err(AppError::BadRequest(format!(
            "Maximum {} connections per user exceeded",
            state.config.max_ws_connections_per_user
        )));
    }

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, user_id, state)))
}

/// Handles an individual WebSocket connection.
async fn handle_socket(socket: WebSocket, user_id: Uuid, state: AppState) {
    let (mut ws_sink, mut ws_stream) = socket.split();

    // Create a channel for sending messages to this specific connection
    let (tx, mut rx) = mpsc::unbounded_channel::<WsServerMessage>();

    // Track subscription tasks so we can cancel them on disconnect/unsubscribe
    let subscriptions: Arc<tokio::sync::Mutex<HashMap<Uuid, JoinHandle<()>>>> =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));

    // Register this connection
    state
        .connections
        .entry(user_id)
        .or_insert_with(Vec::new)
        .push(tx.clone());

    tracing::info!("WebSocket connected: user={}", user_id);

    // Track this user in Redis pub/sub for cross-instance delivery
    pubsub::subscribe_redis_user(&state, user_id).await;

    // Always broadcast online — handles reconnect-before-disconnect race on page refresh
    broadcast_presence(user_id, "online", &state).await;

    // Task: forward messages from our channel to the WebSocket sink
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let text = match serde_json::to_string(&msg) {
                Ok(t) => t,
                Err(e) => {
                    tracing::error!("Failed to serialize WS message: {}", e);
                    continue;
                }
            };
            if ws_sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    // Task: read messages from the WebSocket and process them
    let state_clone = state.clone();
    let tx_clone = tx.clone();
    let subs_clone = subscriptions.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Text(text) => {
                    handle_client_message(&text, user_id, &state_clone, &tx_clone, &subs_clone).await;
                }
                Message::Close(_) => break,
                Message::Ping(_) => {} // axum auto-responds with pong
                _ => {}
            }
        }
    });

    // Wait for either task to finish (connection closed)
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // Cleanup: abort all subscription tasks and prune empty broadcasts
    let subscribed_channels: Vec<Uuid> = {
        let mut subs = subscriptions.lock().await;
        let channel_ids: Vec<Uuid> = subs.keys().copied().collect();
        for (_, handle) in subs.drain() {
            handle.abort();
        }
        channel_ids
    };

    // Remove broadcast entries that have no remaining subscribers
    for channel_id in subscribed_channels {
        state.channel_broadcasts.remove_if(&channel_id, |_, tx| tx.receiver_count() == 0);
    }

    // Cleanup: remove this connection
    let was_last_connection = {
        let mut is_last = false;
        if let Some(mut conns) = state.connections.get_mut(&user_id) {
            conns.retain(|sender| !sender.is_closed());
            if conns.is_empty() {
                is_last = true;
                drop(conns);
                state.connections.remove(&user_id);
            }
        }
        is_last
    };

    if was_last_connection {
        broadcast_presence(user_id, "offline", &state).await;
        // Clean up voice state — remove from any voice channel
        crate::api::voice::cleanup_voice_state(&state, user_id).await;
        // Unsubscribe from Redis user channel
        pubsub::unsubscribe_redis_user(&state, user_id).await;
    }

    tracing::info!("WebSocket disconnected: user={}", user_id);
}

/// Process an incoming client message.
async fn handle_client_message(
    text: &str,
    user_id: Uuid,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
    subscriptions: &Arc<tokio::sync::Mutex<HashMap<Uuid, JoinHandle<()>>>>,
) {
    let client_msg: WsClientMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: format!("Invalid message format: {}", e),
            });
            return;
        }
    };

    match client_msg {
        WsClientMessage::SendMessage {
            channel_id,
            sender_token,
            encrypted_body,
            expires_at,
            attachment_ids,
            reply_to_id,
        } => {
            handle_send_message(
                user_id,
                channel_id,
                &sender_token,
                &encrypted_body,
                expires_at,
                attachment_ids,
                reply_to_id,
                state,
                reply_tx,
            )
            .await;
        }

        WsClientMessage::EditMessage {
            message_id,
            encrypted_body,
        } => {
            handle_edit_message(
                user_id,
                message_id,
                &encrypted_body,
                state,
                reply_tx,
            )
            .await;
        }

        WsClientMessage::Subscribe { channel_id } => {
            handle_subscribe(user_id, channel_id, state, reply_tx, subscriptions).await;
        }

        WsClientMessage::Unsubscribe { channel_id } => {
            handle_unsubscribe(channel_id, subscriptions).await;
        }

        WsClientMessage::DeleteMessage { message_id } => {
            handle_delete_message(user_id, message_id, state, reply_tx).await;
        }

        WsClientMessage::AddReaction { message_id, emoji } => {
            handle_add_reaction(user_id, message_id, &emoji, state, reply_tx).await;
        }

        WsClientMessage::RemoveReaction { message_id, emoji } => {
            handle_remove_reaction(user_id, message_id, &emoji, state, reply_tx).await;
        }

        WsClientMessage::SetStatus { status } => {
            handle_set_status(user_id, &status, state, reply_tx).await;
        }

        WsClientMessage::Typing { channel_id } => {
            handle_typing(user_id, channel_id, state).await;
        }

        WsClientMessage::PinMessage { channel_id, message_id } => {
            handle_pin_message(user_id, channel_id, message_id, state, reply_tx).await;
        }

        WsClientMessage::UnpinMessage { channel_id, message_id } => {
            handle_unpin_message(user_id, channel_id, message_id, state, reply_tx).await;
        }

        WsClientMessage::Ping => {
            let _ = reply_tx.send(WsServerMessage::Pong);
            // Refresh presence on each ping to handle stale entries
            let mut redis = state.redis.clone();
            let current: Option<String> = redis::cmd("HGET")
                .arg("haven:presence")
                .arg(user_id.to_string())
                .query_async(&mut redis)
                .await
                .unwrap_or(None);
            if let Some(status) = current {
                let _: Result<(), _> = redis::cmd("HSET")
                    .arg("haven:presence")
                    .arg(user_id.to_string())
                    .arg(status)
                    .query_async(&mut redis)
                    .await;
            }
        }
    }
}

/// Handle a SendMessage command: persist and fan out.
async fn handle_send_message(
    user_id: Uuid,
    channel_id: Uuid,
    sender_token: &str,
    encrypted_body: &str,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
    attachment_ids: Option<Vec<Uuid>>,
    reply_to_id: Option<Uuid>,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
) {
    // Verify user can access the channel (channel member or server member)
    match queries::can_access_channel(state.db.read(), channel_id, user_id).await {
        Ok(true) => {}
        Ok(false) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Not a member of this channel".into(),
            });
            return;
        }
        Err(e) => {
            tracing::error!("DB error checking channel access: {}", e);
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Internal error".into(),
            });
            return;
        }
    }

    // Decode base64 payloads
    let sender_token_bytes = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        sender_token,
    ) {
        Ok(b) => b,
        Err(_) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Invalid sender_token encoding".into(),
            });
            return;
        }
    };

    let encrypted_body_bytes = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        encrypted_body,
    ) {
        Ok(b) => b,
        Err(_) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Invalid encrypted_body encoding".into(),
            });
            return;
        }
    };

    let has_attachments = attachment_ids.as_ref().map_or(false, |ids| !ids.is_empty());

    // Persist message
    let message = match queries::insert_message(
        state.db.write(),
        channel_id,
        &sender_token_bytes,
        &encrypted_body_bytes,
        expires_at,
        has_attachments,
        user_id,
        reply_to_id,
    )
    .await
    {
        Ok(m) => m,
        Err(e) => {
            tracing::error!("Failed to persist message: {}", e);
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Failed to save message".into(),
            });
            return;
        }
    };

    // Link attachments to the message
    if let Some(ids) = attachment_ids {
        for att_id in ids {
            let storage_key = crate::storage::obfuscated_key(&state.storage_key, &att_id.to_string());
            if let Err(e) = queries::link_attachment(state.db.write(), att_id, message.id, &storage_key).await {
                tracing::error!("Failed to link attachment {}: {}", att_id, e);
            }
        }
    }

    let msg_response: MessageResponse = message.into();

    // Send ACK to sender
    let _ = reply_tx.send(WsServerMessage::MessageAck {
        message_id: msg_response.id,
    });

    // Fan out to all channel subscribers via broadcast
    let new_msg = WsServerMessage::NewMessage(msg_response);
    if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
        let _ = broadcaster.send(new_msg.clone());
    }
    // Publish to Redis for cross-instance delivery
    pubsub::publish_channel_event(&mut state.redis.clone(), channel_id, &new_msg).await;
}

/// Handle a Subscribe command: join a channel broadcast group.
async fn handle_subscribe(
    user_id: Uuid,
    channel_id: Uuid,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
    subscriptions: &Arc<tokio::sync::Mutex<HashMap<Uuid, JoinHandle<()>>>>,
) {
    // Verify membership (channel member or server member)
    match queries::can_access_channel(state.db.read(), channel_id, user_id).await {
        Ok(true) => {}
        Ok(false) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Not a member of this channel".into(),
            });
            return;
        }
        Err(_) => return,
    }

    // Cancel existing subscription for this channel (prevents duplicate tasks)
    {
        let mut subs = subscriptions.lock().await;
        if let Some(old_handle) = subs.remove(&channel_id) {
            old_handle.abort();
        }
    }

    // Ensure a broadcast channel exists for this channel
    state
        .channel_broadcasts
        .entry(channel_id)
        .or_insert_with(|| {
            let (tx, _) = broadcast::channel(state.config.broadcast_channel_capacity);
            tx
        });

    // Subscribe this connection to the broadcast
    if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
        let mut rx = broadcaster.subscribe();
        let reply_tx = reply_tx.clone();

        // Spawn a task to forward broadcast messages to this connection
        let handle = tokio::spawn(async move {
            while let Ok(msg) = rx.recv().await {
                if reply_tx.send(msg).is_err() {
                    break;
                }
            }
        });

        subscriptions.lock().await.insert(channel_id, handle);
    }

    // Track in Redis pub/sub for cross-instance delivery
    pubsub::subscribe_redis_channel(state, channel_id).await;

    let _ = reply_tx.send(WsServerMessage::Subscribed { channel_id });
}

/// Handle Unsubscribe — cancel the subscription task for this channel.
async fn handle_unsubscribe(
    channel_id: Uuid,
    subscriptions: &Arc<tokio::sync::Mutex<HashMap<Uuid, JoinHandle<()>>>>,
) {
    let mut subs = subscriptions.lock().await;
    if let Some(handle) = subs.remove(&channel_id) {
        handle.abort();
    }
}

/// Handle a SetStatus command: update presence status.
async fn handle_set_status(
    user_id: Uuid,
    status: &str,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
) {
    let valid_statuses = ["online", "idle", "dnd", "invisible"];
    if !valid_statuses.contains(&status) {
        let _ = reply_tx.send(WsServerMessage::Error {
            message: format!("Invalid status: {}. Valid: online, idle, dnd, invisible", status),
        });
        return;
    }

    // For invisible, we store it in Redis but broadcast as "offline"
    let broadcast_status = if status == "invisible" { "offline" } else { status };

    // Update Redis
    let mut redis = state.redis.clone();
    let _: Result<(), _> = redis::cmd("HSET")
        .arg("haven:presence")
        .arg(user_id.to_string())
        .arg(status)
        .query_async(&mut redis)
        .await;

    // Broadcast to all channels this user belongs to
    let channel_ids = match queries::get_user_channel_ids(state.db.read(), user_id).await {
        Ok(ids) => ids,
        Err(_) => return,
    };

    let msg = WsServerMessage::PresenceUpdate {
        user_id,
        status: broadcast_status.to_string(),
    };

    for channel_id in &channel_ids {
        if let Some(broadcaster) = state.channel_broadcasts.get(channel_id) {
            let _ = broadcaster.send(msg.clone());
        }
    }
    for channel_id in channel_ids {
        pubsub::publish_channel_event(&mut state.redis.clone(), channel_id, &msg).await;
    }
}

/// Handle typing indicator — ephemeral, no persistence.
async fn handle_typing(user_id: Uuid, channel_id: Uuid, state: &AppState) {
    // Look up username for display (cached)
    let username = match queries::find_user_by_id_cached(state.db.read(), &mut state.redis.clone(), user_id).await {
        Ok(Some(user)) => user.display_name.unwrap_or(user.username),
        _ => return, // Can't resolve user — skip
    };

    let typing_msg = WsServerMessage::UserTyping {
        channel_id,
        user_id,
        username,
    };
    if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
        let _ = broadcaster.send(typing_msg.clone());
    }
    pubsub::publish_channel_event(&mut state.redis.clone(), channel_id, &typing_msg).await;
}

/// Handle an EditMessage command: verify ownership, update DB, broadcast.
async fn handle_edit_message(
    user_id: Uuid,
    message_id: Uuid,
    encrypted_body: &str,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
) {
    let encrypted_body_bytes = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        encrypted_body,
    ) {
        Ok(b) => b,
        Err(_) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Invalid encrypted_body encoding".into(),
            });
            return;
        }
    };

    let message = match queries::update_message_body(
        state.db.write(),
        message_id,
        user_id,
        &encrypted_body_bytes,
    )
    .await
    {
        Ok(m) => m,
        Err(e) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: format!("Failed to edit message: {}", e),
            });
            return;
        }
    };

    let edited_body = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &message.encrypted_body,
    );

    // Broadcast edit to all channel subscribers
    let edit_msg = WsServerMessage::MessageEdited {
        message_id: message.id,
        channel_id: message.channel_id,
        encrypted_body: edited_body,
    };
    if let Some(broadcaster) = state.channel_broadcasts.get(&message.channel_id) {
        let _ = broadcaster.send(edit_msg.clone());
    }
    pubsub::publish_channel_event(&mut state.redis.clone(), message.channel_id, &edit_msg).await;
}

/// Handle a DeleteMessage command: verify ownership or server admin, delete from DB, broadcast.
async fn handle_delete_message(
    user_id: Uuid,
    message_id: Uuid,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
) {
    // Try deleting as sender first (fast path)
    let message = match queries::delete_message(state.db.write(), message_id, user_id).await {
        Ok(m) => m,
        Err(_) => {
            // Sender check failed — check if user is the server owner
            let msg = match queries::find_message_by_id(state.db.read(), message_id).await {
                Ok(Some(m)) => m,
                Ok(None) => {
                    let _ = reply_tx.send(WsServerMessage::Error {
                        message: "Message not found".into(),
                    });
                    return;
                }
                Err(e) => {
                    let _ = reply_tx.send(WsServerMessage::Error {
                        message: format!("Failed to find message: {}", e),
                    });
                    return;
                }
            };

            // Get the channel's server_id
            let channel = match queries::find_channel_by_id(state.db.read(), msg.channel_id).await {
                Ok(Some(c)) => c,
                _ => {
                    let _ = reply_tx.send(WsServerMessage::Error {
                        message: "Cannot delete this message".into(),
                    });
                    return;
                }
            };

            // Only server channels have a server_id
            let server_id = match channel.server_id {
                Some(sid) => sid,
                None => {
                    let _ = reply_tx.send(WsServerMessage::Error {
                        message: "Cannot delete this message".into(),
                    });
                    return;
                }
            };

            // Check if user is the server owner
            let server = match queries::find_server_by_id(state.db.read(), server_id).await {
                Ok(Some(s)) if s.owner_id == user_id => s,
                _ => {
                    let _ = reply_tx.send(WsServerMessage::Error {
                        message: "Cannot delete this message".into(),
                    });
                    return;
                }
            };
            let _ = server; // used above in the guard

            // User is the server owner — delete unconditionally
            match queries::delete_message_admin(state.db.write(), message_id).await {
                Ok(m) => m,
                Err(e) => {
                    let _ = reply_tx.send(WsServerMessage::Error {
                        message: format!("Failed to delete message: {}", e),
                    });
                    return;
                }
            }
        }
    };

    // Broadcast deletion to all channel subscribers
    let del_msg = WsServerMessage::MessageDeleted {
        message_id: message.id,
        channel_id: message.channel_id,
    };
    if let Some(broadcaster) = state.channel_broadcasts.get(&message.channel_id) {
        let _ = broadcaster.send(del_msg.clone());
    }
    pubsub::publish_channel_event(&mut state.redis.clone(), message.channel_id, &del_msg).await;
}

/// Handle an AddReaction command: persist and broadcast.
async fn handle_add_reaction(
    user_id: Uuid,
    message_id: Uuid,
    emoji: &str,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
) {
    // Look up the message to get its channel_id
    let message = match queries::find_message_by_id(state.db.read(), message_id).await {
        Ok(Some(m)) => m,
        Ok(None) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Message not found".into(),
            });
            return;
        }
        Err(e) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: format!("Failed to find message: {}", e),
            });
            return;
        }
    };

    // Persist the reaction
    if let Err(e) = queries::add_reaction(state.db.write(), message_id, user_id, emoji).await {
        let _ = reply_tx.send(WsServerMessage::Error {
            message: format!("Failed to add reaction: {}", e),
        });
        return;
    }

    // Broadcast to all channel subscribers
    let react_msg = WsServerMessage::ReactionAdded {
        message_id,
        channel_id: message.channel_id,
        user_id,
        emoji: emoji.to_string(),
    };
    if let Some(broadcaster) = state.channel_broadcasts.get(&message.channel_id) {
        let _ = broadcaster.send(react_msg.clone());
    }
    pubsub::publish_channel_event(&mut state.redis.clone(), message.channel_id, &react_msg).await;
}

/// Handle a RemoveReaction command: delete and broadcast.
async fn handle_remove_reaction(
    user_id: Uuid,
    message_id: Uuid,
    emoji: &str,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
) {
    // Look up the message to get its channel_id
    let message = match queries::find_message_by_id(state.db.read(), message_id).await {
        Ok(Some(m)) => m,
        Ok(None) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Message not found".into(),
            });
            return;
        }
        Err(e) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: format!("Failed to find message: {}", e),
            });
            return;
        }
    };

    // Delete the reaction
    match queries::remove_reaction(state.db.write(), message_id, user_id, emoji).await {
        Ok(false) => return, // Didn't exist — no-op
        Err(e) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: format!("Failed to remove reaction: {}", e),
            });
            return;
        }
        Ok(true) => {}
    }

    // Broadcast to all channel subscribers
    let unreact_msg = WsServerMessage::ReactionRemoved {
        message_id,
        channel_id: message.channel_id,
        user_id,
        emoji: emoji.to_string(),
    };
    if let Some(broadcaster) = state.channel_broadcasts.get(&message.channel_id) {
        let _ = broadcaster.send(unreact_msg.clone());
    }
    pubsub::publish_channel_event(&mut state.redis.clone(), message.channel_id, &unreact_msg).await;
}

/// Broadcast a presence update (online/offline) to all channels the user belongs to,
/// and track the state in Redis for multi-instance queries.
pub(crate) async fn broadcast_presence(user_id: Uuid, status: &str, state: &AppState) {
    // Update Redis presence hash
    let mut redis = state.redis.clone();
    let redis_result: Result<(), _> = if status == "offline" {
        redis::cmd("HDEL")
            .arg("haven:presence")
            .arg(user_id.to_string())
            .query_async(&mut redis)
            .await
    } else {
        redis::cmd("HSET")
            .arg("haven:presence")
            .arg(user_id.to_string())
            .arg(status)
            .query_async(&mut redis)
            .await
    };
    if let Err(e) = redis_result {
        tracing::warn!("Failed to update presence in Redis: {}", e);
    }

    // Get all channels this user belongs to and broadcast
    let channel_ids = match queries::get_user_channel_ids(state.db.read(), user_id).await {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!("Failed to get user channels for presence: {}", e);
            return;
        }
    };

    let msg = WsServerMessage::PresenceUpdate {
        user_id,
        status: status.to_string(),
    };

    for ch_id in &channel_ids {
        if let Some(broadcaster) = state.channel_broadcasts.get(ch_id) {
            let _ = broadcaster.send(msg.clone());
        }
    }
    // Publish presence to all subscribed channels via Redis
    for ch_id in channel_ids {
        pubsub::publish_channel_event(&mut state.redis.clone(), ch_id, &msg).await;
    }
}

/// Handle PinMessage: verify permissions and broadcast.
async fn handle_pin_message(
    user_id: Uuid,
    channel_id: Uuid,
    message_id: Uuid,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
) {
    match queries::can_access_channel(state.db.read(), channel_id, user_id).await {
        Ok(true) => {}
        Ok(false) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Not a member of this channel".into(),
            });
            return;
        }
        Err(_) => {
            let _ = reply_tx.send(WsServerMessage::Error { message: "Internal error".into() });
            return;
        }
    }

    // Verify the message belongs to this channel
    match queries::find_message_by_id(state.db.read(), message_id).await {
        Ok(Some(m)) if m.channel_id == channel_id => {}
        _ => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Message not found in this channel".into(),
            });
            return;
        }
    }

    match queries::pin_message(state.db.write(), channel_id, message_id, user_id).await {
        Ok(_) => {
            let pin_msg = WsServerMessage::MessagePinned {
                channel_id,
                message_id,
                pinned_by: user_id,
            };
            if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
                let _ = broadcaster.send(pin_msg.clone());
            }
            pubsub::publish_channel_event(&mut state.redis.clone(), channel_id, &pin_msg).await;

            // Insert system message for pin
            if let Ok(Some(user)) = queries::find_user_by_id(state.db.read(), user_id).await {
                let username = user.display_name.as_deref().unwrap_or(&user.username);
                let body = serde_json::json!({
                    "event": "message_pinned",
                    "username": username,
                    "user_id": user_id.to_string(),
                    "message_id": message_id.to_string(),
                });
                if let Ok(sys_msg) = queries::insert_system_message(
                    state.db.write(), channel_id, &body.to_string(),
                ).await {
                    let response: MessageResponse = sys_msg.into();
                    let sys_ws_msg = WsServerMessage::NewMessage(response);
                    if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
                        let _ = broadcaster.send(sys_ws_msg.clone());
                    }
                    pubsub::publish_channel_event(&mut state.redis.clone(), channel_id, &sys_ws_msg).await;
                }
            }
        }
        Err(e) => {
            let _ = reply_tx.send(WsServerMessage::Error { message: e.to_string() });
        }
    }
}

/// Handle UnpinMessage: verify permissions and broadcast.
async fn handle_unpin_message(
    user_id: Uuid,
    channel_id: Uuid,
    message_id: Uuid,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
) {
    match queries::can_access_channel(state.db.read(), channel_id, user_id).await {
        Ok(true) => {}
        Ok(false) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Not a member of this channel".into(),
            });
            return;
        }
        Err(_) => {
            let _ = reply_tx.send(WsServerMessage::Error { message: "Internal error".into() });
            return;
        }
    }

    match queries::unpin_message(state.db.write(), channel_id, message_id).await {
        Ok(true) => {
            let unpin_msg = WsServerMessage::MessageUnpinned {
                channel_id,
                message_id,
            };
            if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
                let _ = broadcaster.send(unpin_msg.clone());
            }
            pubsub::publish_channel_event(&mut state.redis.clone(), channel_id, &unpin_msg).await;

            // Insert system message for unpin
            if let Ok(Some(user)) = queries::find_user_by_id(state.db.read(), user_id).await {
                let username = user.display_name.as_deref().unwrap_or(&user.username);
                let body = serde_json::json!({
                    "event": "message_unpinned",
                    "username": username,
                    "user_id": user_id.to_string(),
                    "message_id": message_id.to_string(),
                });
                if let Ok(sys_msg) = queries::insert_system_message(
                    state.db.write(), channel_id, &body.to_string(),
                ).await {
                    let response: MessageResponse = sys_msg.into();
                    let sys_ws_msg = WsServerMessage::NewMessage(response);
                    if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
                        let _ = broadcaster.send(sys_ws_msg.clone());
                    }
                    pubsub::publish_channel_event(&mut state.redis.clone(), channel_id, &sys_ws_msg).await;
                }
            }
        }
        Ok(false) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Message is not pinned".into(),
            });
        }
        Err(e) => {
            let _ = reply_tx.send(WsServerMessage::Error { message: e.to_string() });
        }
    }
}
