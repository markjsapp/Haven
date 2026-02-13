use std::env;

#[derive(Clone, Debug)]
pub struct AppConfig {
    // Server
    pub host: String,
    pub port: u16,

    // Database
    pub database_url: String,
    pub database_replica_url: String, // empty = no replica, all queries go to primary
    pub db_max_connections: u32,

    // Redis
    pub redis_url: String,

    // JWT
    pub jwt_secret: String,
    pub jwt_expiry_hours: i64,
    pub refresh_token_expiry_days: i64,

    // Storage
    pub storage_backend: String, // "local" or "s3"
    pub storage_dir: String,
    pub storage_encryption_key: String, // 64-char hex → 32-byte AES-256-GCM key

    // S3 (only needed when storage_backend = "s3")
    pub s3_endpoint: String,
    pub s3_bucket: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub s3_region: String,

    // CORS — comma-separated list of allowed origins (e.g. "http://localhost:5173,https://app.haven.example")
    pub cors_origins: String,

    // Rate Limiting
    pub max_requests_per_minute: u32,
    pub max_ws_connections_per_user: u32,

    // WebSocket
    pub broadcast_channel_capacity: usize,

    // File Upload
    pub max_upload_size_bytes: u64,

    // CDN — optional, disabled by default
    pub cdn_enabled: bool,
    pub cdn_base_url: String,          // e.g. "https://cdn.haven.example"
    pub cdn_presign_expiry_secs: u64,  // default 3600

    // LiveKit (voice channels) — all optional, voice disabled if empty
    pub livekit_url: String,
    pub livekit_api_key: String,
    pub livekit_api_secret: String,
}

impl AppConfig {
    /// Returns true if LiveKit voice is configured.
    pub fn livekit_enabled(&self) -> bool {
        !self.livekit_url.is_empty()
            && !self.livekit_api_key.is_empty()
            && !self.livekit_api_secret.is_empty()
    }

    /// Config with test-appropriate defaults (no env vars needed).
    #[cfg(test)]
    pub fn test_default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 0,
            database_url: String::new(), // not used — pool comes from #[sqlx::test]
            database_replica_url: String::new(),
            db_max_connections: 5,
            redis_url: "redis://127.0.0.1:6379".into(),
            jwt_secret: "test-jwt-secret-that-is-long-enough-for-hmac".into(),
            jwt_expiry_hours: 24,
            refresh_token_expiry_days: 30,
            storage_backend: "local".into(),
            storage_dir: "/tmp/haven-test-storage".into(),
            storage_encryption_key: "0".repeat(64), // 32 zero bytes in hex
            s3_endpoint: String::new(),
            s3_bucket: String::new(),
            s3_access_key: String::new(),
            s3_secret_key: String::new(),
            s3_region: String::new(),
            cors_origins: "*".into(),
            max_requests_per_minute: 1000,
            max_ws_connections_per_user: 10,
            broadcast_channel_capacity: 4096,
            max_upload_size_bytes: 10_000_000,
            cdn_enabled: false,
            cdn_base_url: String::new(),
            cdn_presign_expiry_secs: 3600,
            livekit_url: String::new(),
            livekit_api_key: String::new(),
            livekit_api_secret: String::new(),
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
            database_replica_url: env::var("DATABASE_REPLICA_URL").unwrap_or_default(),
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

            storage_backend: env::var("STORAGE_BACKEND")
                .unwrap_or_else(|_| "local".into()),
            storage_dir: env::var("STORAGE_DIR")
                .unwrap_or_else(|_| "./data/attachments".into()),
            storage_encryption_key: env::var("STORAGE_ENCRYPTION_KEY")
                .expect("STORAGE_ENCRYPTION_KEY must be set (64-char hex string)"),
            s3_endpoint: env::var("S3_ENDPOINT").unwrap_or_default(),
            s3_bucket: env::var("S3_BUCKET").unwrap_or_default(),
            s3_access_key: env::var("S3_ACCESS_KEY").unwrap_or_default(),
            s3_secret_key: env::var("S3_SECRET_KEY").unwrap_or_default(),
            s3_region: env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into()),

            cors_origins: env::var("CORS_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:5173".into()),

            max_requests_per_minute: env::var("MAX_REQUESTS_PER_MINUTE")
                .unwrap_or_else(|_| "120".into())
                .parse()
                .unwrap_or(120),
            max_ws_connections_per_user: env::var("MAX_WS_CONNECTIONS_PER_USER")
                .unwrap_or_else(|_| "5".into())
                .parse()
                .unwrap_or(5),

            broadcast_channel_capacity: env::var("BROADCAST_CHANNEL_CAPACITY")
                .unwrap_or_else(|_| "4096".into())
                .parse()
                .unwrap_or(4096),

            max_upload_size_bytes: env::var("MAX_UPLOAD_SIZE_BYTES")
                .unwrap_or_else(|_| "524288000".into()) // 500MB
                .parse()
                .unwrap_or(524_288_000),

            cdn_enabled: env::var("CDN_ENABLED")
                .unwrap_or_else(|_| "false".into())
                .parse()
                .unwrap_or(false),
            cdn_base_url: env::var("CDN_BASE_URL").unwrap_or_default(),
            cdn_presign_expiry_secs: env::var("CDN_PRESIGN_EXPIRY_SECS")
                .unwrap_or_else(|_| "3600".into())
                .parse()
                .unwrap_or(3600),

            livekit_url: env::var("LIVEKIT_URL").unwrap_or_default(),
            livekit_api_key: env::var("LIVEKIT_API_KEY").unwrap_or_default(),
            livekit_api_secret: env::var("LIVEKIT_API_SECRET").unwrap_or_default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_has_sensible_values() {
        let config = AppConfig::test_default();
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 0);
        assert_eq!(config.db_max_connections, 5);
        assert_eq!(config.jwt_expiry_hours, 24);
        assert_eq!(config.refresh_token_expiry_days, 30);
        assert_eq!(config.storage_backend, "local");
        assert_eq!(config.cors_origins, "*");
        assert_eq!(config.max_ws_connections_per_user, 10);
        assert_eq!(config.broadcast_channel_capacity, 4096);
        assert!(!config.cdn_enabled);
    }

    #[test]
    fn livekit_enabled_when_all_set() {
        let mut config = AppConfig::test_default();
        config.livekit_url = "wss://lk.example.com".into();
        config.livekit_api_key = "key".into();
        config.livekit_api_secret = "secret".into();
        assert!(config.livekit_enabled());
    }

    #[test]
    fn livekit_disabled_when_url_empty() {
        let mut config = AppConfig::test_default();
        config.livekit_url = String::new();
        config.livekit_api_key = "key".into();
        config.livekit_api_secret = "secret".into();
        assert!(!config.livekit_enabled());
    }

    #[test]
    fn livekit_disabled_when_key_empty() {
        let mut config = AppConfig::test_default();
        config.livekit_url = "wss://lk.example.com".into();
        config.livekit_api_key = String::new();
        config.livekit_api_secret = "secret".into();
        assert!(!config.livekit_enabled());
    }

    #[test]
    fn livekit_disabled_when_secret_empty() {
        let mut config = AppConfig::test_default();
        config.livekit_url = "wss://lk.example.com".into();
        config.livekit_api_key = "key".into();
        config.livekit_api_secret = String::new();
        assert!(!config.livekit_enabled());
    }

    #[test]
    fn livekit_disabled_by_default() {
        let config = AppConfig::test_default();
        assert!(!config.livekit_enabled());
    }
}
