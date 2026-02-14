use std::sync::Arc;

use dashmap::DashMap;

use haven_backend::{
    build_router,
    config::AppConfig,
    db::{self, DbPools},
    middleware::{spawn_user_rate_limit_cleanup, UserRateLimiter},
    pubsub,
    storage::Storage,
    AppState,
};

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

    // Initialize database pools (primary + optional replica)
    let db = DbPools::init(&config).await;

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

    // Initialize storage backend (local or S3 based on config)
    let storage = Storage::from_config(&config).await;
    let storage_key = *storage.encryption_key();

    // Per-user rate limiters
    let ws_rate_limiter = UserRateLimiter::new(30, 10); // 30 messages per 10 seconds
    let api_rate_limiter = UserRateLimiter::new(30, 60); // 30 write ops per minute
    spawn_user_rate_limit_cleanup(ws_rate_limiter.clone());
    spawn_user_rate_limit_cleanup(api_rate_limiter.clone());

    // Build application state (pubsub_subscriptions added after start_subscriber)
    let mut state = AppState {
        db: db.clone(),
        redis,
        config: config.clone(),
        storage_key,
        storage,
        connections: Arc::new(DashMap::new()),
        channel_broadcasts: Arc::new(DashMap::new()),
        pubsub_subscriptions: pubsub::empty_subscriptions(),
        ws_rate_limiter,
        api_rate_limiter,
    };

    // Start Redis pub/sub subscriber and store the subscriptions handle
    state.pubsub_subscriptions = pubsub::start_subscriber(state.clone());

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

fn spawn_background_workers(db: DbPools) {
    let pool = db.primary().clone();
    let pool2 = pool.clone();
    let pool3 = pool.clone();

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

    // Worker: Ensure message partitions exist 3 months ahead (runs daily)
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(86400));
        loop {
            interval.tick().await;
            match db::queries::ensure_future_partitions(&pool3).await {
                Ok(()) => {
                    tracing::debug!("Partition maintenance completed");
                }
                Err(e) => {
                    tracing::error!("Partition maintenance failed: {}", e);
                }
            }
        }
    });
}
