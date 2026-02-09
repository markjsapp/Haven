use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::models::*;

// ─── Users ─────────────────────────────────────────────

pub async fn create_user(
    pool: &PgPool,
    username: &str,
    display_name: Option<&str>,
    email_hash: Option<&str>,
    password_hash: &str,
    identity_key: &[u8],
    signed_prekey: &[u8],
    signed_prekey_sig: &[u8],
) -> AppResult<User> {
    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (id, username, display_name, email_hash, password_hash,
                          identity_key, signed_prekey, signed_prekey_sig,
                          created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(username)
    .bind(display_name)
    .bind(email_hash)
    .bind(password_hash)
    .bind(identity_key)
    .bind(signed_prekey)
    .bind(signed_prekey_sig)
    .fetch_one(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db_err) if db_err.constraint() == Some("users_username_key") => {
            AppError::UsernameTaken
        }
        other => AppError::Database(other),
    })?;

    Ok(user)
}

pub async fn find_user_by_username(pool: &PgPool, username: &str) -> AppResult<Option<User>> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE LOWER(username) = LOWER($1)")
        .bind(username)
        .fetch_optional(pool)
        .await?;
    Ok(user)
}

pub async fn find_user_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<User>> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(user)
}

pub async fn set_user_totp_secret(pool: &PgPool, user_id: Uuid, secret: &str) -> AppResult<()> {
    sqlx::query("UPDATE users SET totp_secret = $1, updated_at = NOW() WHERE id = $2")
        .bind(secret)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn clear_user_totp_secret(pool: &PgPool, user_id: Uuid) -> AppResult<()> {
    sqlx::query("UPDATE users SET totp_secret = NULL, updated_at = NOW() WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ─── Pre-Keys ──────────────────────────────────────────

pub async fn insert_prekeys(pool: &PgPool, user_id: Uuid, keys: &[(i32, Vec<u8>)]) -> AppResult<()> {
    // Batch insert using a transaction
    let mut tx = pool.begin().await?;

    for (key_id, public_key) in keys {
        sqlx::query(
            r#"
            INSERT INTO prekeys (id, user_id, key_id, public_key, used, created_at)
            VALUES ($1, $2, $3, $4, false, NOW())
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(key_id)
        .bind(public_key)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Fetch and consume one unused one-time prekey (marks it as used atomically).
pub async fn consume_prekey(pool: &PgPool, user_id: Uuid) -> AppResult<Option<PreKey>> {
    let prekey = sqlx::query_as::<_, PreKey>(
        r#"
        UPDATE prekeys SET used = true
        WHERE id = (
            SELECT id FROM prekeys
            WHERE user_id = $1 AND used = false
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(prekey)
}

pub async fn count_unused_prekeys(pool: &PgPool, user_id: Uuid) -> AppResult<i64> {
    let row: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM prekeys WHERE user_id = $1 AND used = false")
            .bind(user_id)
            .fetch_one(pool)
            .await?;
    Ok(row.0)
}

// ─── Refresh Tokens ────────────────────────────────────

pub async fn store_refresh_token(
    pool: &PgPool,
    user_id: Uuid,
    token_hash: &str,
    expires_at: DateTime<Utc>,
) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(token_hash)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn find_refresh_token(pool: &PgPool, token_hash: &str) -> AppResult<Option<RefreshToken>> {
    let token = sqlx::query_as::<_, RefreshToken>(
        "SELECT * FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()",
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?;
    Ok(token)
}

pub async fn revoke_refresh_token(pool: &PgPool, token_hash: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM refresh_tokens WHERE token_hash = $1")
        .bind(token_hash)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn revoke_all_user_refresh_tokens(pool: &PgPool, user_id: Uuid) -> AppResult<()> {
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn purge_expired_refresh_tokens(pool: &PgPool) -> AppResult<u64> {
    let result = sqlx::query("DELETE FROM refresh_tokens WHERE expires_at < NOW()")
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

// ─── Servers ───────────────────────────────────────────

pub async fn create_server(
    pool: &PgPool,
    owner_id: Uuid,
    encrypted_meta: &[u8],
) -> AppResult<Server> {
    let server = sqlx::query_as::<_, Server>(
        r#"
        INSERT INTO servers (id, encrypted_meta, owner_id, created_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(encrypted_meta)
    .bind(owner_id)
    .fetch_one(pool)
    .await?;
    Ok(server)
}

pub async fn find_server_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Server>> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(server)
}

pub async fn get_user_servers(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<Server>> {
    let servers = sqlx::query_as::<_, Server>(
        r#"
        SELECT s.* FROM servers s
        INNER JOIN server_members sm ON s.id = sm.server_id
        WHERE sm.user_id = $1
        ORDER BY s.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(servers)
}

// ─── Server Members ────────────────────────────────────

pub async fn add_server_member(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
    encrypted_role: &[u8],
) -> AppResult<ServerMember> {
    let member = sqlx::query_as::<_, ServerMember>(
        r#"
        INSERT INTO server_members (id, server_id, user_id, encrypted_role, joined_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (server_id, user_id) DO UPDATE SET encrypted_role = EXCLUDED.encrypted_role
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(user_id)
    .bind(encrypted_role)
    .fetch_one(pool)
    .await?;
    Ok(member)
}

pub async fn is_server_member(pool: &PgPool, server_id: Uuid, user_id: Uuid) -> AppResult<bool> {
    let row: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

// ─── Channels ──────────────────────────────────────────

/// Find an existing DM channel between exactly two users.
pub async fn find_dm_channel(pool: &PgPool, user_a: Uuid, user_b: Uuid) -> AppResult<Option<Channel>> {
    let channel = sqlx::query_as::<_, Channel>(
        r#"
        SELECT c.* FROM channels c
        WHERE c.channel_type = 'dm'
          AND (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = c.id) = 2
          AND EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $1)
          AND EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2)
        LIMIT 1
        "#,
    )
    .bind(user_a)
    .bind(user_b)
    .fetch_optional(pool)
    .await?;
    Ok(channel)
}

pub async fn create_channel(
    pool: &PgPool,
    server_id: Option<Uuid>,
    encrypted_meta: &[u8],
    channel_type: &str,
    position: i32,
) -> AppResult<Channel> {
    let channel = sqlx::query_as::<_, Channel>(
        r#"
        INSERT INTO channels (id, server_id, encrypted_meta, channel_type, position, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(encrypted_meta)
    .bind(channel_type)
    .bind(position)
    .fetch_one(pool)
    .await?;
    Ok(channel)
}

pub async fn get_server_channels(pool: &PgPool, server_id: Uuid) -> AppResult<Vec<Channel>> {
    let channels = sqlx::query_as::<_, Channel>(
        "SELECT * FROM channels WHERE server_id = $1 ORDER BY position ASC",
    )
    .bind(server_id)
    .fetch_all(pool)
    .await?;
    Ok(channels)
}

pub async fn get_user_dm_channels(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<Channel>> {
    let channels = sqlx::query_as::<_, Channel>(
        r#"
        SELECT c.* FROM channels c
        INNER JOIN channel_members cm ON c.id = cm.channel_id
        WHERE cm.user_id = $1 AND c.channel_type = 'dm'
        ORDER BY c.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(channels)
}

pub async fn find_channel_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Channel>> {
    let ch = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(ch)
}

// ─── Channel Members ───────────────────────────────────

pub async fn add_channel_member(
    pool: &PgPool,
    channel_id: Uuid,
    user_id: Uuid,
) -> AppResult<ChannelMember> {
    let member = sqlx::query_as::<_, ChannelMember>(
        r#"
        INSERT INTO channel_members (id, channel_id, user_id, joined_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (channel_id, user_id) DO UPDATE SET joined_at = EXCLUDED.joined_at
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(member)
}

pub async fn is_channel_member(pool: &PgPool, channel_id: Uuid, user_id: Uuid) -> AppResult<bool> {
    let row: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2)",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn get_channel_member_ids(pool: &PgPool, channel_id: Uuid) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> =
        sqlx::query_as("SELECT user_id FROM channel_members WHERE channel_id = $1")
            .bind(channel_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

// ─── Messages ──────────────────────────────────────────

pub async fn insert_message(
    pool: &PgPool,
    channel_id: Uuid,
    sender_token: &[u8],
    encrypted_body: &[u8],
    expires_at: Option<DateTime<Utc>>,
    has_attachments: bool,
) -> AppResult<Message> {
    let msg = sqlx::query_as::<_, Message>(
        r#"
        INSERT INTO messages (id, channel_id, sender_token, encrypted_body,
                             timestamp, expires_at, has_attachments)
        VALUES ($1, $2, $3, $4, NOW(), $5, $6)
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(channel_id)
    .bind(sender_token)
    .bind(encrypted_body)
    .bind(expires_at)
    .bind(has_attachments)
    .fetch_one(pool)
    .await?;
    Ok(msg)
}

pub async fn get_channel_messages(
    pool: &PgPool,
    channel_id: Uuid,
    before: Option<DateTime<Utc>>,
    limit: i64,
) -> AppResult<Vec<Message>> {
    let messages = if let Some(before_ts) = before {
        sqlx::query_as::<_, Message>(
            r#"
            SELECT * FROM messages
            WHERE channel_id = $1 AND timestamp < $2
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY timestamp DESC
            LIMIT $3
            "#,
        )
        .bind(channel_id)
        .bind(before_ts)
        .bind(limit)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, Message>(
            r#"
            SELECT * FROM messages
            WHERE channel_id = $1
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY timestamp DESC
            LIMIT $2
            "#,
        )
        .bind(channel_id)
        .bind(limit)
        .fetch_all(pool)
        .await?
    };
    Ok(messages)
}

/// Purge expired messages (called by background worker).
pub async fn purge_expired_messages(pool: &PgPool) -> AppResult<u64> {
    let result = sqlx::query("DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < NOW()")
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

// ─── Attachments ───────────────────────────────────────

pub async fn insert_attachment(
    pool: &PgPool,
    message_id: Uuid,
    storage_key: &str,
    encrypted_meta: &[u8],
    size_bucket: i32,
) -> AppResult<Attachment> {
    let att = sqlx::query_as::<_, Attachment>(
        r#"
        INSERT INTO attachments (id, message_id, storage_key, encrypted_meta, size_bucket, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(message_id)
    .bind(storage_key)
    .bind(encrypted_meta)
    .bind(size_bucket)
    .fetch_one(pool)
    .await?;
    Ok(att)
}
