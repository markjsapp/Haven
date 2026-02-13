pub mod queries;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

use crate::config::AppConfig;

/// Wraps primary and optional replica database pools.
/// Read queries go to the replica (if available), writes always go to primary.
#[derive(Clone)]
pub struct DbPools {
    primary: PgPool,
    replica: Option<PgPool>,
}

impl DbPools {
    /// Initialize pools from config. Runs migrations on the primary.
    pub async fn init(config: &AppConfig) -> Self {
        let primary = PgPoolOptions::new()
            .max_connections(config.db_max_connections)
            .connect(&config.database_url)
            .await
            .expect("Failed to connect to PostgreSQL (primary)");

        // Run migrations on primary only
        sqlx::migrate!("./migrations")
            .run(&primary)
            .await
            .expect("Failed to run database migrations");

        tracing::info!("Primary database connected and migrations applied");

        let replica = if config.database_replica_url.is_empty() {
            None
        } else {
            let pool = PgPoolOptions::new()
                .max_connections(config.db_max_connections)
                .connect(&config.database_replica_url)
                .await
                .expect("Failed to connect to PostgreSQL (replica)");
            tracing::info!("Read replica connected");
            Some(pool)
        };

        Self { primary, replica }
    }

    /// Read queries — returns replica if available, else primary.
    pub fn read(&self) -> &PgPool {
        self.replica.as_ref().unwrap_or(&self.primary)
    }

    /// Write queries — always primary.
    pub fn write(&self) -> &PgPool {
        &self.primary
    }

    /// Direct access to primary (for migrations, background workers, etc).
    pub fn primary(&self) -> &PgPool {
        &self.primary
    }

    /// Single-pool constructor for tests (no replica).
    pub fn from_single(pool: PgPool) -> Self {
        Self {
            primary: pool,
            replica: None,
        }
    }
}

/// Initialize a single database connection pool and run migrations.
/// Kept for backward compatibility; prefer `DbPools::init` for production.
pub async fn init_pool(config: &AppConfig) -> PgPool {
    let pool = PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run database migrations");

    tracing::info!("Database connected and migrations applied");
    pool
}
