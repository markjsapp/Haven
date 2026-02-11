use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

// ─── User ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub email_hash: Option<String>,
    pub password_hash: String,
    pub identity_key: Vec<u8>,     // X25519 public identity key
    pub signed_prekey: Vec<u8>,    // Signed pre-key (public)
    pub signed_prekey_sig: Vec<u8>, // Signature over the signed pre-key
    pub totp_secret: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub about_me: Option<String>,
    pub custom_status: Option<String>,
    pub custom_status_emoji: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserPublic {
    pub id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub about_me: Option<String>,
    pub avatar_url: Option<String>,
    pub custom_status: Option<String>,
    pub custom_status_emoji: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<User> for UserPublic {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            about_me: u.about_me,
            avatar_url: u.avatar_url,
            custom_status: u.custom_status,
            custom_status_emoji: u.custom_status_emoji,
            created_at: u.created_at,
        }
    }
}

// ─── Auth Requests / Responses ─────────────────────────

#[derive(Debug, Deserialize, Validate)]
pub struct RegisterRequest {
    #[validate(length(min = 3, max = 32, message = "Username must be 3-32 characters"))]
    #[validate(custom(function = "validate_username"))]
    pub username: String,

    #[validate(length(min = 8, max = 128, message = "Password must be 8-128 characters"))]
    pub password: String,

    pub display_name: Option<String>,
    pub email: Option<String>, // optional, hashed before storage

    // Crypto keys (base64-encoded)
    pub identity_key: String,
    pub signed_prekey: String,
    pub signed_prekey_signature: String,
    pub one_time_prekeys: Vec<String>, // batch upload of OTPs
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    pub totp_code: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: UserPublic,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

// ─── TOTP ──────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct TotpSetupResponse {
    pub secret: String,
    pub qr_code_uri: String,
}

#[derive(Debug, Deserialize)]
pub struct TotpVerifyRequest {
    pub code: String,
}

// ─── Pre-Keys (X3DH) ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PreKey {
    pub id: Uuid,
    pub user_id: Uuid,
    pub key_id: i32,
    pub public_key: Vec<u8>,
    pub used: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct KeyBundle {
    pub identity_key: String,       // base64
    pub signed_prekey: String,      // base64
    pub signed_prekey_sig: String,  // base64
    pub one_time_prekey: Option<String>, // base64, consumed on fetch
}

#[derive(Debug, Deserialize)]
pub struct UploadPreKeysRequest {
    pub prekeys: Vec<String>, // base64-encoded public keys
}

#[derive(Debug, Deserialize)]
pub struct UpdateKeysRequest {
    pub identity_key: String,          // base64
    pub signed_prekey: String,         // base64
    pub signed_prekey_signature: String, // base64
}

// ─── Servers ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Server {
    pub id: Uuid,
    pub encrypted_meta: Vec<u8>, // name, description, icon — encrypted with server key
    pub owner_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerRequest {
    pub encrypted_meta: String, // base64
}

#[derive(Debug, Serialize)]
pub struct ServerResponse {
    pub id: Uuid,
    pub encrypted_meta: String, // base64
    pub owner_id: Uuid,
    pub created_at: DateTime<Utc>,
}

// ─── Channels ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Channel {
    pub id: Uuid,
    pub server_id: Option<Uuid>, // null for DM channels
    pub encrypted_meta: Vec<u8>,
    pub channel_type: String,    // "text", "dm"
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    pub encrypted_meta: String, // base64
    pub channel_type: Option<String>,
    pub position: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct ChannelResponse {
    pub id: Uuid,
    pub server_id: Option<Uuid>,
    pub encrypted_meta: String, // base64
    pub channel_type: String,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

// ─── Members ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ServerMember {
    pub id: Uuid,
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub encrypted_role: Vec<u8>, // role encrypted with server key
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChannelMember {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub joined_at: DateTime<Utc>,
}

// ─── Messages ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub sender_token: Vec<u8>,    // sealed sender: ephemeral token
    pub encrypted_body: Vec<u8>,  // E2EE payload
    pub timestamp: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub has_attachments: bool,
    pub sender_id: Option<Uuid>,  // for edit authorization; null for legacy messages
    pub edited_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub channel_id: Uuid,
    pub sender_token: String,    // base64
    pub encrypted_body: String,  // base64
    pub expires_at: Option<DateTime<Utc>>,
    pub has_attachments: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageResponse {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub sender_token: String,    // base64
    pub encrypted_body: String,  // base64
    pub timestamp: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub has_attachments: bool,
    pub edited: bool,
}

impl From<Message> for MessageResponse {
    fn from(m: Message) -> Self {
        Self {
            id: m.id,
            channel_id: m.channel_id,
            sender_token: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &m.sender_token,
            ),
            encrypted_body: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &m.encrypted_body,
            ),
            timestamp: m.timestamp,
            expires_at: m.expires_at,
            has_attachments: m.has_attachments,
            edited: m.edited_at.is_some(),
        }
    }
}

// ─── Attachments ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Attachment {
    pub id: Uuid,
    pub message_id: Uuid,
    pub storage_key: String,
    pub encrypted_meta: Vec<u8>,
    pub size_bucket: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub attachment_id: Uuid,
    pub storage_key: String,
}

// ─── Sender Key Distributions ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SenderKeyDistribution {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub from_user_id: Uuid,
    pub to_user_id: Uuid,
    pub distribution_id: Uuid,
    pub encrypted_skdm: Vec<u8>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct DistributeSenderKeyRequest {
    pub distributions: Vec<SenderKeyDistributionEntry>,
}

