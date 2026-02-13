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
  encrypted_profile?: string | null; // base64 encrypted blob
}

export interface MutualFriendInfo {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
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
  is_friend: boolean;
  friend_request_status: "pending_incoming" | "pending_outgoing" | null;
  friendship_id: string | null;
  mutual_friend_count: number;
  mutual_friends: MutualFriendInfo[];
  mutual_server_count: number;
  roles?: RoleResponse[];
  encrypted_profile?: string | null; // base64 encrypted blob
}

export interface UpdateProfileRequest {
  display_name?: string | null;
  about_me?: string | null;
  custom_status?: string | null;
  custom_status_emoji?: string | null;
  encrypted_profile?: string; // base64 encrypted blob
}

export interface ProfileKeyDistributionEntry {
  to_user_id: string;
  encrypted_profile_key: string; // base64
}

export interface DistributeProfileKeysRequest {
  distributions: ProfileKeyDistributionEntry[];
}

export interface ProfileKeyResponse {
  from_user_id: string;
  encrypted_profile_key: string; // base64
}

/** Plaintext fields stored inside the encrypted profile blob */
export interface ProfileFields {
  about_me?: string | null;
  custom_status?: string | null;
  custom_status_emoji?: string | null;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
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
  my_permissions?: string; // i64 as string for JS BigInt safety
  system_channel_id?: string; // channel where system messages (joins, etc.) are posted
}

// ─── Channels ──────────────────────────────────────────

export interface CreateChannelRequest {
  encrypted_meta: string; // base64
  channel_type?: string;
  position?: number;
  category_id?: string | null;
}

export interface ChannelResponse {
  id: string;
  server_id: string | null;
  encrypted_meta: string; // base64
  channel_type: string;
  position: number;
  created_at: string;
  category_id: string | null;
  dm_status?: string; // "active", "pending", "declined" — only for DM channels
}

// ─── Channel Categories ───────────────────────────────

export interface CategoryResponse {
  id: string;
  server_id: string;
  name: string;
  position: number;
  created_at: string;
}

export interface CreateCategoryRequest {
  name: string;
  position?: number;
}

export interface UpdateCategoryRequest {
  name?: string;
  position?: number;
}

export interface ReorderCategoriesRequest {
  order: Array<{ id: string; position: number }>;
}

export interface SetChannelCategoryRequest {
  category_id: string | null;
}

export interface ReorderChannelsRequest {
  order: Array<{ id: string; position: number; category_id: string | null }>;
}

export interface CreateDmRequest {
  target_user_id: string;
  encrypted_meta: string; // base64
}

export interface CreateGroupDmRequest {
  member_ids: string[];
  encrypted_meta: string; // base64
}

// ─── Channel Members ─────────────────────────────────

export interface ChannelMemberInfo {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  joined_at: string;
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
  reply_to_id: string | null;
  message_type?: string;  // "user" | "system"
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
  | { type: "SendMessage"; payload: { channel_id: string; sender_token: string; encrypted_body: string; expires_at?: string; attachment_ids?: string[]; reply_to_id?: string } }
  | { type: "EditMessage"; payload: { message_id: string; encrypted_body: string } }
  | { type: "DeleteMessage"; payload: { message_id: string } }
  | { type: "AddReaction"; payload: { message_id: string; emoji: string } }
  | { type: "RemoveReaction"; payload: { message_id: string; emoji: string } }
  | { type: "Subscribe"; payload: { channel_id: string } }
  | { type: "Unsubscribe"; payload: { channel_id: string } }
  | { type: "Typing"; payload: { channel_id: string } }
  | { type: "SetStatus"; payload: { status: string } }
  | { type: "PinMessage"; payload: { channel_id: string; message_id: string } }
  | { type: "UnpinMessage"; payload: { channel_id: string; message_id: string } }
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
  | { type: "PresenceUpdate"; payload: { user_id: string; status: string } }
  | { type: "FriendRequestReceived"; payload: { from_user_id: string; from_username: string; friendship_id: string } }
  | { type: "FriendRequestAccepted"; payload: { user_id: string; username: string; friendship_id: string } }
  | { type: "FriendRemoved"; payload: { user_id: string } }
  | { type: "DmRequestReceived"; payload: { channel_id: string; from_user_id: string } }
  | { type: "MessagePinned"; payload: { channel_id: string; message_id: string; pinned_by: string } }
  | { type: "MessageUnpinned"; payload: { channel_id: string; message_id: string } }
  | { type: "VoiceStateUpdate"; payload: { channel_id: string; user_id: string; username: string; joined: boolean } };

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
  nickname?: string | null;
  role_ids: string[];
}

