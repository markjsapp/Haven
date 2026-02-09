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
    if let Some(mut conns) = state.connections.get_mut(&user_id) {
        conns.retain(|sender| !sender.is_closed());
        if conns.is_empty() {
            drop(conns);
            state.connections.remove(&user_id);
        }
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
        } => {
            handle_send_message(
                user_id,
                channel_id,
                &sender_token,
                &encrypted_body,
                expires_at,
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

        WsClientMessage::Typing { channel_id } => {
            handle_typing(user_id, channel_id, state).await;
        }

        WsClientMessage::Ping => {
            let _ = reply_tx.send(WsServerMessage::Pong);
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

    // Persist message
    let message = match queries::insert_message(
        &state.db,
        channel_id,
        &sender_token_bytes,
        &encrypted_body_bytes,
        expires_at,
        false,
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
    // Generate an ephemeral token so clients can deduplicate
    // without the server revealing who is typing
    let ephemeral = Uuid::new_v4().to_string();

    if let Some(broadcaster) = state.channel_broadcasts.get(&channel_id) {
        let _ = broadcaster.send(WsServerMessage::UserTyping {
            channel_id,
            ephemeral_token: ephemeral,
        });
    }
}
