use redis::AsyncCommands;
use serde::{de::DeserializeOwned, Serialize};

/// Try to get a cached value from Redis. Returns None on miss or error.
pub async fn get_cached<T: DeserializeOwned>(
    redis: &mut redis::aio::ConnectionManager,
    key: &str,
) -> Option<T> {
    let data: Option<String> = redis.get(key).await.ok()?;
    data.and_then(|s| serde_json::from_str(&s).ok())
}

/// Store a value in Redis with a TTL (in seconds). Errors are silently ignored.
pub async fn set_cached<T: Serialize>(
    redis: &mut redis::aio::ConnectionManager,
    key: &str,
    value: &T,
    ttl_secs: u64,
) {
    if let Ok(json) = serde_json::to_string(value) {
        let _: Result<(), _> = redis.set_ex(key, json, ttl_secs).await;
    }
}

/// Delete a cached key. Errors are silently ignored.
pub async fn invalidate(redis: &mut redis::aio::ConnectionManager, key: &str) {
    let _: Result<(), _> = redis.del(key).await;
}

/// Delete all keys matching a pattern via SCAN + DEL.
/// Use sparingly — SCAN is O(N) over the keyspace.
pub async fn invalidate_pattern(redis: &mut redis::aio::ConnectionManager, pattern: &str) {
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg(pattern)
        .query_async(redis)
        .await
        .unwrap_or_default();
    if !keys.is_empty() {
        let _: Result<(), _> = redis::cmd("DEL")
            .arg(&keys)
            .query_async(redis)
            .await;
    }
}
