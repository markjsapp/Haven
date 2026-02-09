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
  UploadUrlResponse,
  DownloadUrlResponse,
  ApiError,
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

  async listDmChannels(): Promise<ChannelResponse[]> {
    return this.get<ChannelResponse[]>("/api/v1/dm");
  }

  async createDm(req: CreateDmRequest): Promise<ChannelResponse> {
    return this.post<ChannelResponse>("/api/v1/dm", req);
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

  // ─── Attachments ─────────────────────────────────

  async requestUpload(): Promise<UploadUrlResponse> {
    return this.post<UploadUrlResponse>("/api/v1/attachments/upload", {});
  }

  async requestDownload(attachmentId: string): Promise<DownloadUrlResponse> {
    return this.get<DownloadUrlResponse>(`/api/v1/attachments/${attachmentId}`);
  }

  // ─── HTTP Helpers ────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
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
