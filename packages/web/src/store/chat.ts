import { create } from "zustand";
import {
  HavenWs,
  encryptFile,
  toBase64,
  type ChannelResponse,
  type CategoryResponse,
  type RoleResponse,
  type MessageResponse,
  type ServerResponse,
  type WsServerMessage,
  type ReactionGroup,
} from "@haven/core";
import { useAuthStore } from "./auth.js";
import { usePresenceStore } from "./presence.js";
import { decryptIncoming, encryptOutgoing, ensureSession, fetchSenderKeys, mapChannelToPeer } from "../lib/crypto.js";
import { cacheMessage, getCachedMessage, uncacheMessage } from "../lib/message-cache.js";

export interface AttachmentMeta {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  key: string;   // base64 — file encryption key
  nonce: string;  // base64 — file encryption nonce
  thumbnail?: string; // base64 data URL — small JPEG preview (images only)
  width?: number;     // original image width
  height?: number;    // original image height
}

export interface PendingUpload {
  file: File;
  progress: number; // 0-100
  status: "pending" | "uploading" | "done" | "error";
  meta?: AttachmentMeta;
}

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site_name?: string;
}

export interface DecryptedMessage {
  id: string;
  channelId: string;
  senderId: string;
  text: string;
  attachments?: AttachmentMeta[];
  linkPreviews?: LinkPreview[];
  contentType?: string;
  formatting?: object;
  timestamp: string;
  edited?: boolean;
  replyToId?: string | null;
  messageType?: string; // "user" | "system"
  raw: MessageResponse;
}

interface ChatState {
  servers: ServerResponse[];
  channels: ChannelResponse[];
  /** serverId -> categories for that server */
  categories: Record<string, CategoryResponse[]>;
  /** serverId -> roles for that server */
  roles: Record<string, RoleResponse[]>;
  currentChannelId: string | null;
  messages: Record<string, DecryptedMessage[]>;
  pendingUploads: PendingUpload[];
  editingMessageId: string | null;
  replyingToId: string | null;
  /** channelId -> set of pinned message IDs */
  pinnedMessageIds: Record<string, string[]>;
  ws: HavenWs | null;
  wsState: "disconnected" | "connecting" | "connected";
  /** userId -> expiry timestamp + username, per channel */
  typingUsers: Record<string, Array<{ userId: string; username: string; expiry: number }>>;
  /** Global userId -> displayName map, populated from server member lists */
  userNames: Record<string, string>;
  /** messageId -> array of { emoji, userIds } */
  reactions: Record<string, Array<{ emoji: string; userIds: string[] }>>;
  /** IDs of users blocked by the current user */
  blockedUserIds: string[];

  connect(): void;
  disconnect(): void;
  loadChannels(): Promise<void>;
  selectChannel(channelId: string): Promise<void>;
  sendMessage(text: string, attachments?: AttachmentMeta[], formatting?: { contentType: string; data: object }): Promise<void>;
  sendTyping(): void;
  startDm(targetUsername: string): Promise<ChannelResponse>;
  addFiles(files: File[]): void;
  removePendingUpload(index: number): void;
  uploadPendingFiles(): Promise<AttachmentMeta[]>;
  startEditing(messageId: string): void;
  cancelEditing(): void;
  submitEdit(messageId: string, text: string, formatting?: { contentType: string; data: object }): Promise<void>;
  deleteMessage(messageId: string): void;
  startReply(messageId: string): void;
  cancelReply(): void;
  loadPins(channelId: string): Promise<void>;
  pinMessage(messageId: string): void;
  unpinMessage(messageId: string): void;
  addReaction(messageId: string, emoji: string): void;
  removeReaction(messageId: string, emoji: string): void;
  toggleReaction(messageId: string, emoji: string): void;
  loadBlockedUsers(): Promise<void>;
}

const TYPING_EXPIRY_MS = 3000;
const TYPING_THROTTLE_MS = 500;
let lastTypingSent = 0;

