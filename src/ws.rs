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

    // Cleanup: abort all subscription tasks
    {
        let mut subs = subscriptions.lock().await;
        for (_, handle) in subs.drain() {
            handle.abort();
        }
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
        } => {
            handle_send_message(
                user_id,
                channel_id,
                &sender_token,
                &encrypted_body,
                expires_at,
                attachment_ids,
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

        WsClientMessage::Typing { channel_id } => {
            handle_typing(user_id, channel_id, state).await;
        }

        WsClientMessage::Ping => {
            let _ = reply_tx.send(WsServerMessage::Pong);
            // Refresh presence on each ping to handle stale entries
            let mut redis = state.redis.clone();
            let _: Result<(), _> = redis::cmd("SADD")
                .arg("haven:online")
                .arg(user_id.to_string())
                .query_async(&mut redis)
                .await;
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
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
) {
    // Verify user is a member of the channel
    match queries::is_channel_member(&state.db, channel_id, user_id).await {
        Ok(true) => {}
        Ok(false) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: "Not a member of this channel".into(),
            });
            return;
        }
        Err(e) => {
            tracing::error!("DB error checking channel membership: {}", e);
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
        &state.db,
        channel_id,
        &sender_token_bytes,
        &encrypted_body_bytes,
        expires_at,
        has_attachments,
        user_id,
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
            if let Err(e) = queries::link_attachment(&state.db, att_id, message.id, &storage_key).await {
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
    if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
        let _ = broadcaster.send(WsServerMessage::NewMessage(msg_response));
    }
}

/// Handle a Subscribe command: join a channel broadcast group.
async fn handle_subscribe(
    user_id: Uuid,
    channel_id: Uuid,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
    subscriptions: &Arc<tokio::sync::Mutex<HashMap<Uuid, JoinHandle<()>>>>,
) {
    // Verify membership
    match queries::is_channel_member(&state.db, channel_id, user_id).await {
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
            let (tx, _) = broadcast::channel(256);
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

/// Handle typing indicator — ephemeral, no persistence.
async fn handle_typing(user_id: Uuid, channel_id: Uuid, state: &AppState) {
    // Look up username for display
    let username = match queries::find_user_by_id(&state.db, user_id).await {
        Ok(Some(user)) => user.display_name.unwrap_or(user.username),
        _ => return, // Can't resolve user — skip
    };

    if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
        let _ = broadcaster.send(WsServerMessage::UserTyping {
            channel_id,
            user_id,
            username,
        });
    }
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
        &state.db,
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
    if let Some(broadcaster) = state.channel_broadcasts.get(&message.channel_id) {
        let _ = broadcaster.send(WsServerMessage::MessageEdited {
            message_id: message.id,
            channel_id: message.channel_id,
            encrypted_body: edited_body,
        });
    }
}

/// Handle a DeleteMessage command: verify ownership, delete from DB, broadcast.
async fn handle_delete_message(
    user_id: Uuid,
    message_id: Uuid,
    state: &AppState,
    reply_tx: &mpsc::UnboundedSender<WsServerMessage>,
) {
    let message = match queries::delete_message(&state.db, message_id, user_id).await {
        Ok(m) => m,
        Err(e) => {
            let _ = reply_tx.send(WsServerMessage::Error {
                message: format!("Failed to delete message: {}", e),
            });
            return;
        }
    };

    // Broadcast deletion to all channel subscribers
    if let Some(broadcaster) = state.channel_broadcasts.get(&message.channel_id) {
        let _ = broadcaster.send(WsServerMessage::MessageDeleted {
            message_id: message.id,
            channel_id: message.channel_id,
        });
    }
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
    let message = match queries::find_message_by_id(&state.db, message_id).await {
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
    if let Err(e) = queries::add_reaction(&state.db, message_id, user_id, emoji).await {
        let _ = reply_tx.send(WsServerMessage::Error {
            message: format!("Failed to add reaction: {}", e),
        });
        return;
    }

    // Broadcast to all channel subscribers
    if let Some(broadcaster) = state.channel_broadcasts.get(&message.channel_id) {
        let _ = broadcaster.send(WsServerMessage::ReactionAdded {
            message_id,
            channel_id: message.channel_id,
            user_id,
            emoji: emoji.to_string(),
        });
    }
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
    let message = match queries::find_message_by_id(&state.db, message_id).await {
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
    match queries::remove_reaction(&state.db, message_id, user_id, emoji).await {
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
    if let Some(broadcaster) = state.channel_broadcasts.get(&message.channel_id) {
        let _ = broadcaster.send(WsServerMessage::ReactionRemoved {
            message_id,
            channel_id: message.channel_id,
            user_id,
            emoji: emoji.to_string(),
        });
    }
}

/// Broadcast a presence update (online/offline) to all channels the user belongs to,
/// and track the state in Redis for multi-instance queries.
async fn broadcast_presence(user_id: Uuid, status: &str, state: &AppState) {
    // Update Redis presence set
    let redis_key = "haven:online";
    let mut redis = state.redis.clone();
    let redis_result: Result<(), _> = if status == "online" {
        redis::cmd("SADD")
            .arg(redis_key)
            .arg(user_id.to_string())
            .query_async(&mut redis)
            .await
    } else {
        redis::cmd("SREM")
            .arg(redis_key)
            .arg(user_id.to_string())
            .query_async(&mut redis)
            .await
    };
    if let Err(e) = redis_result {
        tracing::warn!("Failed to update presence in Redis: {}", e);
    }

    // Get all channels this user belongs to and broadcast
    let channel_ids = match queries::get_user_channel_ids(&state.db, user_id).await {
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

    for channel_id in channel_ids {
        if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
            let _ = broadcaster.send(msg.clone());
        }
    }
}
