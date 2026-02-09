mod api;
mod auth;
mod config;
mod crypto;
mod db;
mod errors;
mod middleware;
mod models;
mod ws;

use std::sync::Arc;

use axum::{
    routing::{delete, get, post},
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
    pub s3_client: aws_sdk_s3::Client,
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

    // Initialize S3/MinIO client
    let s3_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .endpoint_url(&config.s3_endpoint)
        .region(aws_config::Region::new(config.s3_region.clone()))
        .credentials_provider(aws_credential_types::Credentials::new(
            &config.s3_access_key,
            &config.s3_secret_key,
            None,
            None,
            "haven-static",
        ))
        .load()
        .await;

    let s3_client = aws_sdk_s3::Client::new(&s3_config);
    tracing::info!("S3/MinIO client initialized");

    // Build application state
    let state = AppState {
        db: db.clone(),
        redis,
        config: config.clone(),
        s3_client,
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
        .route("/prekeys", post(api::keys::upload_prekeys))
        .route("/prekeys/count", get(api::keys::prekey_count));

    // User routes
    let user_routes = Router::new()
        .route("/:user_id/keys", get(api::keys::get_key_bundle))
        .route("/search", get(api::users::get_user_by_username));

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
        );

    // Channel routes
    let channel_routes = Router::new()
        .route("/:channel_id/join", post(api::channels::join_channel))
        .route(
            "/:channel_id/messages",
            get(api::messages::get_messages),
        )
        .route(
            "/:channel_id/messages",
            post(api::messages::send_message),
        );

    // DM routes
    let dm_routes = Router::new()
        .route("/", get(api::channels::list_dm_channels))
        .route("/", post(api::channels::create_dm));

    // Attachment routes
    let attachment_routes = Router::new()
        .route("/upload", post(api::attachments::request_upload))
        .route("/:attachment_id", get(api::attachments::request_download));

    // Assemble the full API
    let api = Router::new()
        .nest("/auth", auth_routes.merge(auth_protected))
        .nest("/keys", key_routes)
        .nest("/users", user_routes)
        .nest("/servers", server_routes)
        .nest("/channels", channel_routes)
        .nest("/dm", dm_routes)
        .nest("/attachments", attachment_routes);

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
