import type {
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  RefreshRequest,
  TotpSetupResponse,
  TotpVerifyRequest,
  KeyBundle,
  UploadPreKeysRequest,
  PreKeyCountResponse,
  CreateServerRequest,
  ServerResponse,
  CreateChannelRequest,
  ChannelResponse,
  CreateDmRequest,
  SendMessageRequest,
  MessageResponse,
  MessageQuery,
  UploadResponse,
  CreateInviteRequest,
  InviteResponse,
  ServerMemberResponse,
  ApiError,
  DistributeSenderKeyRequest,
  SenderKeyDistributionResponse,
  ChannelMemberKeyInfo,
  PresenceEntry,
  UpdateKeysRequest,
  ReactionGroup,
  UserProfileResponse,
  UpdateProfileRequest,
  BlockedUserResponse,
  CategoryResponse,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  ReorderCategoriesRequest,
  SetChannelCategoryRequest,
  RoleResponse,
  CreateRoleRequest,
  UpdateRoleRequest,
  AssignRoleRequest,
  OverwriteResponse,
  SetOverwriteRequest,
  FriendResponse,
  FriendRequestBody,
  DmRequestAction,
  UpdateDmPrivacyRequest,
} from "../types.js";

export interface ApiClientOptions {
  baseUrl: string;
  onTokenExpired?: () => void;
}

/**
 * Type-safe REST client for the Haven backend.
 * Handles JWT token management and automatic refresh.
 */