// ─── DM Channel Helpers ─────────────────────────────────

/** Parse a DM channel's meta and register the channel→peer mapping for E2EE routing. */
function mapDmChannelPeer(channel: ChannelResponse, myUserId: string): void {
  if (channel.channel_type !== "dm") return;
  try {
    const meta = JSON.parse(atob(channel.encrypted_meta));
    if (meta.type !== "dm" || !Array.isArray(meta.participants)) return;
    const peerId = meta.participants.find((id: string) => id !== myUserId);
    if (peerId) mapChannelToPeer(channel.id, peerId);
  } catch { /* non-fatal */ }
}

// ─── Optimistic Send State ──────────────────────────────
// Queue of temporary IDs awaiting a MessageAck from the server
const pendingAcks: string[] = [];
// Real message IDs we've sent — used to skip our own NewMessage broadcast
const ownMessageIds = new Set<string>();

export const useChatStore = create<ChatState>((set, get) => ({
  servers: [],
  channels: [],
  categories: {},
  roles: {},
  currentChannelId: null,
  messages: {},
  pendingUploads: [],
  editingMessageId: null,
  replyingToId: null,
  pinnedMessageIds: {},
  ws: null,
  wsState: "disconnected",
  typingUsers: {},
  userNames: {},
  reactions: {},
  blockedUserIds: [],

  connect() {
    const { api } = useAuthStore.getState();
    const token = api.currentAccessToken;
    if (!token) return;

    const ws = new HavenWs({
      baseUrl: window.location.origin,
      token,
    });

    ws.onConnect(() => set({ wsState: "connected" }));
    ws.onDisconnect(() => set({ wsState: "disconnected" }));

    ws.on("NewMessage", (msg: Extract<WsServerMessage, { type: "NewMessage" }>) => {
      handleIncomingMessage(msg.payload);
    });

    ws.on("MessageEdited", (msg: Extract<WsServerMessage, { type: "MessageEdited" }>) => {
      handleMessageEdited(msg.payload);
    });

    ws.on("MessageDeleted", (msg: Extract<WsServerMessage, { type: "MessageDeleted" }>) => {
      const { message_id, channel_id } = msg.payload;
      uncacheMessage(message_id);
      set((state) => {
        const channelMsgs = state.messages[channel_id];
        if (!channelMsgs) return state;
        return {
          messages: {
            ...state.messages,
            [channel_id]: channelMsgs.filter((m) => m.id !== message_id),
          },
        };
      });
    });

    ws.on("ReactionAdded", (msg: Extract<WsServerMessage, { type: "ReactionAdded" }>) => {
      const { message_id, user_id, emoji } = msg.payload;
      set((state) => {
        const groups = [...(state.reactions[message_id] ?? [])];
        const existing = groups.find((g) => g.emoji === emoji);
        if (existing) {
          if (!existing.userIds.includes(user_id)) {
            existing.userIds = [...existing.userIds, user_id];
          }
        } else {
          groups.push({ emoji, userIds: [user_id] });
        }
        return { reactions: { ...state.reactions, [message_id]: groups } };
      });
    });

    ws.on("ReactionRemoved", (msg: Extract<WsServerMessage, { type: "ReactionRemoved" }>) => {
      const { message_id, user_id, emoji } = msg.payload;
      set((state) => {
        const groups = (state.reactions[message_id] ?? [])
          .map((g) => {
            if (g.emoji !== emoji) return g;
            return { ...g, userIds: g.userIds.filter((id) => id !== user_id) };
          })
          .filter((g) => g.userIds.length > 0);
        return { reactions: { ...state.reactions, [message_id]: groups } };
      });
    });

    ws.on("MessageAck", (msg: Extract<WsServerMessage, { type: "MessageAck" }>) => {
      const tempId = pendingAcks.shift();
      if (!tempId) return;
      const realId = msg.payload.message_id;
      ownMessageIds.add(realId);

      // Replace temp ID with real server-assigned ID in the store and cache
      set((state) => {
        const updated: Record<string, DecryptedMessage[]> = {};
        for (const [chId, msgs] of Object.entries(state.messages)) {
          const idx = msgs.findIndex((m) => m.id === tempId);
          if (idx !== -1) {
            const copy = [...msgs];
            copy[idx] = { ...copy[idx], id: realId };
            cacheMessage(copy[idx]);
            updated[chId] = copy;
          }
        }
        if (Object.keys(updated).length === 0) return state;
        return { messages: { ...state.messages, ...updated } };
      });
    });

    ws.on("SenderKeysUpdated", (msg: Extract<WsServerMessage, { type: "SenderKeysUpdated" }>) => {
      fetchSenderKeys(msg.payload.channel_id).catch(() => {});
    });

    ws.on("PresenceUpdate", (msg: Extract<WsServerMessage, { type: "PresenceUpdate" }>) => {
      usePresenceStore.getState().setStatus(msg.payload.user_id, msg.payload.status);
    });

    // Friend events — dynamically import friends store to avoid circular deps
    ws.on("FriendRequestReceived", () => {
      import("./friends.js").then(({ useFriendsStore }) => {
        useFriendsStore.getState().loadFriends();
      });
    });
    ws.on("FriendRequestAccepted", () => {
      import("./friends.js").then(({ useFriendsStore }) => {
        useFriendsStore.getState().loadFriends();
      });
    });
    ws.on("FriendRemoved", () => {
      import("./friends.js").then(({ useFriendsStore }) => {
        useFriendsStore.getState().loadFriends();
      });
    });
    ws.on("MessagePinned", (msg: Extract<WsServerMessage, { type: "MessagePinned" }>) => {
      const { channel_id, message_id } = msg.payload;
      set((state) => {
        const existing = state.pinnedMessageIds[channel_id] ?? [];
        if (existing.includes(message_id)) return state;
        return {
          pinnedMessageIds: {
            ...state.pinnedMessageIds,
            [channel_id]: [...existing, message_id],
          },
        };
      });
    });

    ws.on("MessageUnpinned", (msg: Extract<WsServerMessage, { type: "MessageUnpinned" }>) => {
      const { channel_id, message_id } = msg.payload;
      set((state) => {
        const existing = state.pinnedMessageIds[channel_id] ?? [];
        return {
          pinnedMessageIds: {
            ...state.pinnedMessageIds,
            [channel_id]: existing.filter((id) => id !== message_id),
          },
        };
      });
    });

    ws.on("DmRequestReceived", () => {
      import("./friends.js").then(({ useFriendsStore }) => {
        useFriendsStore.getState().loadDmRequests();
      });
      // Also reload channels to show the new pending DM
      get().loadChannels();
    });

    ws.on("UserTyping", (msg: Extract<WsServerMessage, { type: "UserTyping" }>) => {
      const { channel_id, user_id, username } = msg.payload;
      const myId = useAuthStore.getState().user?.id;
      if (user_id === myId) return; // ignore own typing

      const expiry = Date.now() + TYPING_EXPIRY_MS;
      set((state) => {
        const existing = (state.typingUsers[channel_id] ?? []).filter(
          (t) => t.userId !== user_id && t.expiry > Date.now(),
        );
        return {
          typingUsers: {
            ...state.typingUsers,
            [channel_id]: [...existing, { userId: user_id, username, expiry }],
          },
        };
      });

      // Schedule cleanup
      setTimeout(() => {
        set((state) => {
          const filtered = (state.typingUsers[channel_id] ?? []).filter(
            (t) => t.expiry > Date.now(),
          );
          return {
            typingUsers: { ...state.typingUsers, [channel_id]: filtered },
          };
        });
      }, TYPING_EXPIRY_MS + 100);
    });

    ws.connect();
    set({ ws, wsState: "connecting" });

    // Provide WS setStatus to presence store (avoids circular import)
    usePresenceStore.setState({ _wsSendStatus: (status: string) => ws.setStatus(status) });
  },

  disconnect() {
    get().ws?.disconnect();
    set({ ws: null, wsState: "disconnected" });
  },

  sendTyping() {
    const now = Date.now();
    if (now - lastTypingSent < TYPING_THROTTLE_MS) return;
    const { ws, currentChannelId } = get();
    if (!ws || !currentChannelId) return;
    lastTypingSent = now;
    try { ws.typing(currentChannelId); } catch { /* not connected */ }
  },

  async loadChannels() {
    const { api } = useAuthStore.getState();

    // Load servers, then channels + categories + roles for each server (in parallel)
    const servers = await api.listServers();
    const [serverChannelArrays, serverCategoryArrays, serverRoleArrays] = await Promise.all([
      Promise.all(servers.map((server) => api.listServerChannels(server.id))),
      Promise.all(servers.map((server) => api.listCategories(server.id))),
      Promise.all(servers.map((server) => api.listRoles(server.id))),
    ]);
    const allChannels: ChannelResponse[] = serverChannelArrays.flat();

    // Build categories map: serverId -> CategoryResponse[]
    const categories: Record<string, CategoryResponse[]> = {};
    const roles: Record<string, RoleResponse[]> = {};
    servers.forEach((server, i) => {
      categories[server.id] = serverCategoryArrays[i];
      roles[server.id] = serverRoleArrays[i];
    });

    // Also load DM channels
    const dmChannels = await api.listDmChannels();
    allChannels.push(...dmChannels);

    // Map DM channels to their peer for E2EE session routing
    const { user } = useAuthStore.getState();
    if (user) {
      for (const ch of dmChannels) {
        mapDmChannelPeer(ch, user.id);
      }
    }

    // Extract names from DM/group channel metadata
    const dmUserNames: Record<string, string> = {};
    for (const ch of dmChannels) {
      try {
        const meta = JSON.parse(atob(ch.encrypted_meta));
        if (meta.names) {
          for (const [id, name] of Object.entries(meta.names)) {
            if (!dmUserNames[id]) dmUserNames[id] = name as string;
          }
        }
      } catch { /* non-fatal */ }
    }

    // Build global userId -> displayName map from server members
    const memberArrays = await Promise.all(
      servers.map((server) => api.listServerMembers(server.id))
    );
    const userNames: Record<string, string> = {};
    for (const members of memberArrays) {
      for (const m of members) {
        userNames[m.user_id] = m.display_name || m.username;
      }
    }

    // Merge DM/group names (server member names take priority)
    const mergedUserNames = { ...dmUserNames, ...userNames };
    set({ servers, channels: allChannels, categories, roles, userNames: mergedUserNames });

    // Load blocked users list
    get().loadBlockedUsers();

    // Subscribe to all channels via WebSocket
    const { ws } = get();
    if (ws && get().wsState === "connected") {
      for (const ch of allChannels) {
        ws.subscribe(ch.id);
      }
    }
  },

  async selectChannel(channelId) {
    set({ currentChannelId: channelId });

    // Fetch any pending sender key distributions for this channel
    try {
      await fetchSenderKeys(channelId);
    } catch {
      // Non-fatal: will retry on next message or WS notification
    }

    // Load message history if we haven't already
    if (!get().messages[channelId]) {
      const { api } = useAuthStore.getState();
      const rawMessages = await api.getMessages(channelId, { limit: 50 });

      const decrypted: DecryptedMessage[] = [];
      for (const raw of rawMessages) {
        // System messages are unencrypted — parse directly
        if (raw.message_type === "system") {
          decrypted.push({
            id: raw.id,
            channelId: raw.channel_id,
            senderId: raw.sender_token, // repurposed for system msgs
            text: raw.encrypted_body,   // plaintext for system msgs
            timestamp: raw.timestamp,
            messageType: "system",
            raw,
          });
          continue;
        }
        try {
          const msg = await decryptIncoming(raw);
          msg.edited = raw.edited;
          msg.replyToId = raw.reply_to_id;
          cacheMessage(msg);
          decrypted.push(msg);
        } catch {
          // Can't decrypt — try local cache (survives re-login)
          const cached = getCachedMessage(raw.id, raw.channel_id, raw.timestamp, raw.edited, raw);
          if (cached) {
            cached.replyToId = raw.reply_to_id;
            decrypted.push(cached);
          } else {
            decrypted.push({
              id: raw.id,
              channelId: raw.channel_id,
              senderId: "unknown",
              text: "[encrypted message]",
              timestamp: raw.timestamp,
              replyToId: raw.reply_to_id,
              raw,
            });
          }
        }
      }

      // Messages come newest-first from API, reverse for display
      decrypted.reverse();

      set((state) => ({
        messages: { ...state.messages, [channelId]: decrypted },
      }));

      // Fetch reactions for these messages
      try {
        const reactionGroups = await api.getChannelReactions(channelId);
        const reactionMap: Record<string, Array<{ emoji: string; userIds: string[] }>> = {};
        for (const g of reactionGroups) {
          if (!reactionMap[g.message_id]) reactionMap[g.message_id] = [];
          reactionMap[g.message_id].push({ emoji: g.emoji, userIds: g.user_ids });
        }
        set((state) => ({
          reactions: { ...state.reactions, ...reactionMap },
        }));
      } catch {
        // Non-fatal
      }
    }

    // Subscribe to this channel
    const { ws } = get();
    if (ws) ws.subscribe(channelId);

    // Load pinned message IDs for this channel
    get().loadPins(channelId);
  },

  async sendMessage(text, attachments, formatting) {
    const { currentChannelId, ws, replyingToId } = get();
    if (!currentChannelId || !ws) return;

    const { user } = useAuthStore.getState();
    if (!user) return;

    // Detect URLs and fetch link previews (non-blocking, with timeout)
    const linkPreviews = await fetchLinkPreviews(text);

    const { senderToken, encryptedBody } = await encryptOutgoing(
      user.id,
      currentChannelId,
      text,
      attachments,
      formatting,
      linkPreviews.length > 0 ? linkPreviews : undefined,
    );

    // Optimistic insert: show our own message immediately (plaintext)
    const tempId = `temp-${crypto.randomUUID()}`;
    pendingAcks.push(tempId);

    const optimistic: DecryptedMessage = {
      id: tempId,
      channelId: currentChannelId,
      senderId: user.id,
      text,
      attachments,
      linkPreviews: linkPreviews.length > 0 ? linkPreviews : undefined,
      contentType: formatting?.contentType,
      formatting: formatting?.data,
      timestamp: new Date().toISOString(),
      replyToId: replyingToId,
      raw: {} as MessageResponse, // placeholder — replaced on ack
    };
    set((state) => appendMessage(state, currentChannelId, optimistic));

    const attachmentIds = attachments?.map((a) => a.id);
    ws.sendMessage(currentChannelId, senderToken, encryptedBody, undefined, attachmentIds, replyingToId ?? undefined);

    // Clear reply state after send
    set({ replyingToId: null });
  },

  addFiles(files: File[]) {
    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
    const rejected = files.filter((f) => f.size > MAX_FILE_SIZE);
    if (rejected.length > 0) {
      const names = rejected.map((f) => f.name).join(", ");
      alert(`File(s) too large (max 500MB): ${names}`);
    }
    const accepted = files.filter((f) => f.size <= MAX_FILE_SIZE);
    if (accepted.length === 0) return;

    const newUploads: PendingUpload[] = accepted.map((file) => ({
      file,
      progress: 0,
      status: "pending" as const,
    }));
    set((state) => ({ pendingUploads: [...state.pendingUploads, ...newUploads] }));
  },

  removePendingUpload(index: number) {
    set((state) => ({
      pendingUploads: state.pendingUploads.filter((_, i) => i !== index),
    }));
  },

  async uploadPendingFiles() {
    const { pendingUploads } = get();
    if (pendingUploads.length === 0) return [];

    const { api } = useAuthStore.getState();
    const results: AttachmentMeta[] = [];

    for (let i = 0; i < pendingUploads.length; i++) {
      const upload = pendingUploads[i];

      // Mark uploading
      set((state) => ({
        pendingUploads: state.pendingUploads.map((u, idx) =>
          idx === i ? { ...u, status: "uploading" as const, progress: 0 } : u
        ),
      }));

      try {
        // 1. Encrypt the file client-side
        const fileBytes = new Uint8Array(await upload.file.arrayBuffer());
        const { encrypted, key, nonce } = encryptFile(fileBytes);

        // 2. Upload encrypted blob directly to backend
        const encryptedBuf = (encrypted.buffer as ArrayBuffer).slice(
          encrypted.byteOffset,
          encrypted.byteOffset + encrypted.byteLength,
        );
        const { attachment_id } = await api.uploadAttachment(encryptedBuf);

        const meta: AttachmentMeta = {
          id: attachment_id,
          filename: upload.file.name,
          mime_type: upload.file.type || "application/octet-stream",
          size: upload.file.size,
          key: toBase64(key),
          nonce: toBase64(nonce),
        };

        // Generate thumbnail for images
        if (upload.file.type.startsWith("image/")) {
          const thumb = await generateThumbnail(upload.file);
          if (thumb) {
            meta.thumbnail = thumb.dataUrl;
            meta.width = thumb.width;
            meta.height = thumb.height;
          }
        }

        results.push(meta);

        // Mark done
        set((state) => ({
          pendingUploads: state.pendingUploads.map((u, idx) =>
            idx === i ? { ...u, status: "done" as const, progress: 100, meta } : u
          ),
        }));
      } catch {
        set((state) => ({
          pendingUploads: state.pendingUploads.map((u, idx) =>
            idx === i ? { ...u, status: "error" as const } : u
          ),
        }));
      }
    }

    // Clear completed uploads
    set({ pendingUploads: [] });
    return results;
  },

  startEditing(messageId: string) {
    set({ editingMessageId: messageId });
  },

  cancelEditing() {
    set({ editingMessageId: null });
  },

  startReply(messageId: string) {
    set({ replyingToId: messageId, editingMessageId: null });
  },

  cancelReply() {
    set({ replyingToId: null });
  },

  async loadPins(channelId: string) {
    const { api } = useAuthStore.getState();
    try {
      const ids = await api.getPinnedMessageIds(channelId);
      set((state) => ({
        pinnedMessageIds: { ...state.pinnedMessageIds, [channelId]: ids },
      }));
    } catch { /* non-fatal */ }
  },

  pinMessage(messageId: string) {
    const { ws, currentChannelId } = get();
    if (!ws || !currentChannelId) return;
    ws.pinMessage(currentChannelId, messageId);
  },

  unpinMessage(messageId: string) {
    const { ws, currentChannelId } = get();
    if (!ws || !currentChannelId) return;
    ws.unpinMessage(currentChannelId, messageId);
  },

  async submitEdit(messageId, text, formatting) {
    const { currentChannelId, ws } = get();
    if (!currentChannelId || !ws) return;

    const { user } = useAuthStore.getState();
    if (!user) return;

    const { encryptedBody } = await encryptOutgoing(
      user.id,
      currentChannelId,
      text,
      undefined,
      formatting,
    );

    ws.editMessage(messageId, encryptedBody);
    set({ editingMessageId: null });
  },

  deleteMessage(messageId: string) {
    const { ws, currentChannelId } = get();
    if (!ws) return;
    ws.deleteMessage(messageId);
    // Optimistic removal — remove from local state immediately
    if (currentChannelId) {
      set((state) => {
        const channelMsgs = state.messages[currentChannelId];
        if (!channelMsgs) return state;
        return {
          messages: {
            ...state.messages,
            [currentChannelId]: channelMsgs.filter((m) => m.id !== messageId),
          },
        };
      });
    }
  },

  addReaction(messageId: string, emoji: string) {
    const { ws } = get();
    if (!ws) return;
    ws.addReaction(messageId, emoji);
  },

  removeReaction(messageId: string, emoji: string) {
    const { ws } = get();
    if (!ws) return;
    ws.removeReaction(messageId, emoji);
  },

  toggleReaction(messageId: string, emoji: string) {
    const myId = useAuthStore.getState().user?.id;
    if (!myId) return;
    const groups = get().reactions[messageId] ?? [];
    const existing = groups.find((g) => g.emoji === emoji);
    if (existing && existing.userIds.includes(myId)) {
      get().removeReaction(messageId, emoji);
    } else {
      get().addReaction(messageId, emoji);
    }
  },

  async startDm(targetUsername) {
    const { api } = useAuthStore.getState();
    const { user, identityKeyPair } = useAuthStore.getState();
    if (!user || !identityKeyPair) throw new Error("Not authenticated");

    // Look up the target user by username
    const targetUser = await api.getUserByUsername(targetUsername);
    const targetUserId = targetUser.id;

    // Fetch their key bundle and establish E2EE session
    const bundle = await api.getKeyBundle(targetUserId);
    await ensureSession(targetUserId, bundle);

    // Create the DM channel (includes usernames for display)
    const meta = JSON.stringify({
      type: "dm",
      participants: [user.id, targetUserId],
      names: { [user.id]: user.username, [targetUserId]: targetUser.username },
    });
    const metaBase64 = btoa(meta);

    const channel = await api.createDm({
      target_user_id: targetUserId,
      encrypted_meta: metaBase64,
    });

    // Map channel → peer for E2EE session routing
    mapChannelToPeer(channel.id, targetUserId);

    // Subscribe via WebSocket
    const { ws } = get();
    if (ws) ws.subscribe(channel.id);

    // Add channel to state (avoid duplicates if it already exists)
    set((state) => {
      const exists = state.channels.some((ch) => ch.id === channel.id);
      return {
        channels: exists ? state.channels : [...state.channels, channel],
        currentChannelId: channel.id,
        messages: { ...state.messages, [channel.id]: state.messages[channel.id] ?? [] },
      };
    });

    return channel;
  },

  async loadBlockedUsers() {
    const { api } = useAuthStore.getState();
    try {
      const blocked = await api.getBlockedUsers();
      set({ blockedUserIds: blocked.map((b) => b.user_id) });
    } catch {
      // Non-fatal
    }
  },
}));

