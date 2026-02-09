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
  created_at: string;
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
}

export interface MessageQuery {
  before?: string;
  limit?: number;
}

// ─── Attachments ───────────────────────────────────────

export interface UploadUrlResponse {
  upload_url: string;
  attachment_id: string;
  storage_key: string;
}

export interface DownloadUrlResponse {
  download_url: string;
  attachment_id: string;
}

// ─── WebSocket ─────────────────────────────────────────

export type WsClientMessage =
  | { type: "SendMessage"; payload: { channel_id: string; sender_token: string; encrypted_body: string; expires_at?: string } }
  | { type: "Subscribe"; payload: { channel_id: string } }
  | { type: "Unsubscribe"; payload: { channel_id: string } }
  | { type: "Typing"; payload: { channel_id: string } }
  | { type: "Ping" };

export type WsServerMessage =
  | { type: "NewMessage"; payload: MessageResponse }
  | { type: "UserTyping"; payload: { channel_id: string; ephemeral_token: string } }
  | { type: "MessageAck"; payload: { message_id: string } }
  | { type: "Subscribed"; payload: { channel_id: string } }
  | { type: "Error"; payload: { message: string } }
  | { type: "Pong" };

// ─── API Error ─────────────────────────────────────────

export interface ApiError {
  error: string;
  status: number;
}
