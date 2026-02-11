// ─── Auth ──────────────────────────────────────────────

export interface RegisterRequest {
  username: string;
  password: string;
  display_name?: string;
  email?: string;
  identity_key: string;       // base64
  signed_prekey: string;      // base64
  signed_prekey_signature: string; // base64
  one_time_prekeys: string[]; // base64[]
}

export interface LoginRequest {
  username: string;
  password: string;
  totp_code?: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: UserPublic;
}

export interface RefreshRequest {
  refresh_token: string;
}

export interface TotpSetupResponse {
  secret: string;
  qr_code_uri: string;
}

export interface TotpVerifyRequest {
  code: string;
}

// ─── Users ─────────────────────────────────────────────

export interface UserPublic {
  id: string;
  username: string;
  display_name: string | null;
  about_me: string | null;
  avatar_url: string | null;
  custom_status: string | null;
  custom_status_emoji: string | null;
  created_at: string;
}

export interface UserProfileResponse {
  id: string;
  username: string;
  display_name: string | null;
  about_me: string | null;
  avatar_url: string | null;
  custom_status: string | null;
  custom_status_emoji: string | null;
  created_at: string;
  is_blocked: boolean;
}

export interface UpdateProfileRequest {
  display_name?: string | null;
  about_me?: string | null;
  custom_status?: string | null;
  custom_status_emoji?: string | null;
}

export interface BlockedUserResponse {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  blocked_at: string;
}

// ─── Keys ──────────────────────────────────────────────

export interface KeyBundle {
  identity_key: string;          // base64
  signed_prekey: string;         // base64
  signed_prekey_sig: string;     // base64
  one_time_prekey: string | null; // base64, consumed on fetch
}

export interface UploadPreKeysRequest {
  prekeys: string[]; // base64[]
}

export interface PreKeyCountResponse {
  count: number;
  needs_replenishment: boolean;
}

export interface UpdateKeysRequest {
  identity_key: string;          // base64
  signed_prekey: string;         // base64
  signed_prekey_signature: string; // base64
}

// ─── Servers ───────────────────────────────────────────

export interface CreateServerRequest {
  encrypted_meta: string; // base64
}

export interface ServerResponse {
  id: string;
  encrypted_meta: string; // base64
  owner_id: string;
  created_at: string;
}

// ─── Channels ──────────────────────────────────────────

export interface CreateChannelRequest {
  encrypted_meta: string; // base64
  channel_type?: string;
  position?: number;
}

export interface ChannelResponse {
  id: string;
  server_id: string | null;
  encrypted_meta: string; // base64
  channel_type: string;
  position: number;
  created_at: string;
}

export interface CreateDmRequest {
  target_user_id: string;
  encrypted_meta: string; // base64
}

// ─── Messages ──────────────────────────────────────────

export interface SendMessageRequest {
  channel_id: string;
  sender_token: string;   // base64
  encrypted_body: string;  // base64
  expires_at?: string;
  has_attachments: boolean;
}

export interface MessageResponse {
  id: string;
  channel_id: string;
  sender_token: string;   // base64
  encrypted_body: string;  // base64
  timestamp: string;
  expires_at: string | null;
  has_attachments: boolean;
  edited: boolean;
}

export interface MessageQuery {
  before?: string;
  limit?: number;
}

// ─── Attachments ───────────────────────────────────────

export interface UploadResponse {
  attachment_id: string;
  storage_key: string;
}

// ─── Sender Keys ──────────────────────────────────────

export interface DistributeSenderKeyRequest {
  distributions: Array<{
    to_user_id: string;
    distribution_id: string;
    encrypted_skdm: string; // base64
  }>;
}

export interface SenderKeyDistributionResponse {
  id: string;
  channel_id: string;
  from_user_id: string;
  distribution_id: string;
  encrypted_skdm: string; // base64
  created_at: string;
}

export interface ChannelMemberKeyInfo {
  user_id: string;
  identity_key: string; // base64
}

// ─── Reactions ─────────────────────────────────────────

export interface ReactionGroup {
  message_id: string;
  emoji: string;
  count: number;
  user_ids: string[];
}

// ─── WebSocket ─────────────────────────────────────────

export type WsClientMessage =
  | { type: "SendMessage"; payload: { channel_id: string; sender_token: string; encrypted_body: string; expires_at?: string; attachment_ids?: string[] } }
  | { type: "EditMessage"; payload: { message_id: string; encrypted_body: string } }
  | { type: "DeleteMessage"; payload: { message_id: string } }
  | { type: "AddReaction"; payload: { message_id: string; emoji: string } }
  | { type: "RemoveReaction"; payload: { message_id: string; emoji: string } }
  | { type: "Subscribe"; payload: { channel_id: string } }
  | { type: "Unsubscribe"; payload: { channel_id: string } }
  | { type: "Typing"; payload: { channel_id: string } }
  | { type: "Ping" };

export type WsServerMessage =
  | { type: "NewMessage"; payload: MessageResponse }
  | { type: "MessageEdited"; payload: { message_id: string; channel_id: string; encrypted_body: string } }
  | { type: "UserTyping"; payload: { channel_id: string; user_id: string; username: string } }
  | { type: "MessageAck"; payload: { message_id: string } }
  | { type: "Subscribed"; payload: { channel_id: string } }
  | { type: "Error"; payload: { message: string } }
  | { type: "Pong" }
  | { type: "SenderKeysUpdated"; payload: { channel_id: string } }
  | { type: "MessageDeleted"; payload: { message_id: string; channel_id: string } }
  | { type: "ReactionAdded"; payload: { message_id: string; channel_id: string; user_id: string; emoji: string } }
  | { type: "ReactionRemoved"; payload: { message_id: string; channel_id: string; user_id: string; emoji: string } }
  | { type: "PresenceUpdate"; payload: { user_id: string; status: string } };

// ─── Presence ─────────────────────────────────────────

export interface PresenceEntry {
  user_id: string;
  status: string;
}

// ─── Invites ──────────────────────────────────────────

export interface CreateInviteRequest {
  max_uses?: number;
  expires_in_hours?: number;
}

export interface InviteResponse {
  id: string;
  code: string;
  server_id: string;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  created_at: string;
}

// ─── Server Members ───────────────────────────────────

export interface ServerMemberResponse {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  joined_at: string;
}

// ─── API Error ─────────────────────────────────────────

export interface ApiError {
  error: string;
  status: number;
}
