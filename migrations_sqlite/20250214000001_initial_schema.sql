-- Haven SQLite Schema (consolidated)
-- Equivalent to all PostgreSQL migrations, adapted for SQLite.
-- Differences: TEXT for UUIDs, BLOB for binary, no partitioning, CURRENT_TIMESTAMP.

-- ─── Users ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id                  TEXT PRIMARY KEY,
    username            TEXT UNIQUE NOT NULL,
    display_name        TEXT,
    email_hash          TEXT,
    password_hash       TEXT NOT NULL,
    identity_key        BLOB NOT NULL,
    signed_prekey       BLOB NOT NULL,
    signed_prekey_sig   BLOB NOT NULL,
    totp_secret         TEXT,
    pending_totp_secret TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    about_me            TEXT,
    custom_status       TEXT,
    custom_status_emoji TEXT,
    avatar_url          TEXT,
    banner_url          TEXT,
    dm_privacy          TEXT NOT NULL DEFAULT 'friends_only'
                        CHECK (dm_privacy IN ('everyone', 'friends_only', 'server_members')),
    encrypted_profile   BLOB
);

CREATE INDEX idx_users_username ON users(username);

-- ─── One-Time Pre-Keys (X3DH) ─────────────────────────

CREATE TABLE IF NOT EXISTS prekeys (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id      INTEGER NOT NULL,
    public_key  BLOB NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_prekeys_user_unused ON prekeys(user_id, used) WHERE used = 0;

-- ─── Refresh Tokens ────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT UNIQUE NOT NULL,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    family_id   TEXT,
    revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id)
    WHERE family_id IS NOT NULL;

-- ─── Servers (Communities) ─────────────────────────────

CREATE TABLE IF NOT EXISTS servers (
    id                  TEXT PRIMARY KEY,
    encrypted_meta      BLOB,
    owner_id            TEXT NOT NULL REFERENCES users(id),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    system_channel_id   TEXT,
    icon_url            TEXT
);

CREATE INDEX idx_servers_owner ON servers(owner_id);

-- ─── Server Members ────────────────────────────────────

CREATE TABLE IF NOT EXISTS server_members (
    id              TEXT PRIMARY KEY,
    server_id       TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_role  BLOB,
    joined_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    nickname        TEXT,
    UNIQUE(server_id, user_id)
);

CREATE INDEX idx_server_members_server ON server_members(server_id);
CREATE INDEX idx_server_members_user ON server_members(user_id);

-- ─── Channel Categories ────────────────────────────────

