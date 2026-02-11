use axum::{extract::Query, Json};
use regex::Regex;

use crate::errors::AppError;
use crate::models::{LinkPreviewQuery, LinkPreviewResponse};

/// Fetch Open Graph metadata from a URL for client-side link previews.
/// The client calls this before encrypting the message, so the preview
/// data is included in the E2EE payload. The server does NOT log URLs.
pub async fn fetch_link_preview(
    Query(query): Query<LinkPreviewQuery>,
) -> Result<Json<LinkPreviewResponse>, AppError> {
    let url = query.url.trim().to_string();

    // Basic URL validation
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::BadRequest("URL must start with http:// or https://".into()));
    }

    // Try oEmbed for known providers (YouTube, etc.) before scraping
    if let Some(preview) = try_oembed(&url).await {
        return Ok(Json(preview));
    }

    // Fetch with timeout and size limit
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("HTTP client error: {e}")))?;

    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|_| AppError::BadRequest("Failed to fetch URL".into()))?;

    // Only process HTML responses
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !content_type.contains("text/html") {
        return Ok(Json(LinkPreviewResponse {
            url,
            ..Default::default()
        }));
    }

    // Read body with size limit (512KB max)
    let body = response
        .text()
        .await
        .map_err(|_| AppError::BadRequest("Failed to read response body".into()))?;

    let html = if body.len() > 512 * 1024 {
        &body[..512 * 1024]
    } else {
        &body
    };

    let preview = extract_og_metadata(html, &url);
    Ok(Json(preview))
}

/// Try to fetch preview via oEmbed for known providers.
/// Returns None if the URL isn't from a supported provider or the request fails.
async fn try_oembed(url: &str) -> Option<LinkPreviewResponse> {
    let oembed_url = if is_youtube_url(url) {
        format!("https://www.youtube.com/oembed?url={}&format=json", urlencoding::encode(url))
    } else {
        return None;
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    let resp = client
        .get(&oembed_url)
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let json: serde_json::Value = resp.json().await.ok()?;

    Some(LinkPreviewResponse {
        url: url.to_string(),
        title: json["title"].as_str().map(String::from),
        description: json["author_name"].as_str().map(String::from),
        image: json["thumbnail_url"].as_str().map(String::from),
        site_name: json["provider_name"].as_str().map(String::from),
    })
}

fn is_youtube_url(url: &str) -> bool {
    let re = Regex::new(r"(?i)^https?://(www\.)?(youtube\.com|youtu\.be)/").unwrap();
    re.is_match(url)
}

/// Extract Open Graph metadata from HTML using regex.
fn extract_og_metadata(html: &str, url: &str) -> LinkPreviewResponse {
    let mut resp = LinkPreviewResponse {
        url: url.to_string(),
        ..Default::default()
    };

    // Match <meta property="og:..." content="..."> (handles both " and ' quotes)
    // Handles both property="og:X" content="Y" and content="Y" property="og:X" orderings
    let og_re = Regex::new(
        r#"(?i)<meta\s+(?:[^>]*?\s)?property\s*=\s*["']og:([^"']+)["'][^>]*?\scontent\s*=\s*["']([^"']*)["'][^>]*/?\s*>"#,
    )
    .unwrap();

    let og_re_rev = Regex::new(
        r#"(?i)<meta\s+(?:[^>]*?\s)?content\s*=\s*["']([^"']*)["'][^>]*?\sproperty\s*=\s*["']og:([^"']+)["'][^>]*/?\s*>"#,
    )
    .unwrap();

    for cap in og_re.captures_iter(html) {
        let key = cap[1].to_lowercase();
        let value = cap[2].to_string();
        match key.as_str() {
            "title" => resp.title = Some(value),
            "description" => resp.description = Some(value),
            "image" => resp.image = Some(value),
            "site_name" => resp.site_name = Some(value),
            _ => {}
        }
    }

    // Also check reversed attribute order
    for cap in og_re_rev.captures_iter(html) {
        let value = cap[1].to_string();
        let key = cap[2].to_lowercase();
        match key.as_str() {
            "title" if resp.title.is_none() => resp.title = Some(value),
            "description" if resp.description.is_none() => resp.description = Some(value),
            "image" if resp.image.is_none() => resp.image = Some(value),
            "site_name" if resp.site_name.is_none() => resp.site_name = Some(value),
            _ => {}
        }
    }

    // Fallback: <title> tag
    if resp.title.is_none() {
        let title_re = Regex::new(r"(?i)<title[^>]*>([^<]+)</title>").unwrap();
        if let Some(cap) = title_re.captures(html) {
            resp.title = Some(cap[1].trim().to_string());
        }
    }

    // Fallback: <meta name="description" content="...">
    if resp.description.is_none() {
        let desc_re = Regex::new(
            r#"(?i)<meta\s+(?:[^>]*?\s)?name\s*=\s*"description"[^>]*?\scontent\s*=\s*"([^"]*)"[^>]*/?\s*>"#,
        )
        .unwrap();
        if let Some(cap) = desc_re.captures(html) {
            resp.description = Some(cap[1].to_string());
        }
    }

    resp
}