// ─── Roles & Permissions ─────────────────────────────

export const Permission = {
  ADMINISTRATOR:        BigInt(1) << BigInt(0),
  MANAGE_SERVER:        BigInt(1) << BigInt(1),
  MANAGE_ROLES:         BigInt(1) << BigInt(2),
  MANAGE_CHANNELS:      BigInt(1) << BigInt(3),
  KICK_MEMBERS:         BigInt(1) << BigInt(4),
  BAN_MEMBERS:          BigInt(1) << BigInt(5),
  MANAGE_MESSAGES:      BigInt(1) << BigInt(6),
  VIEW_CHANNELS:        BigInt(1) << BigInt(7),
  SEND_MESSAGES:        BigInt(1) << BigInt(8),
  CREATE_INVITES:       BigInt(1) << BigInt(9),
  MANAGE_INVITES:       BigInt(1) << BigInt(10),
  ADD_REACTIONS:        BigInt(1) << BigInt(11),
  MENTION_EVERYONE:     BigInt(1) << BigInt(12),
  ATTACH_FILES:         BigInt(1) << BigInt(13),
  READ_MESSAGE_HISTORY: BigInt(1) << BigInt(14),
} as const;

export interface RoleResponse {
  id: string;
  server_id: string;
  name: string;
  color: string | null;
  permissions: string; // bigint as string
  position: number;
  is_default: boolean;
  created_at: string;
}

export interface CreateRoleRequest {
  name: string;
  color?: string;
  permissions?: string;
  position?: number;
}

export interface UpdateRoleRequest {
  name?: string;
  color?: string;
  permissions?: string;
  position?: number;
}

export interface AssignRoleRequest {
  role_id: string;
}

export interface OverwriteResponse {
  id: string;
  channel_id: string;
  target_type: string;
  target_id: string;
  allow_bits: string;
  deny_bits: string;
}

export interface SetOverwriteRequest {
  target_type: string;
  target_id: string;
  allow_bits: string;
  deny_bits: string;
}

// ─── Bans ────────────────────────────────────────────

export interface BanResponse {
  id: string;
  user_id: string;
  username: string;
  reason: string | null;
  banned_by: string;
  created_at: string;
}

export interface CreateBanRequest {
  reason?: string;
}

export interface AddGroupMemberRequest {
  user_id: string;
}

// ─── Friends ──────────────────────────────────────────

export interface FriendResponse {
  id: string;           // friendship ID
  user_id: string;      // the other user
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string;       // "pending", "accepted"
  is_incoming: boolean;  // true if the other user sent the request
  created_at: string;
}

export interface FriendRequestBody {
  username: string;
}

export interface DmRequestAction {
  action: string; // "accept" or "decline"
}

export interface UpdateDmPrivacyRequest {
  dm_privacy: string; // "everyone", "friends_only", "server_members"
}

// ─── Reports ─────────────────────────────────────────

export interface CreateReportRequest {
  message_id: string;
  channel_id: string;
  reason: string;
}

export interface ReportResponse {
  id: string;
  message_id: string;
  reason: string;
  status: string;
  created_at: string;
}

// ─── Voice ────────────────────────────────────────────

export interface VoiceTokenResponse {
  token: string;
  url: string;
  channel_id: string;
}

export interface VoiceParticipant {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

// ─── API Error ─────────────────────────────────────────

export interface ApiError {
  error: string;
  status: number;
}