const MAX_MESSAGES_PER_CHANNEL = 200;

function appendMessage(
  state: { messages: Record<string, DecryptedMessage[]> },
  channelId: string,
  msg: DecryptedMessage,
) {
  const channelMsgs = state.messages[channelId] ?? [];
  if (channelMsgs.some((m) => m.id === msg.id)) return state;
  let updated = [...channelMsgs, msg];
  if (updated.length > MAX_MESSAGES_PER_CHANNEL) {
    updated = updated.slice(updated.length - MAX_MESSAGES_PER_CHANNEL);
  }
  return { messages: { ...state.messages, [channelId]: updated } };
}

async function handleIncomingMessage(raw: MessageResponse) {
  // Skip our own messages — already displayed via optimistic insert
  if (ownMessageIds.has(raw.id)) {
    ownMessageIds.delete(raw.id);
    return;
  }

  // If this message is for an unknown channel, reload channels to discover it
  const knownChannels = useChatStore.getState().channels;
  if (!knownChannels.some((ch) => ch.id === raw.channel_id)) {
    await useChatStore.getState().loadChannels();
  }

  // System messages are unencrypted
  if (raw.message_type === "system") {
    const msg: DecryptedMessage = {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: raw.sender_token,
      text: raw.encrypted_body,
      timestamp: raw.timestamp,
      messageType: "system",
      raw,
    };
    useChatStore.setState((state) => appendMessage(state, raw.channel_id, msg));
    return;
  }

  try {
    const msg = await decryptIncoming(raw);
    msg.edited = raw.edited;
    msg.replyToId = raw.reply_to_id;
    cacheMessage(msg);
    useChatStore.setState((state) => appendMessage(state, raw.channel_id, msg));
  } catch {
    // Try local cache first
    const cached = getCachedMessage(raw.id, raw.channel_id, raw.timestamp, raw.edited, raw);
    const fallback: DecryptedMessage = cached ?? {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: "unknown",
      text: "[encrypted message]",
      timestamp: raw.timestamp,
      replyToId: raw.reply_to_id,
      raw,
    };
    useChatStore.setState((state) => appendMessage(state, raw.channel_id, fallback));
  }
}