CREATE TABLE IF NOT EXISTS channel_categories (
    id          TEXT PRIMARY KEY,
    server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_channel_categories_server ON channel_categories(server_id);

-- ─── Channels ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channels (
    id              TEXT PRIMARY KEY,
    server_id       TEXT REFERENCES servers(id) ON DELETE CASCADE,
    encrypted_meta  BLOB,
    channel_type    TEXT NOT NULL DEFAULT 'text',
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    category_id     TEXT REFERENCES channel_categories(id) ON DELETE SET NULL,
    dm_status       TEXT DEFAULT 'active'
                    CHECK (dm_status IN ('active', 'pending', 'declined'))
);

CREATE INDEX idx_channels_server ON channels(server_id);
CREATE INDEX idx_channels_type ON channels(channel_type);
CREATE INDEX idx_channels_category ON channels(category_id);

-- ─── Channel Members ───────────────────────────────────

CREATE TABLE IF NOT EXISTS channel_members (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(channel_id, user_id)
);

CREATE INDEX idx_channel_members_channel ON channel_members(channel_id);
CREATE INDEX idx_channel_members_user ON channel_members(user_id);
CREATE INDEX idx_channel_members_user_channel ON channel_members(user_id, channel_id);

-- ─── Messages ──────────────────────────────────────────
-- No partitioning in SQLite. Single table with indexes.

CREATE TABLE IF NOT EXISTS messages (
    id              TEXT NOT NULL,
    channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_token    BLOB NOT NULL,
    encrypted_body  BLOB NOT NULL,
    timestamp       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at      TEXT,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    sender_id       TEXT REFERENCES users(id),
    edited_at       TEXT,
    reply_to_id     TEXT,
    message_type    TEXT NOT NULL DEFAULT 'user',
    PRIMARY KEY (id, timestamp)
);

CREATE INDEX idx_messages_channel_time ON messages(channel_id, timestamp DESC);
CREATE INDEX idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_messages_sender ON messages(sender_id) WHERE sender_id IS NOT NULL;

-- ─── Attachments ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS attachments (
    id              TEXT PRIMARY KEY,
    message_id      TEXT NOT NULL,
    storage_key     TEXT NOT NULL,
    encrypted_meta  BLOB,
    size_bucket     INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_attachments_message ON attachments(message_id);

-- ─── Invite Links ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS invites (
    id          TEXT PRIMARY KEY,
    server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    created_by  TEXT NOT NULL REFERENCES users(id),
    code        TEXT UNIQUE NOT NULL,
    max_uses    INTEGER,
    use_count   INTEGER NOT NULL DEFAULT 0,
    expires_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_invites_code ON invites(code);
CREATE INDEX idx_invites_server ON invites(server_id);

-- ─── Sender Key Distributions ──────────────────────────

CREATE TABLE IF NOT EXISTS sender_key_distributions (
    id              TEXT PRIMARY KEY,
    channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    from_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    distribution_id TEXT NOT NULL,
    encrypted_skdm  BLOB NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(channel_id, from_user_id, to_user_id, distribution_id)
);

CREATE INDEX idx_skdm_to_user_channel ON sender_key_distributions(to_user_id, channel_id);
CREATE INDEX idx_skdm_from_user_channel ON sender_key_distributions(from_user_id, channel_id);

-- ─── Reactions ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reactions (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message_id ON reactions(message_id);
CREATE INDEX idx_reactions_user_id ON reactions(user_id);

-- ─── Blocked Users ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS blocked_users (
    id          TEXT PRIMARY KEY,
    blocker_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(blocker_id, blocked_id)
);

CREATE INDEX idx_blocked_users_blocker ON blocked_users(blocker_id);
CREATE INDEX idx_blocked_users_blocked ON blocked_users(blocked_id);

-- ─── Roles & Permissions ───────────────────────────────

CREATE TABLE IF NOT EXISTS roles (
    id          TEXT PRIMARY KEY,
    server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT,
    permissions INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_roles_server ON roles(server_id);

CREATE TABLE IF NOT EXISTS member_roles (
    server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, user_id, role_id)
);

CREATE INDEX idx_member_roles_user ON member_roles(user_id);

-- ─── Channel Permission Overwrites ─────────────────────

CREATE TABLE IF NOT EXISTS channel_permission_overwrites (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('role', 'member')),
    target_id   TEXT NOT NULL,
    allow_bits  INTEGER NOT NULL DEFAULT 0,
    deny_bits   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (channel_id, target_type, target_id)
);

CREATE INDEX idx_channel_overwrites_channel ON channel_permission_overwrites(channel_id);

-- ─── Friendships ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS friendships (
    id              TEXT PRIMARY KEY,
    requester_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted')),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(requester_id, addressee_id),
    CHECK(requester_id != addressee_id)
);

CREATE INDEX idx_friendships_requester ON friendships(requester_id);
CREATE INDEX idx_friendships_addressee ON friendships(addressee_id);
CREATE INDEX idx_friendships_status ON friendships(status);
CREATE INDEX idx_friendships_pair ON friendships(requester_id, addressee_id);
CREATE INDEX idx_friendships_pair_reverse ON friendships(addressee_id, requester_id);
CREATE INDEX idx_friendships_addressee_status ON friendships(addressee_id, status);

-- ─── Bans ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bans (
    id          TEXT PRIMARY KEY,
    server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason      TEXT,
    banned_by   TEXT NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(server_id, user_id)
);

CREATE INDEX idx_bans_server ON bans(server_id);
CREATE INDEX idx_bans_user ON bans(user_id);

-- ─── Pinned Messages ───────────────────────────────────

CREATE TABLE IF NOT EXISTS pinned_messages (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id  TEXT NOT NULL,
    pinned_by   TEXT NOT NULL REFERENCES users(id),
    pinned_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(channel_id, message_id)
);

CREATE INDEX idx_pinned_messages_channel ON pinned_messages(channel_id);

-- ─── Reports ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reports (
    id          TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES users(id),
    message_id  TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    reason      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_reports_reporter ON reports(reporter_id);
CREATE INDEX idx_reports_message ON reports(message_id);

-- ─── Encrypted Profile Key Distributions ───────────────

CREATE TABLE IF NOT EXISTS profile_key_distributions (
    id                      TEXT PRIMARY KEY,
    from_user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_profile_key   BLOB NOT NULL,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(from_user_id, to_user_id)
);

CREATE INDEX idx_pkd_to_user ON profile_key_distributions(to_user_id);

-- ─── Key Backups ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS key_backups (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_data  BLOB NOT NULL,
    nonce           BLOB NOT NULL,
    salt            BLOB NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id)
);

CREATE INDEX idx_key_backups_user ON key_backups(user_id);

-- ─── Custom Emojis ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS custom_emojis (
    id          TEXT PRIMARY KEY,
    server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    animated    INTEGER NOT NULL DEFAULT 0,
    storage_key TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(server_id, name)
);

CREATE INDEX idx_custom_emojis_server_id ON custom_emojis(server_id);

-- FK for system_channel_id (deferred because channels table is created after servers)
-- SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so this is handled by REFERENCES above.
