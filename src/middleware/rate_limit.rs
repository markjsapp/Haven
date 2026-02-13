use std::net::IpAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::{ConnectInfo, Request},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use dashmap::DashMap;

/// Per-IP rate limiter using a sliding window counter.
#[derive(Clone)]
pub struct RateLimiter {
    /// IP -> (request count, window start)
    state: Arc<DashMap<IpAddr, (u32, Instant)>>,
    max_requests: u32,
    window_secs: u64,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            state: Arc::new(DashMap::new()),
            max_requests,
            window_secs,
        }
    }

    /// Returns true if the request should be allowed.
    pub fn check(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut entry = self.state.entry(ip).or_insert((0, now));
        let (count, window_start) = entry.value_mut();

        // Reset window if expired
        if now.duration_since(*window_start).as_secs() >= self.window_secs {
            *count = 0;
            *window_start = now;
        }

        *count += 1;
        *count <= self.max_requests
    }

    /// Periodic cleanup of expired entries to prevent unbounded growth.
    pub fn cleanup(&self) {
        let now = Instant::now();
        self.state.retain(|_, (_, window_start)| {
            now.duration_since(*window_start).as_secs() < self.window_secs * 2
        });
    }
}

/// Middleware that enforces rate limits. Returns 429 if limit exceeded.
pub async fn rate_limit_middleware(
    rate_limiter: RateLimiter,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Try to extract the client IP from ConnectInfo, X-Forwarded-For, or fallback
    let ip = req
        .extensions()
        .get::<ConnectInfo<std::net::SocketAddr>>()
        .map(|ci| ci.0.ip())
        .or_else(|| {
            req.headers()
                .get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.split(',').next())
                .and_then(|s| s.trim().parse().ok())
        })
        .unwrap_or(IpAddr::from([127, 0, 0, 1]));

    if !rate_limiter.check(ip) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    Ok(next.run(req).await)
}

/// Spawn a background task that cleans up stale rate limit entries every 5 minutes.
pub fn spawn_rate_limit_cleanup(limiter: RateLimiter) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            limiter.cleanup();
        }
    });
}