async function handleMessageEdited(payload: { message_id: string; channel_id: string; encrypted_body: string }) {
  const { channel_id, message_id, encrypted_body } = payload;

  useChatStore.setState((state) => {
    const channelMsgs = state.messages[channel_id];
    if (!channelMsgs) return state;

    const updated = channelMsgs.map((msg) => {
      if (msg.id !== message_id) return msg;

      // Re-decrypt the edited body
      const updatedRaw: MessageResponse = {
        ...msg.raw,
        encrypted_body,
        edited: true,
      };

      // We decrypt asynchronously, so schedule a re-render
      decryptIncoming(updatedRaw).then((decrypted) => {
        decrypted.edited = true;
        cacheMessage(decrypted);
        useChatStore.setState((s) => ({
          messages: {
            ...s.messages,
            [channel_id]: (s.messages[channel_id] ?? []).map((m) =>
              m.id === message_id ? decrypted : m,
            ),
          },
        }));
      }).catch(() => {});

      // Immediately mark as edited with placeholder
      return { ...msg, edited: true, raw: updatedRaw };
    });

    return { messages: { ...state.messages, [channel_id]: updated } };
  });
}

// ─── Link Preview Fetching ───────────────────────────

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const MAX_PREVIEWS = 3;
const PREVIEW_TIMEOUT = 4000;