export class HavenApi {
  private baseUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private onTokenExpired?: () => void;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.onTokenExpired = options.onTokenExpired;
  }

  /** Set auth tokens (after login/register/refresh). */
  setTokens(access: string, refresh: string): void {
    this.accessToken = access;
    this.refreshToken = refresh;
  }

  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }

  get currentAccessToken(): string | null {
    return this.accessToken;
  }

  // ─── Auth ────────────────────────────────────────

  async register(req: RegisterRequest): Promise<AuthResponse> {
    const res = await this.post<AuthResponse>("/api/v1/auth/register", req);
    this.setTokens(res.access_token, res.refresh_token);
    return res;
  }

  async login(req: LoginRequest): Promise<AuthResponse> {
    const res = await this.post<AuthResponse>("/api/v1/auth/login", req);
    this.setTokens(res.access_token, res.refresh_token);
    return res;
  }

  async refresh(): Promise<AuthResponse> {
    if (!this.refreshToken) throw new Error("No refresh token");
    const req: RefreshRequest = { refresh_token: this.refreshToken };
    const res = await this.post<AuthResponse>("/api/v1/auth/refresh", req);
    this.setTokens(res.access_token, res.refresh_token);
    return res;
  }

  async logout(): Promise<void> {
    await this.post("/api/v1/auth/logout", {});
    this.clearTokens();
  }

  async totpSetup(): Promise<TotpSetupResponse> {
    return this.post<TotpSetupResponse>("/api/v1/auth/totp/setup", {});
  }

  async totpVerify(req: TotpVerifyRequest): Promise<void> {
    await this.post("/api/v1/auth/totp/verify", req);
  }

  async totpDisable(): Promise<void> {
    await this.delete("/api/v1/auth/totp");
  }

  // ─── Users ────────────────────────────────────────

  async getUserByUsername(username: string): Promise<import("../types.js").UserPublic> {
    return this.get(`/api/v1/users/search?username=${encodeURIComponent(username)}`);
  }

  // ─── Keys ────────────────────────────────────────

  async getKeyBundle(userId: string): Promise<KeyBundle> {
    return this.get<KeyBundle>(`/api/v1/users/${userId}/keys`);
  }

  async uploadPreKeys(req: UploadPreKeysRequest): Promise<void> {
    await this.post("/api/v1/keys/prekeys", req);
  }

  async getPreKeyCount(): Promise<PreKeyCountResponse> {
    return this.get<PreKeyCountResponse>("/api/v1/keys/prekeys/count");
  }

  async updateKeys(req: UpdateKeysRequest): Promise<void> {
    await this.put("/api/v1/keys/identity", req);
  }

  // ─── Servers ─────────────────────────────────────

  async listServers(): Promise<ServerResponse[]> {
    return this.get<ServerResponse[]>("/api/v1/servers");
  }

  async createServer(req: CreateServerRequest): Promise<ServerResponse> {
    return this.post<ServerResponse>("/api/v1/servers", req);
  }

  async getServer(serverId: string): Promise<ServerResponse> {
    return this.get<ServerResponse>(`/api/v1/servers/${serverId}`);
  }

  async listServerChannels(serverId: string): Promise<ChannelResponse[]> {
    return this.get<ChannelResponse[]>(`/api/v1/servers/${serverId}/channels`);
  }

  async createChannel(serverId: string, req: CreateChannelRequest): Promise<ChannelResponse> {
    return this.post<ChannelResponse>(`/api/v1/servers/${serverId}/channels`, req);
  }

  // ─── Channels ────────────────────────────────────

  async joinChannel(channelId: string): Promise<void> {
    await this.post(`/api/v1/channels/${channelId}/join`, {});
  }

  async updateChannel(channelId: string, req: { encrypted_meta: string }): Promise<ChannelResponse> {
    return this.put<ChannelResponse>(`/api/v1/channels/${channelId}`, req);
  }

  async deleteChannel(channelId: string): Promise<void> {
    await this.delete(`/api/v1/channels/${channelId}`);
  }

  async listDmChannels(): Promise<ChannelResponse[]> {
    return this.get<ChannelResponse[]>("/api/v1/dm");
  }

  async createDm(req: CreateDmRequest): Promise<ChannelResponse> {
    return this.post<ChannelResponse>("/api/v1/dm", req);
  }

  // ─── Channel Categories ─────────────────────────

  async listCategories(serverId: string): Promise<CategoryResponse[]> {
    return this.get<CategoryResponse[]>(`/api/v1/servers/${serverId}/categories`);
  }

  async createCategory(serverId: string, req: CreateCategoryRequest): Promise<CategoryResponse> {
    return this.post<CategoryResponse>(`/api/v1/servers/${serverId}/categories`, req);
  }

  async updateCategory(serverId: string, categoryId: string, req: UpdateCategoryRequest): Promise<CategoryResponse> {
    return this.put<CategoryResponse>(`/api/v1/servers/${serverId}/categories/${categoryId}`, req);
  }

  async deleteCategory(serverId: string, categoryId: string): Promise<void> {
    await this.delete(`/api/v1/servers/${serverId}/categories/${categoryId}`);
  }

  async reorderCategories(serverId: string, req: ReorderCategoriesRequest): Promise<void> {
    await this.put(`/api/v1/servers/${serverId}/categories/reorder`, req);
  }

  async setChannelCategory(channelId: string, req: SetChannelCategoryRequest): Promise<ChannelResponse> {
    return this.put<ChannelResponse>(`/api/v1/channels/${channelId}/category`, req);
  }

  // ─── Roles & Permissions ────────────────────────

  async listRoles(serverId: string): Promise<RoleResponse[]> {
    return this.get<RoleResponse[]>(`/api/v1/servers/${serverId}/roles`);
  }

  async createRole(serverId: string, req: CreateRoleRequest): Promise<RoleResponse> {
    return this.post<RoleResponse>(`/api/v1/servers/${serverId}/roles`, req);
  }

  async updateRole(serverId: string, roleId: string, req: UpdateRoleRequest): Promise<RoleResponse> {
    return this.put<RoleResponse>(`/api/v1/servers/${serverId}/roles/${roleId}`, req);
  }

  async deleteRole(serverId: string, roleId: string): Promise<void> {
    await this.delete(`/api/v1/servers/${serverId}/roles/${roleId}`);
  }

  async assignRole(serverId: string, userId: string, req: AssignRoleRequest): Promise<void> {
    await this.put(`/api/v1/servers/${serverId}/members/${userId}/roles`, req);
  }

  async unassignRole(serverId: string, userId: string, roleId: string): Promise<void> {
    await this.delete(`/api/v1/servers/${serverId}/members/${userId}/roles/${roleId}`);
  }

  async listOverwrites(channelId: string): Promise<OverwriteResponse[]> {
    return this.get<OverwriteResponse[]>(`/api/v1/channels/${channelId}/overwrites`);
  }

  async setOverwrite(channelId: string, req: SetOverwriteRequest): Promise<OverwriteResponse> {
    return this.put<OverwriteResponse>(`/api/v1/channels/${channelId}/overwrites`, req);
  }

  async deleteOverwrite(channelId: string, targetType: string, targetId: string): Promise<void> {
    await this.delete(`/api/v1/channels/${channelId}/overwrites/${targetType}/${targetId}`);
  }

  // ─── Messages ────────────────────────────────────

  async getMessages(channelId: string, query?: MessageQuery): Promise<MessageResponse[]> {
    const params = new URLSearchParams();
    if (query?.before) params.set("before", query.before);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return this.get<MessageResponse[]>(
      `/api/v1/channels/${channelId}/messages${qs ? `?${qs}` : ""}`,
    );
  }

  async sendMessage(channelId: string, req: SendMessageRequest): Promise<MessageResponse> {
    return this.post<MessageResponse>(`/api/v1/channels/${channelId}/messages`, req);
  }

  async getChannelReactions(channelId: string): Promise<ReactionGroup[]> {
    return this.get<ReactionGroup[]>(`/api/v1/channels/${channelId}/reactions`);
  }

  // ─── Attachments ─────────────────────────────────

  /** Upload encrypted blob directly to backend. Returns attachment_id + storage_key. */
  async uploadAttachment(blob: ArrayBuffer): Promise<UploadResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${this.baseUrl}/api/v1/attachments/upload`, {
      method: "POST",
      headers,
      body: blob,
    });

    if (!res.ok) {
      if (res.status === 401 && this.onTokenExpired) {
        this.onTokenExpired();
      }
      const err: ApiError = await res.json().catch(() => ({
        error: res.statusText,
        status: res.status,
      }));
      throw new HavenApiError(err.error, err.status);
    }

    return res.json() as Promise<UploadResponse>;
  }

  /** Download encrypted blob from backend. Returns raw bytes. */
  async downloadAttachment(attachmentId: string): Promise<ArrayBuffer> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${this.baseUrl}/api/v1/attachments/${attachmentId}`, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      if (res.status === 401 && this.onTokenExpired) {
        this.onTokenExpired();
      }
      throw new HavenApiError(`Download failed: ${res.statusText}`, res.status);
    }

    return res.arrayBuffer();
  }

  // ─── Invites ───────────────────────────────────────

  async createInvite(serverId: string, req: CreateInviteRequest): Promise<InviteResponse> {
    return this.post<InviteResponse>(`/api/v1/servers/${serverId}/invites`, req);
  }

  async listInvites(serverId: string): Promise<InviteResponse[]> {
    return this.get<InviteResponse[]>(`/api/v1/servers/${serverId}/invites`);
  }

  async deleteInvite(serverId: string, inviteId: string): Promise<void> {
    await this.delete(`/api/v1/servers/${serverId}/invites/${inviteId}`);
  }

  async joinByInvite(code: string): Promise<ServerResponse> {
    return this.post<ServerResponse>(`/api/v1/invites/${code}/join`, {});
  }

  // ─── Server Members ───────────────────────────────

  async listServerMembers(serverId: string): Promise<ServerMemberResponse[]> {
    return this.get<ServerMemberResponse[]>(`/api/v1/servers/${serverId}/members`);
  }

  async kickMember(serverId: string, userId: string): Promise<void> {
    await this.delete(`/api/v1/servers/${serverId}/members/${userId}`);
  }

  // ─── Sender Keys ───────────────────────────────────

  async distributeSenderKeys(
    channelId: string,
    req: DistributeSenderKeyRequest,
  ): Promise<void> {
    await this.post(`/api/v1/channels/${channelId}/sender-keys`, req);
  }

  async getSenderKeys(
    channelId: string,
  ): Promise<SenderKeyDistributionResponse[]> {
    return this.get<SenderKeyDistributionResponse[]>(
      `/api/v1/channels/${channelId}/sender-keys`,
    );
  }

  async getChannelMemberKeys(
    channelId: string,
  ): Promise<ChannelMemberKeyInfo[]> {
    return this.get<ChannelMemberKeyInfo[]>(
      `/api/v1/channels/${channelId}/members/keys`,
    );
  }

  // ─── Link Previews ──────────────────────────────

  async fetchLinkPreview(
    url: string,
  ): Promise<{ url: string; title?: string; description?: string; image?: string; site_name?: string }> {
    return this.get(`/api/v1/link-preview?url=${encodeURIComponent(url)}`);
  }

  // ─── Presence ─────────────────────────────────────

  async getPresence(userIds: string[]): Promise<PresenceEntry[]> {
    return this.get<PresenceEntry[]>(
      `/api/v1/presence?user_ids=${userIds.join(",")}`,
    );
  }

  // ─── User Profiles ──────────────────────────────

  async getUserProfile(userId: string): Promise<UserProfileResponse> {
    return this.get<UserProfileResponse>(`/api/v1/users/${userId}/profile`);
  }

  async updateProfile(req: UpdateProfileRequest): Promise<import("../types.js").UserPublic> {
    return this.put(`/api/v1/users/profile`, req);
  }

  // ─── Friends ──────────────────────────────────────

  async listFriends(): Promise<FriendResponse[]> {
    return this.get<FriendResponse[]>("/api/v1/friends");
  }

  async sendFriendRequest(req: FriendRequestBody): Promise<FriendResponse> {
    return this.post<FriendResponse>("/api/v1/friends/request", req);
  }

  async acceptFriendRequest(friendshipId: string): Promise<FriendResponse> {
    return this.post<FriendResponse>(`/api/v1/friends/${friendshipId}/accept`, {});
  }

  async declineFriendRequest(friendshipId: string): Promise<void> {
    await this.post(`/api/v1/friends/${friendshipId}/decline`, {});
  }

  async removeFriend(friendshipId: string): Promise<void> {
    await this.delete(`/api/v1/friends/${friendshipId}`);
  }

  // ─── DM Requests ─────────────────────────────────

  async listDmRequests(): Promise<ChannelResponse[]> {
    return this.get<ChannelResponse[]>("/api/v1/dm/requests");
  }

  async handleDmRequest(channelId: string, req: DmRequestAction): Promise<void> {
    await this.post(`/api/v1/dm/${channelId}/request`, req);
  }

  async updateDmPrivacy(req: UpdateDmPrivacyRequest): Promise<void> {
    await this.put("/api/v1/users/dm-privacy", req);
  }

  // ─── Blocked Users ─────────────────────────────

  async blockUser(userId: string): Promise<void> {
    await this.post(`/api/v1/users/${userId}/block`, {});
  }

  async unblockUser(userId: string): Promise<void> {
    await this.delete(`/api/v1/users/${userId}/block`);
  }

  async getBlockedUsers(): Promise<BlockedUserResponse[]> {
    return this.get<BlockedUserResponse[]>("/api/v1/users/blocked");
  }

  // ─── HTTP Helpers ────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  private async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      if (res.status === 401 && this.onTokenExpired) {
        this.onTokenExpired();
      }
      const err: ApiError = await res.json().catch(() => ({
        error: res.statusText,
        status: res.status,
      }));
      throw new HavenApiError(err.error, err.status);
    }

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

export class HavenApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HavenApiError";
    this.status = status;
  }
}
