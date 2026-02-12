use std::sync::Arc;

use axum::{
    body::Body,
    http::{header, Method, Request, StatusCode},
    Router,
};
use dashmap::DashMap;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use base64::Engine;
use haven_backend::{build_router, config::AppConfig, AppState};

/// Test helper that wraps a fully-built Haven router.
///
/// Each test gets a fresh database via `#[sqlx::test]`, so no data leaks between tests.
/// Redis is shared but keyed by unique user/token, so no conflicts.
pub struct TestApp {
    state: AppState,
}

impl TestApp {
    /// Build a TestApp from the pool provided by `#[sqlx::test]`.
    pub async fn new(pool: PgPool) -> Self {
        let config = AppConfig {
            host: "127.0.0.1".into(),
            port: 0,
            database_url: String::new(),
            db_max_connections: 5,
            redis_url: "redis://127.0.0.1:6379".into(),
            jwt_secret: "test-jwt-secret-that-is-long-enough-for-hmac".into(),
            jwt_expiry_hours: 24,
            refresh_token_expiry_days: 30,
            storage_dir: "/tmp/haven-test-storage".into(),
            storage_encryption_key: "0".repeat(64),
            max_requests_per_minute: 10000,
            max_ws_connections_per_user: 10,
            max_upload_size_bytes: 10_000_000,
        };

        std::fs::create_dir_all(&config.storage_dir).ok();

        let storage_key: [u8; 32] = [0u8; 32];

        let redis_client = redis::Client::open(config.redis_url.as_str())
            .expect("Failed to create Redis client");
        let redis = redis::aio::ConnectionManager::new(redis_client)
            .await
            .expect("Failed to connect to Redis — is docker-compose up?");

        let state = AppState {
            db: pool,
            redis,
            config,
            storage_key,
            connections: Arc::new(DashMap::new()),
            channel_broadcasts: Arc::new(DashMap::new()),
        };

        TestApp { state }
    }

    /// Get a fresh clone of the router for a `oneshot` request.
    fn router(&self) -> Router {
        build_router(self.state.clone())
    }

    // ── Request helpers ──────────────────────────────────

    /// Send a request through the router and return (status, body as Value).
    pub async fn request(
        &self,
        method: Method,
        uri: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let body_bytes = body
            .map(|v| serde_json::to_vec(&v).unwrap())
            .unwrap_or_default();

        let mut builder = Request::builder().method(method).uri(uri);

        if let Some(t) = token {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {}", t));
        }

        if !body_bytes.is_empty() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }

        let req = builder.body(Body::from(body_bytes)).unwrap();

