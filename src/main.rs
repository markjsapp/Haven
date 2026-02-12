use std::sync::Arc;

use dashmap::DashMap;
use sqlx::PgPool;

use haven_backend::{build_router, config::AppConfig, db, AppState};

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

    // Clear stale presence from previous server runs
    {
        let mut redis_cleanup = redis.clone();
        let _: Result<(), redis::RedisError> = redis::cmd("DEL")
            .arg("haven:presence")
            .query_async(&mut redis_cleanup)
            .await;
        tracing::info!("Cleared stale presence entries");
    }

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
