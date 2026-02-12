use std::env;

#[derive(Clone, Debug)]
pub struct AppConfig {
    // Server
    pub host: String,
    pub port: u16,

    // Database
    pub database_url: String,
    pub db_max_connections: u32,

    // Redis
    pub redis_url: String,

    // JWT
    pub jwt_secret: String,
    pub jwt_expiry_hours: i64,
    pub refresh_token_expiry_days: i64,

    // Local file storage
    pub storage_dir: String,
    pub storage_encryption_key: String, // 64-char hex → 32-byte AES-256-GCM key

    // S3 (uncomment fields when deploying to production)
    // pub s3_endpoint: String,
    // pub s3_bucket: String,
    // pub s3_access_key: String,
    // pub s3_secret_key: String,
    // pub s3_region: String,

    // Rate Limiting
    pub max_requests_per_minute: u32,
    pub max_ws_connections_per_user: u32,

    // File Upload
    pub max_upload_size_bytes: u64,
}

impl AppConfig {
    /// Config with test-appropriate defaults (no env vars needed).
    #[cfg(test)]
    pub fn test_default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 0,
            database_url: String::new(), // not used — pool comes from #[sqlx::test]
            db_max_connections: 5,
            redis_url: "redis://127.0.0.1:6379".into(),
            jwt_secret: "test-jwt-secret-that-is-long-enough-for-hmac".into(),
            jwt_expiry_hours: 24,
            refresh_token_expiry_days: 30,
            storage_dir: "/tmp/haven-test-storage".into(),
            storage_encryption_key: "0".repeat(64), // 32 zero bytes in hex
            max_requests_per_minute: 1000,
            max_ws_connections_per_user: 10,
            max_upload_size_bytes: 10_000_000,
        }
    }

    pub fn from_env() -> Self {
        Self {
            host: env::var("HAVEN_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: env::var("HAVEN_PORT")
                .unwrap_or_else(|_| "8080".into())
                .parse()
                .expect("HAVEN_PORT must be a valid u16"),

            database_url: env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
            db_max_connections: env::var("DB_MAX_CONNECTIONS")
                .unwrap_or_else(|_| "50".into())
                .parse()
                .unwrap_or(50),

            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),

            jwt_secret: env::var("JWT_SECRET")
                .expect("JWT_SECRET must be set"),
            jwt_expiry_hours: env::var("JWT_EXPIRY_HOURS")
                .unwrap_or_else(|_| "24".into())
                .parse()
                .unwrap_or(24),
            refresh_token_expiry_days: env::var("REFRESH_TOKEN_EXPIRY_DAYS")
                .unwrap_or_else(|_| "30".into())
                .parse()
                .unwrap_or(30),

            storage_dir: env::var("STORAGE_DIR")
                .unwrap_or_else(|_| "./data/attachments".into()),
            storage_encryption_key: env::var("STORAGE_ENCRYPTION_KEY")
                .expect("STORAGE_ENCRYPTION_KEY must be set (64-char hex string)"),

            max_requests_per_minute: env::var("MAX_REQUESTS_PER_MINUTE")
                .unwrap_or_else(|_| "120".into())
                .parse()
                .unwrap_or(120),
            max_ws_connections_per_user: env::var("MAX_WS_CONNECTIONS_PER_USER")
                .unwrap_or_else(|_| "5".into())
                .parse()
                .unwrap_or(5),

            max_upload_size_bytes: env::var("MAX_UPLOAD_SIZE_BYTES")
                .unwrap_or_else(|_| "524288000".into()) // 500MB
                .parse()
                .unwrap_or(524_288_000),
        }
    }
}