async function fetchLinkPreviews(text: string): Promise<LinkPreview[]> {
  const urls = text.match(URL_RE);
  if (!urls || urls.length === 0) return [];

  const { api } = useAuthStore.getState();
  const unique = [...new Set(urls)].slice(0, MAX_PREVIEWS);

  const results = await Promise.allSettled(
    unique.map((url) =>
      Promise.race([
        api.fetchLinkPreview(url),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), PREVIEW_TIMEOUT),
        ),
      ]),
    ),
  );

  const previews: LinkPreview[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value && (r.value.title || r.value.description)) {
      previews.push(r.value);
    }
  }
  return previews;
}

// ─── Thumbnail Generation ────────────────────────────

const THUMB_MAX_SIZE = 200;
const THUMB_QUALITY = 0.6;

function generateThumbnail(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const scale = Math.min(THUMB_MAX_SIZE / img.width, THUMB_MAX_SIZE / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", THUMB_QUALITY);
      URL.revokeObjectURL(objectUrl);
      resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    img.src = objectUrl;
  });
}

// ─── Auto-disconnect on logout ──────────────────────
// When user logs out (user becomes null), immediately disconnect the WS
// so the server can broadcast an offline presence update.
useAuthStore.subscribe((state) => {
  if (!state.user) {
    useChatStore.getState().disconnect();
  }
});
