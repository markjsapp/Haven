mod api;
mod auth;
mod config;
mod crypto;
mod db;
mod errors;
mod middleware;
mod models;
mod permissions;
mod storage;
mod ws;

use std::sync::Arc;

use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, post, put},
    Router,
};
use dashmap::DashMap;
use sqlx::PgPool;
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

use config::AppConfig;
use ws::{ChannelBroadcastMap, ConnectionMap};

// ─── Application State ─────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: redis::aio::ConnectionManager,
    pub config: AppConfig,
    pub storage_key: [u8; 32],
    pub connections: ConnectionMap,
    pub channel_broadcasts: ChannelBroadcastMap,
}

// ─── Main ──────────────────────────────────────────────

#[tokio::main]
async fn main() {
    // Load .env file if present
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "haven_backend=debug,tower_http=debug".into()),
        )
        .json()
        .init();

    // Load configuration
    let config = AppConfig::from_env();
    tracing::info!("Starting Haven backend on {}:{}", config.host, config.port);

    // Initialize database
    let db = db::init_pool(&config).await;

    // Initialize Redis
    let redis_client = redis::Client::open(config.redis_url.as_str())
        .expect("Failed to create Redis client");
    let redis = redis::aio::ConnectionManager::new(redis_client)
        .await
        .expect("Failed to connect to Redis");
    tracing::info!("Redis connected");

    // Initialize local file storage
    std::fs::create_dir_all(&config.storage_dir)
        .expect("Failed to create storage directory");
    let storage_key_bytes = hex::decode(&config.storage_encryption_key)
        .expect("STORAGE_ENCRYPTION_KEY must be valid hex");
    let storage_key: [u8; 32] = storage_key_bytes
        .try_into()
        .expect("STORAGE_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)");
    tracing::info!("Local storage initialized at {}", config.storage_dir);

    // Build application state
    let state = AppState {
        db: db.clone(),
        redis,
        config: config.clone(),
        storage_key,
        connections: Arc::new(DashMap::new()),
        channel_broadcasts: Arc::new(DashMap::new()),
    };

    // Spawn background workers
    spawn_background_workers(db.clone());

    // Build router
    let app = build_router(state);

    // Start server
    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind to address");

    tracing::info!("Haven backend listening on {}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("Server error");

    tracing::info!("Haven backend shut down gracefully");
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("Received Ctrl+C, shutting down..."),
        _ = terminate => tracing::info!("Received SIGTERM, shutting down..."),
    }
}

// ─── Router ────────────────────────────────────────────

fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any) // TODO: Restrict in production
        .allow_methods(Any)
        .allow_headers(Any);

    // Auth routes (no authentication required)
    let auth_routes = Router::new()
        .route("/register", post(api::auth_routes::register))
        .route("/login", post(api::auth_routes::login))
        .route("/refresh", post(api::auth_routes::refresh_token));

    // Auth routes (authentication required)
    let auth_protected = Router::new()
        .route("/logout", post(api::auth_routes::logout))
        .route("/totp/setup", post(api::auth_routes::totp_setup))
        .route("/totp/verify", post(api::auth_routes::totp_verify))
        .route("/totp", delete(api::auth_routes::totp_disable));

    // Key management routes
    let key_routes = Router::new()
        .route("/identity", put(api::keys::update_identity_keys))
        .route("/prekeys", post(api::keys::upload_prekeys))
        .route("/prekeys/count", get(api::keys::prekey_count));

    // User routes
    let user_routes = Router::new()
        .route("/:user_id/keys", get(api::keys::get_key_bundle))
        .route("/:user_id/profile", get(api::users::get_profile))
        .route(
            "/:user_id/block",
            post(api::users::block_user).delete(api::users::unblock_user),
        )
        .route("/search", get(api::users::get_user_by_username))
        .route("/profile", put(api::users::update_profile))
        .route("/blocked", get(api::users::get_blocked_users));

    // Server routes
    let server_routes = Router::new()
        .route("/", get(api::servers::list_servers))
        .route("/", post(api::servers::create_server))
        .route("/:server_id", get(api::servers::get_server))
        .route(
            "/:server_id/channels",
            get(api::servers::list_server_channels),
        )
        .route(
            "/:server_id/channels",
            post(api::channels::create_channel),
        )
        .route(
            "/:server_id/categories",
            get(api::categories::list_categories)
                .post(api::categories::create_category),
        )
        // reorder MUST come before /:category_id to avoid param collision
        .route(
            "/:server_id/categories/reorder",
            put(api::categories::reorder_categories),
        )
        .route(
            "/:server_id/categories/:category_id",
            put(api::categories::update_category)
                .delete(api::categories::delete_category),
        )
        .route(
            "/:server_id/invites",
            get(api::invites::list_invites),
        )
        .route(
            "/:server_id/invites",
            post(api::invites::create_invite),
        )
        .route(
            "/:server_id/invites/:invite_id",
            delete(api::invites::delete_invite),
        )
        .route(
            "/:server_id/members",
            get(api::invites::list_members),
        )
        .route(
            "/:server_id/members/:user_id",
            delete(api::invites::kick_member),
        )
        .route(
            "/:server_id/roles",
            get(api::roles::list_roles).post(api::roles::create_role),
        )
        .route(
            "/:server_id/roles/:role_id",
            put(api::roles::update_role).delete(api::roles::delete_role),
        )
        .route(
            "/:server_id/members/:user_id/roles",
            put(api::roles::assign_role),
        )
        .route(
            "/:server_id/members/:user_id/roles/:role_id",
            delete(api::roles::unassign_role),
        );

    // Channel routes
    let channel_routes = Router::new()
        .route("/:channel_id", put(api::channels::update_channel))
        .route("/:channel_id", delete(api::channels::delete_channel))
        .route("/:channel_id/join", post(api::channels::join_channel))
        .route("/:channel_id/category", put(api::categories::set_channel_category))
        .route(
            "/:channel_id/overwrites",
            get(api::roles::list_overwrites).put(api::roles::set_overwrite),
        )
        .route(
            "/:channel_id/overwrites/:target_type/:target_id",
            delete(api::roles::delete_overwrite),
        )
        .route(
            "/:channel_id/messages",
            get(api::messages::get_messages),
        )
        .route(
            "/:channel_id/messages",
            post(api::messages::send_message),
        )
        .route(
            "/:channel_id/sender-keys",
            get(api::sender_keys::get_sender_keys)
                .post(api::sender_keys::distribute_sender_keys),
        )
        .route(
            "/:channel_id/members/keys",
            get(api::sender_keys::get_channel_member_keys),
        )
        .route(
            "/:channel_id/reactions",
            get(api::messages::get_channel_reactions),
        );

    // Friend routes
    let friend_routes = Router::new()
        .route("/", get(api::friends::list_friends))
        .route("/request", post(api::friends::send_friend_request))
        .route("/:friendship_id/accept", post(api::friends::accept_friend_request))
        .route("/:friendship_id/decline", post(api::friends::decline_friend_request))
        .route("/:friendship_id", delete(api::friends::remove_friend));

    // DM routes
    let dm_routes = Router::new()
        .route("/", get(api::channels::list_dm_channels))
        .route("/", post(api::channels::create_dm))
        .route("/requests", get(api::friends::list_dm_requests))
        .route("/:channel_id/request", post(api::friends::handle_dm_request));

    // Invite join route (standalone, not nested under servers)
    let invite_routes = Router::new()
        .route("/:code/join", post(api::invites::join_by_invite));

    // Attachment routes (with increased body limit for file uploads)
    let attachment_routes = Router::new()
        .route("/upload", post(api::attachments::upload))
        .route("/:attachment_id", get(api::attachments::download))
        .layer(DefaultBodyLimit::max(state.config.max_upload_size_bytes as usize));

    // Link preview (authenticated — rate limited to prevent abuse)
    let link_preview_routes = Router::new()
        .route("/link-preview", get(api::link_preview::fetch_link_preview));

    // Presence routes
    let presence_routes = Router::new()
        .route("/presence", get(api::presence::get_presence));

    // DM privacy route
    let dm_privacy_routes = Router::new()
        .route("/users/dm-privacy", put(api::friends::update_dm_privacy));

    // Assemble the full API
    let api = Router::new()
        .nest("/auth", auth_routes.merge(auth_protected))
        .nest("/keys", key_routes)
        .nest("/users", user_routes)
        .nest("/servers", server_routes)
        .nest("/channels", channel_routes)
        .nest("/dm", dm_routes)
        .nest("/friends", friend_routes)
        .nest("/invites", invite_routes)
        .nest("/attachments", attachment_routes)
        .merge(link_preview_routes)
        .merge(presence_routes)
        .merge(dm_privacy_routes);

    Router::new()
        .route("/api/v1/ws", get(ws::ws_handler))
        .nest("/api/v1", api)
        .route("/health", get(health_check))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

/// Health check endpoint
async fn health_check() -> &'static str {
    "ok"
}

// ─── Background Workers ────────────────────────────────

fn spawn_background_workers(pool: PgPool) {
    let pool2 = pool.clone();

    // Worker: Purge expired messages every 60 seconds
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            match db::queries::purge_expired_messages(&pool).await {
                Ok(count) if count > 0 => {
                    tracing::info!("Purged {} expired messages", count);
                }
                Err(e) => {
                    tracing::error!("Failed to purge expired messages: {}", e);
                }
                _ => {}
            }
        }
    });

    // Worker: Purge expired refresh tokens every 5 minutes
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            match db::queries::purge_expired_refresh_tokens(&pool2).await {
                Ok(count) if count > 0 => {
                    tracing::info!("Purged {} expired refresh tokens", count);
                }
                Err(e) => {
                    tracing::error!("Failed to purge expired refresh tokens: {}", e);
                }
                _ => {}
            }
        }
    });
}
