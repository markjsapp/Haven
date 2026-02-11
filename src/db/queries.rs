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

pub async fn update_user_keys(
    pool: &PgPool,
    user_id: Uuid,
    identity_key: &[u8],
    signed_prekey: &[u8],
    signed_prekey_sig: &[u8],
) -> AppResult<()> {
    sqlx::query(
        "UPDATE users SET identity_key = $1, signed_prekey = $2, signed_prekey_sig = $3, updated_at = NOW() WHERE id = $4",
    )
    .bind(identity_key)
    .bind(signed_prekey)
    .bind(signed_prekey_sig)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
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

pub async fn update_channel_meta(
    pool: &PgPool,
    channel_id: Uuid,
    encrypted_meta: &[u8],
) -> AppResult<Channel> {
    let ch = sqlx::query_as::<_, Channel>(
        "UPDATE channels SET encrypted_meta = $1 WHERE id = $2 RETURNING *",
    )
    .bind(encrypted_meta)
    .bind(channel_id)
    .fetch_one(pool)
    .await?;
    Ok(ch)
}

pub async fn delete_channel(pool: &PgPool, channel_id: Uuid) -> AppResult<()> {
    // Delete members first (FK), then messages, then the channel
    sqlx::query("DELETE FROM channel_members WHERE channel_id = $1")
        .bind(channel_id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM messages WHERE channel_id = $1")
        .bind(channel_id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM sender_key_distributions WHERE channel_id = $1")
        .bind(channel_id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(channel_id)
        .execute(pool)
        .await?;
    Ok(())
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

/// Get all channel IDs a user belongs to (for presence broadcast).
pub async fn get_user_channel_ids(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> =
        sqlx::query_as("SELECT channel_id FROM channel_members WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

// ─── Messages ──────────────────────────────────────────

pub async fn find_message_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Message>> {
    let msg = sqlx::query_as::<_, Message>("SELECT * FROM messages WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(msg)
}

pub async fn insert_message(
    pool: &PgPool,
    channel_id: Uuid,
    sender_token: &[u8],
    encrypted_body: &[u8],
    expires_at: Option<DateTime<Utc>>,
    has_attachments: bool,
    sender_id: Uuid,
) -> AppResult<Message> {
    let msg = sqlx::query_as::<_, Message>(
        r#"
        INSERT INTO messages (id, channel_id, sender_token, encrypted_body,
                             timestamp, expires_at, has_attachments, sender_id)
        VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(channel_id)
    .bind(sender_token)
    .bind(encrypted_body)
    .bind(expires_at)
    .bind(has_attachments)
    .bind(sender_id)
    .fetch_one(pool)
    .await?;
    Ok(msg)
}

/// Update encrypted_body of a message (for editing). Only the original sender can edit.
pub async fn update_message_body(
    pool: &PgPool,
    message_id: Uuid,
    sender_id: Uuid,
    new_encrypted_body: &[u8],
) -> AppResult<Message> {
    let msg = sqlx::query_as::<_, Message>(
        r#"
        UPDATE messages
        SET encrypted_body = $1, edited_at = NOW()
        WHERE id = $2 AND sender_id = $3
        RETURNING *
        "#,
    )
    .bind(new_encrypted_body)
    .bind(message_id)
    .bind(sender_id)
    .fetch_optional(pool)
    .await?;

    msg.ok_or_else(|| AppError::Forbidden("Cannot edit this message".into()))
}

/// Delete a message. Only the original sender can delete.
/// Returns the deleted message (for getting channel_id).
pub async fn delete_message(
    pool: &PgPool,
    message_id: Uuid,
    sender_id: Uuid,
) -> AppResult<Message> {
    let msg = sqlx::query_as::<_, Message>(
        r#"
        DELETE FROM messages
        WHERE id = $1 AND sender_id = $2
        RETURNING *
        "#,
    )
    .bind(message_id)
    .bind(sender_id)
    .fetch_optional(pool)
    .await?;

    msg.ok_or_else(|| AppError::Forbidden("Cannot delete this message".into()))
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

/// Link an attachment (uploaded via presigned URL) to a message.
pub async fn link_attachment(
    pool: &PgPool,
    attachment_id: Uuid,
    message_id: Uuid,
    storage_key: &str,
) -> AppResult<Attachment> {
    let att = sqlx::query_as::<_, Attachment>(
        r#"
        INSERT INTO attachments (id, message_id, storage_key, encrypted_meta, size_bucket, created_at)
        VALUES ($1, $2, $3, $4, 0, NOW())
        RETURNING *
        "#,
    )
    .bind(attachment_id)
    .bind(message_id)
    .bind(storage_key)
    .bind(&[] as &[u8])
    .fetch_one(pool)
    .await?;
    Ok(att)
}

pub async fn find_attachment_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Attachment>> {
    let att = sqlx::query_as::<_, Attachment>("SELECT * FROM attachments WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(att)
}

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

// ─── Invites ──────────────────────────────────────────

pub async fn create_invite(
    pool: &PgPool,
    server_id: Uuid,
    created_by: Uuid,
    code: &str,
    max_uses: Option<i32>,
    expires_at: Option<DateTime<Utc>>,
) -> AppResult<Invite> {
    let invite = sqlx::query_as::<_, Invite>(
        r#"
        INSERT INTO invites (id, server_id, created_by, code, max_uses, use_count, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5, 0, $6, NOW())
        RETURNING *
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(created_by)
    .bind(code)
    .bind(max_uses)
    .bind(expires_at)
    .fetch_one(pool)
    .await?;
    Ok(invite)
}

pub async fn find_invite_by_code(pool: &PgPool, code: &str) -> AppResult<Option<Invite>> {
    let invite = sqlx::query_as::<_, Invite>("SELECT * FROM invites WHERE code = $1")
        .bind(code)
        .fetch_optional(pool)
        .await?;
    Ok(invite)
}

pub async fn get_server_invites(pool: &PgPool, server_id: Uuid) -> AppResult<Vec<Invite>> {
    let invites = sqlx::query_as::<_, Invite>(
        "SELECT * FROM invites WHERE server_id = $1 ORDER BY created_at DESC",
    )
    .bind(server_id)
    .fetch_all(pool)
    .await?;
    Ok(invites)
}

pub async fn increment_invite_uses(pool: &PgPool, invite_id: Uuid) -> AppResult<()> {
    sqlx::query("UPDATE invites SET use_count = use_count + 1 WHERE id = $1")
        .bind(invite_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_invite(pool: &PgPool, invite_id: Uuid) -> AppResult<()> {
    sqlx::query("DELETE FROM invites WHERE id = $1")
        .bind(invite_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ─── Reactions ────────────────────────────────────────

/// Add a reaction. Returns the reaction (upsert — ignores if already exists).
pub async fn add_reaction(
    pool: &PgPool,
    message_id: Uuid,
    user_id: Uuid,
    emoji: &str,
) -> AppResult<Reaction> {
    let reaction = sqlx::query_as::<_, Reaction>(
        r#"
        INSERT INTO reactions (message_id, user_id, emoji)
        VALUES ($1, $2, $3)
        ON CONFLICT (message_id, user_id, emoji) DO UPDATE SET created_at = reactions.created_at
        RETURNING *
        "#,
    )
    .bind(message_id)
    .bind(user_id)
    .bind(emoji)
    .fetch_one(pool)
    .await?;
    Ok(reaction)
}

/// Remove a reaction. Returns true if a row was deleted.
pub async fn remove_reaction(
    pool: &PgPool,
    message_id: Uuid,
    user_id: Uuid,
    emoji: &str,
) -> AppResult<bool> {
    let result = sqlx::query(
        "DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
    )
    .bind(message_id)
    .bind(user_id)
    .bind(emoji)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Get all reactions for a set of message IDs, grouped by emoji.
pub async fn get_reactions_for_messages(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> AppResult<Vec<Reaction>> {
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }
    let reactions = sqlx::query_as::<_, Reaction>(
        "SELECT * FROM reactions WHERE message_id = ANY($1) ORDER BY created_at ASC",
    )
    .bind(message_ids)
    .fetch_all(pool)
    .await?;
    Ok(reactions)
}

// ─── Sender Key Distributions ─────────────────────────

/// Store a batch of encrypted SKDMs for a channel.
pub async fn insert_sender_key_distributions(
    pool: &PgPool,
    channel_id: Uuid,
    from_user_id: Uuid,
    distributions: &[(Uuid, Uuid, Vec<u8>)], // (to_user_id, distribution_id, encrypted_skdm)
) -> AppResult<()> {
    let mut tx = pool.begin().await?;

    for (to_user_id, distribution_id, encrypted_skdm) in distributions {
        sqlx::query(
            r#"
            INSERT INTO sender_key_distributions
                (id, channel_id, from_user_id, to_user_id, distribution_id, encrypted_skdm, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (channel_id, from_user_id, to_user_id, distribution_id)
            DO UPDATE SET encrypted_skdm = EXCLUDED.encrypted_skdm, created_at = NOW()
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(channel_id)
        .bind(from_user_id)
        .bind(to_user_id)
        .bind(distribution_id)
        .bind(encrypted_skdm)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Fetch all pending SKDMs for a user in a specific channel.
pub async fn get_sender_key_distributions(
    pool: &PgPool,
    channel_id: Uuid,
    to_user_id: Uuid,
) -> AppResult<Vec<SenderKeyDistribution>> {
    let rows = sqlx::query_as::<_, SenderKeyDistribution>(
        r#"
        SELECT * FROM sender_key_distributions
        WHERE channel_id = $1 AND to_user_id = $2
        ORDER BY created_at ASC
        "#,
    )
    .bind(channel_id)
    .bind(to_user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Delete consumed SKDMs (after client has fetched them).
pub async fn delete_sender_key_distributions(
    pool: &PgPool,
    ids: &[Uuid],
) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    sqlx::query("DELETE FROM sender_key_distributions WHERE id = ANY($1)")
        .bind(ids)
        .execute(pool)
        .await?;
    Ok(())
}

/// Get all channel member identity keys (for SKDM encryption).
/// Returns (user_id, identity_key) pairs for all members except the requester.
pub async fn get_channel_member_identity_keys(
    pool: &PgPool,
    channel_id: Uuid,
    exclude_user_id: Uuid,
) -> AppResult<Vec<(Uuid, Vec<u8>)>> {
    let rows: Vec<(Uuid, Vec<u8>)> = sqlx::query_as(
        r#"
        SELECT u.id, u.identity_key
        FROM channel_members cm
        INNER JOIN users u ON u.id = cm.user_id
        WHERE cm.channel_id = $1 AND cm.user_id != $2
        "#,
    )
    .bind(channel_id)
    .bind(exclude_user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ─── Server Members (extended) ────────────────────────

pub async fn get_server_members(
    pool: &PgPool,
    server_id: Uuid,
) -> AppResult<Vec<ServerMemberResponse>> {
    let members = sqlx::query_as::<_, ServerMemberResponse>(
        r#"
        SELECT sm.user_id, u.username, u.display_name, u.avatar_url, sm.joined_at
        FROM server_members sm
        INNER JOIN users u ON u.id = sm.user_id
        WHERE sm.server_id = $1
        ORDER BY sm.joined_at ASC
        "#,
    )
    .bind(server_id)
    .fetch_all(pool)
    .await?;
    Ok(members)
}

pub async fn remove_server_member(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    // Remove from all server channels
    sqlx::query(
        r#"
        DELETE FROM channel_members
        WHERE user_id = $1
          AND channel_id IN (SELECT id FROM channels WHERE server_id = $2)
        "#,
    )
    .bind(user_id)
    .bind(server_id)
    .execute(pool)
    .await?;

    // Remove from server
    sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(())
}

// ─── User Profiles ───────────────────────────────────

pub async fn update_user_profile(
    pool: &PgPool,
    user_id: Uuid,
    display_name: Option<&str>,
    about_me: Option<&str>,
    custom_status: Option<&str>,
    custom_status_emoji: Option<&str>,
) -> AppResult<User> {
    let user = sqlx::query_as::<_, User>(
        r#"
        UPDATE users SET
            display_name = COALESCE($2, display_name),
            about_me = $3,
            custom_status = $4,
            custom_status_emoji = $5,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(display_name)
    .bind(about_me)
    .bind(custom_status)
    .bind(custom_status_emoji)
    .fetch_one(pool)
    .await?;
    Ok(user)
}

// ─── Blocked Users ───────────────────────────────────

pub async fn block_user(pool: &PgPool, blocker_id: Uuid, blocked_id: Uuid) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO blocked_users (blocker_id, blocked_id)
        VALUES ($1, $2)
        ON CONFLICT (blocker_id, blocked_id) DO NOTHING
        "#,
    )
    .bind(blocker_id)
    .bind(blocked_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn unblock_user(pool: &PgPool, blocker_id: Uuid, blocked_id: Uuid) -> AppResult<bool> {
    let result = sqlx::query("DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2")
        .bind(blocker_id)
        .bind(blocked_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn is_blocked(pool: &PgPool, blocker_id: Uuid, blocked_id: Uuid) -> AppResult<bool> {
    let row: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2)",
    )
    .bind(blocker_id)
    .bind(blocked_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn get_blocked_users(pool: &PgPool, blocker_id: Uuid) -> AppResult<Vec<BlockedUserResponse>> {
    let rows = sqlx::query_as::<_, BlockedUserResponse>(
        r#"
        SELECT bu.blocked_id AS user_id, u.username, u.display_name, u.avatar_url, bu.created_at AS blocked_at
        FROM blocked_users bu
        INNER JOIN users u ON u.id = bu.blocked_id
        WHERE bu.blocker_id = $1
        ORDER BY bu.created_at DESC
        "#,
    )
    .bind(blocker_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_blocked_user_ids(pool: &PgPool, blocker_id: Uuid) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> =
        sqlx::query_as("SELECT blocked_id FROM blocked_users WHERE blocker_id = $1")
            .bind(blocker_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}