        let response = self.router().oneshot(req).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();

        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::String(
                String::from_utf8_lossy(&bytes).to_string(),
            ))
        };

        (status, value)
    }

    /// Typed response helper — deserializes into T.
    pub async fn request_typed<T: DeserializeOwned>(
        &self,
        method: Method,
        uri: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> (StatusCode, T) {
        let (status, value) = self.request(method, uri, token, body).await;
        let typed: T = serde_json::from_value(value).expect("Failed to deserialize response body");
        (status, typed)
    }

    // ── High-level helpers ───────────────────────────────

    /// Register a new user with dummy crypto keys. Returns (access_token, user_id).
    pub async fn register_user(&self, username: &str) -> (String, Uuid) {
        let b64 = &base64::engine::general_purpose::STANDARD;
        let fake_key = b64.encode([0u8; 32]);
        let fake_sig = b64.encode([0u8; 64]);

        let body = json!({
            "username": username,
            "password": "testpassword123",
            "identity_key": fake_key,
            "signed_prekey": fake_key,
            "signed_prekey_signature": fake_sig,
            "one_time_prekeys": []
        });

        let (status, value) = self.request(Method::POST, "/api/v1/auth/register", None, Some(body)).await;

        assert_eq!(status, StatusCode::OK, "Registration failed: {}", value);

        let token = value["access_token"].as_str().unwrap().to_string();
        let user_id = Uuid::parse_str(value["user"]["id"].as_str().unwrap()).unwrap();
        (token, user_id)
    }

    /// Login an existing user. Returns (access_token, refresh_token, user_id).
    pub async fn login_user(&self, username: &str) -> (String, String, Uuid) {
        let body = json!({
            "username": username,
            "password": "testpassword123",
        });

        let (status, value) = self.request(Method::POST, "/api/v1/auth/login", None, Some(body)).await;

        assert_eq!(status, StatusCode::OK, "Login failed: {}", value);

        let access = value["access_token"].as_str().unwrap().to_string();
        let refresh = value["refresh_token"].as_str().unwrap().to_string();
        let user_id = Uuid::parse_str(value["user"]["id"].as_str().unwrap()).unwrap();
        (access, refresh, user_id)
    }

    /// Create a server and return (server_id).
    pub async fn create_server(&self, token: &str, name: &str) -> Uuid {
        let b64 = &base64::engine::general_purpose::STANDARD;
        let meta_json = serde_json::to_string(&json!({"name": name})).unwrap();
        let body = json!({ "encrypted_meta": b64.encode(meta_json.as_bytes()) });

        let (status, value) = self
            .request(Method::POST, "/api/v1/servers", Some(token), Some(body))
            .await;

        assert_eq!(status, StatusCode::OK, "Create server failed: {}", value);

        Uuid::parse_str(value["id"].as_str().unwrap()).unwrap()
    }

    /// Create a channel in a server and return (channel_id).
    pub async fn create_channel(&self, token: &str, server_id: Uuid, name: &str) -> Uuid {
        let b64 = &base64::engine::general_purpose::STANDARD;
        let body = json!({ "encrypted_meta": b64.encode(name.as_bytes()) });
        let uri = format!("/api/v1/servers/{}/channels", server_id);

        let (status, value) = self
            .request(Method::POST, &uri, Some(token), Some(body))
            .await;

        assert_eq!(status, StatusCode::OK, "Create channel failed: {}", value);

        Uuid::parse_str(value["id"].as_str().unwrap()).unwrap()
    }

    /// Invite a user to a server and have them join. Returns the invite code.
    pub async fn invite_and_join(&self, owner_token: &str, joiner_token: &str, server_id: Uuid) -> String {
        let inv_uri = format!("/api/v1/servers/{}/invites", server_id);
        let (status, inv_val) = self
            .request(
                Method::POST,
                &inv_uri,
                Some(owner_token),
                Some(json!({ "expires_in_hours": 24 })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "Create invite failed: {}", inv_val);
        let code = inv_val["code"].as_str().unwrap().to_string();

        let join_uri = format!("/api/v1/invites/{}/join", code);
        let (status, _) = self
            .request(Method::POST, &join_uri, Some(joiner_token), None)
            .await;
        assert_eq!(status, StatusCode::OK, "Join via invite failed");

        code
    }

    /// Send a message to a channel via REST and return (message_id, response_value).
    pub async fn send_message(&self, token: &str, channel_id: Uuid) -> (Uuid, Value) {
        let b64 = &base64::engine::general_purpose::STANDARD;
        let body = json!({
            "channel_id": channel_id,
            "sender_token": b64.encode(b"test-sender-token"),
            "encrypted_body": b64.encode(b"test-encrypted-body"),
            "has_attachments": false
        });
        let uri = format!("/api/v1/channels/{}/messages", channel_id);
        let (status, value) = self.request(Method::POST, &uri, Some(token), Some(body)).await;
        assert_eq!(status, StatusCode::OK, "Send message failed: {}", value);
        let msg_id = Uuid::parse_str(value["id"].as_str().unwrap()).unwrap();
        (msg_id, value)
    }

    /// Send a message with a reply_to_id.
    pub async fn send_reply(&self, token: &str, channel_id: Uuid, reply_to_id: Uuid) -> (Uuid, Value) {
        let b64 = &base64::engine::general_purpose::STANDARD;
        let body = json!({
            "channel_id": channel_id,
            "sender_token": b64.encode(b"test-sender-token"),
            "encrypted_body": b64.encode(b"test-reply-body"),
            "has_attachments": false,
            "reply_to_id": reply_to_id
        });
        let uri = format!("/api/v1/channels/{}/messages", channel_id);
        let (status, value) = self.request(Method::POST, &uri, Some(token), Some(body)).await;
        assert_eq!(status, StatusCode::OK, "Send reply failed: {}", value);
        let msg_id = Uuid::parse_str(value["id"].as_str().unwrap()).unwrap();
        (msg_id, value)
    }

    /// Make two users friends. Returns friendship_id.
    pub async fn make_friends(&self, token_a: &str, token_b: &str, username_b: &str) -> Uuid {
        let (_, value) = self
            .request(
                Method::POST,
                "/api/v1/friends/request",
                Some(token_a),
                Some(json!({ "username": username_b })),
            )
            .await;
        let friendship_id = Uuid::parse_str(value["id"].as_str().unwrap()).unwrap();

        let accept_uri = format!("/api/v1/friends/{}/accept", friendship_id);
        let (status, _) = self
            .request(Method::POST, &accept_uri, Some(token_b), None)
            .await;
        assert_eq!(status, StatusCode::OK, "Accept friend request failed");

        friendship_id
    }

    /// Send raw bytes as a request body (for attachment upload).
    pub async fn request_bytes(
        &self,
        method: Method,
        uri: &str,
        token: Option<&str>,
        body_bytes: Vec<u8>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder().method(method).uri(uri);

        if let Some(t) = token {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {}", t));
        }
        builder = builder.header(header::CONTENT_TYPE, "application/octet-stream");

        let req = builder.body(Body::from(body_bytes)).unwrap();

        let response = self.router().oneshot(req).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();

        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::String(
                String::from_utf8_lossy(&bytes).to_string(),
            ))
        };

        (status, value)
    }
}