#[derive(Debug, Deserialize)]
pub struct SenderKeyDistributionEntry {
    pub to_user_id: Uuid,
    pub distribution_id: Uuid,
    pub encrypted_skdm: String, // base64
}

#[derive(Debug, Serialize)]
pub struct SenderKeyDistributionResponse {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub from_user_id: Uuid,
    pub distribution_id: Uuid,
    pub encrypted_skdm: String, // base64
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct ChannelMemberKeyInfo {
    pub user_id: Uuid,
    pub identity_key: String, // base64
}

// ─── Reactions ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Reaction {
    pub id: Uuid,
    pub message_id: Uuid,
    pub user_id: Uuid,
    pub emoji: String,
    pub created_at: DateTime<Utc>,
}

/// Aggregated reaction info for a single emoji on a message.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReactionGroup {
    pub message_id: Uuid,
    pub emoji: String,
    pub count: i64,
    pub user_ids: Vec<Uuid>,
}

// ─── Link Previews ────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LinkPreviewQuery {
    pub url: String,
}

#[derive(Debug, Serialize, Default)]
pub struct LinkPreviewResponse {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site_name: Option<String>,
}

// ─── WebSocket Messages ────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", content = "payload")]
pub enum WsClientMessage {
    /// Send an encrypted message to a channel
    SendMessage {
        channel_id: Uuid,
        sender_token: String,
        encrypted_body: String,
        expires_at: Option<DateTime<Utc>>,
        attachment_ids: Option<Vec<Uuid>>,
    },
    /// Edit a previously sent message
    EditMessage {
        message_id: Uuid,
        encrypted_body: String,
    },
    /// Subscribe to channel events
    Subscribe { channel_id: Uuid },
    /// Unsubscribe from channel events
    Unsubscribe { channel_id: Uuid },
    /// Delete a previously sent message
    DeleteMessage { message_id: Uuid },
    /// Add a reaction to a message
    AddReaction { message_id: Uuid, emoji: String },
    /// Remove a reaction from a message
    RemoveReaction { message_id: Uuid, emoji: String },
    /// Typing indicator
    Typing { channel_id: Uuid },
    /// Ping (keepalive)
    Ping,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", content = "payload")]
pub enum WsServerMessage {
    /// New message in a subscribed channel
    NewMessage(MessageResponse),
    /// A message was edited
    MessageEdited {
        message_id: Uuid,
        channel_id: Uuid,
        encrypted_body: String,
    },
    /// Typing indicator from another user
    UserTyping {
        channel_id: Uuid,
        user_id: Uuid,
        username: String,
    },
    /// Acknowledgment of a sent message
    MessageAck { message_id: Uuid },
    /// Error
    Error { message: String },
    /// Pong (keepalive response)
    Pong,
    /// Subscribed confirmation
    Subscribed { channel_id: Uuid },
    /// New sender key distributions are available for a channel
    SenderKeysUpdated { channel_id: Uuid },
    /// A message was deleted
    MessageDeleted {
        message_id: Uuid,
        channel_id: Uuid,
    },
    /// A reaction was added to a message
    ReactionAdded {
        message_id: Uuid,
        channel_id: Uuid,
        user_id: Uuid,
        emoji: String,
    },
    /// A reaction was removed from a message
    ReactionRemoved {
        message_id: Uuid,
        channel_id: Uuid,
        user_id: Uuid,
        emoji: String,
    },
    /// User presence change (online/offline)
    PresenceUpdate { user_id: Uuid, status: String },
}

// ─── Presence ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PresenceQuery {
    pub user_ids: String, // comma-separated UUIDs
}

#[derive(Debug, Serialize)]
pub struct PresenceEntry {
    pub user_id: Uuid,
    pub status: String,
}

// ─── Refresh Tokens ────────────────────────────────────

#[derive(Debug, Clone, FromRow)]
pub struct RefreshToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

// ─── Invites ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Invite {
    pub id: Uuid,
    pub server_id: Uuid,
    pub created_by: Uuid,
    pub code: String,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateInviteRequest {
    pub max_uses: Option<i32>,
    pub expires_in_hours: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct InviteResponse {
    pub id: Uuid,
    pub code: String,
    pub server_id: Uuid,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl From<Invite> for InviteResponse {
    fn from(i: Invite) -> Self {
        Self {
            id: i.id,
            code: i.code,
            server_id: i.server_id,
            max_uses: i.max_uses,
            use_count: i.use_count,
            expires_at: i.expires_at,
            created_at: i.created_at,
        }
    }
}

#[derive(Debug, Serialize, FromRow)]
pub struct ServerMemberResponse {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub joined_at: DateTime<Utc>,
}

// ─── User Profiles ───────────────────────────────────

#[derive(Debug, Serialize)]
pub struct UserProfileResponse {
    pub id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub about_me: Option<String>,
    pub avatar_url: Option<String>,
    pub custom_status: Option<String>,
    pub custom_status_emoji: Option<String>,
    pub created_at: DateTime<Utc>,
    pub is_blocked: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub about_me: Option<String>,
    pub custom_status: Option<String>,
    pub custom_status_emoji: Option<String>,
}

// ─── Blocked Users ───────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct BlockedUserResponse {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub blocked_at: DateTime<Utc>,
}

// ─── Validation helpers ───────────────────────────────

use std::sync::LazyLock;

static USERNAME_REGEX: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap()
});

fn validate_username(username: &str) -> Result<(), validator::ValidationError> {
    if !USERNAME_REGEX.is_match(username) {
        return Err(validator::ValidationError::new("invalid_username"));
    }
    Ok(())
}
