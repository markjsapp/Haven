pub mod queries;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

use crate::config::AppConfig;

/// Initialize the database connection pool and run migrations.
pub async fn init_pool(config: &AppConfig) -> PgPool {
    let pool = PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    // Run embedded migrations
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run database migrations");

    tracing::info!("Database connected and migrations applied");
    pool
}
