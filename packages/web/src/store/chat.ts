import { create } from "zustand";
import { getServerUrl } from "../lib/serverUrl";
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
  type CustomEmojiResponse,
} from "@haven/core";
import { useAuthStore } from "./auth.js";
import { usePresenceStore } from "./presence.js";
import { useUiStore } from "./ui.js";
import { decryptIncoming, encryptOutgoing, fetchSenderKeys, invalidateSenderKey, mapChannelToPeer } from "../lib/crypto.js";
import { cacheMessage, getCachedMessage, uncacheMessage } from "../lib/message-cache.js";
import { initTabSync, isWsOwner, broadcastWsEvent, onRoleChange, onWsSend } from "../lib/tab-sync.js";
import { unicodeBtoa, unicodeAtob } from "../lib/base64.js";
import { sendNotification } from "../lib/notifications.js";

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
  spoiler?: boolean;  // true if marked as spoiler (blur until clicked)
}

export interface PendingUpload {
  file: File;
  progress: number; // 0-100
  status: "pending" | "uploading" | "done" | "error";
  spoiler?: boolean;
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
  /** Global userId -> avatar URL map, populated from server member lists */
  userAvatars: Record<string, string>;
  /** messageId -> array of { emoji, userIds } */
  reactions: Record<string, Array<{ emoji: string; userIds: string[] }>>;
  /** IDs of users blocked by the current user */
  blockedUserIds: string[];
  /** channelId -> unread message count (client-side only) */
  unreadCounts: Record<string, number>;
  /** channelId -> mention/reply count (client-side only) */
  mentionCounts: Record<string, number>;
  /** serverId -> effective permission bitfield for current user */
  myPermissions: Record<string, bigint>;
  /** serverId -> current user's role IDs in that server */
  myRoleIds: Record<string, string[]>;
  /** userId -> highest-priority role color hex string */
  userRoleColors: Record<string, string>;
  /** serverId -> custom emojis for that server */
  customEmojis: Record<string, CustomEmojiResponse[]>;
  /** "serverId:userId" -> timed_out_until timestamp (null = no timeout) */
  memberTimeouts: Record<string, string | null>;
  /** Incremented when server membership changes (join/leave/kick) — triggers member list refresh */
  memberListVersion: number;
  /** channelId -> unread count snapshot (at time of opening), used for "NEW" divider */
  newMessageDividers: Record<string, number>;
  /** Set to true after initial loadChannels() completes (used by splash screen) */
  dataLoaded: boolean;

  connect(): void;
  disconnect(): void;
  loadChannels(): Promise<void>;
  selectChannel(channelId: string): Promise<void>;
  sendMessage(text: string, attachments?: AttachmentMeta[], formatting?: { contentType: string; data: object }): Promise<void>;
  sendTyping(): void;
  startDm(targetUsername: string): Promise<ChannelResponse>;
  /** Get or create a DM channel without navigating (no currentChannelId change). */
  getOrCreateDmChannel(targetUsername: string): Promise<ChannelResponse>;
  /** Send a message to a specific channel (used for invites, etc. without navigating). */
  sendMessageToChannel(channelId: string, text: string, formatting?: { contentType: string; data: object }): Promise<void>;
  addFiles(files: File[]): void;
  removePendingUpload(index: number): void;
  togglePendingUploadSpoiler(index: number): void;
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
  refreshPermissions(serverId: string): Promise<void>;
  navigateUnread(direction: "up" | "down"): void;
}

const TYPING_EXPIRY_MS = 3000;
const TYPING_THROTTLE_MS = 500;
let lastTypingSent = 0;

// ─── DM Channel Helpers ─────────────────────────────────

/** Parse a DM channel's meta and register the channel→peer mapping for E2EE routing. */
function mapDmChannelPeer(channel: ChannelResponse, myUserId: string): void {
  if (channel.channel_type !== "dm") return;
  try {
    const meta = JSON.parse(unicodeAtob(channel.encrypted_meta));
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
// Message IDs we've edited — skip re-decryption on our own MessageEdited broadcast
const ownEditIds = new Set<string>();

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
  userAvatars: {},
  reactions: {},
  blockedUserIds: [],
  unreadCounts: {},
  mentionCounts: {},
  myPermissions: {},
  myRoleIds: {},
  userRoleColors: {},
  customEmojis: {},
  memberTimeouts: {},
  memberListVersion: 0,
  newMessageDividers: {},
  dataLoaded: false,

  connect() {
    const { api } = useAuthStore.getState();
    const token = api.currentAccessToken;
    if (!token) return;

    // Initialize multi-tab coordination
    initTabSync();

    // Handle role changes: if we become leader later, connect WS
    onRoleChange((newRole) => {
      const { ws: existingWs } = get();
      if (newRole === "leader" && !existingWs) {
        // Became leader — need to establish WS connection
        get().connect();
      }
    });

    // If this tab is a follower, don't open a WS connection
    if (!isWsOwner()) {
      set({ wsState: "connected" }); // Followers piggyback on leader's connection
      return;
    }

    const ws = new HavenWs({
      baseUrl: getServerUrl(),
      token,
    });

    // When leader receives WS sends from followers, relay them
    onWsSend((data) => {
      if (ws.isConnected) {
        ws.send(data as Parameters<typeof ws.send>[0]);
      }
    });

    // Broadcast all WS events to follower tabs
    ws.on("*" as any, (msg: any) => {
      broadcastWsEvent(msg);
    });

    let hasConnectedBefore = false;

    ws.onConnect(() => {
      const isReconnect = hasConnectedBefore;
      hasConnectedBefore = true;
      set({ wsState: "connected" });

      if (isReconnect) {
        // Re-subscribe all loaded channels on reconnect
        const { channels, currentChannelId } = get();
        const subscribedIds = new Set<string>();
        for (const ch of channels) {
          ws.subscribe(ch.id);
          subscribedIds.add(ch.id);
        }

        // Re-fetch messages for current channel to catch anything missed
        if (currentChannelId) {
          const { api } = useAuthStore.getState();
          api.getMessages(currentChannelId, { limit: 50 }).catch(() => {});
        }
      }
    });

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

    ws.on("BulkMessagesDeleted", (msg: Extract<WsServerMessage, { type: "BulkMessagesDeleted" }>) => {
      const { channel_id, message_ids } = msg.payload;
      const idsSet = new Set(message_ids);
      for (const id of message_ids) uncacheMessage(id);
      set((state) => {
        const channelMsgs = state.messages[channel_id];
        if (!channelMsgs) return state;
        return {
          messages: {
            ...state.messages,
            [channel_id]: channelMsgs.filter((m) => !idsSet.has(m.id)),
          },
        };
      });
    });

    ws.on("MemberTimedOut", (msg: Extract<WsServerMessage, { type: "MemberTimedOut" }>) => {
      const { server_id, user_id, timed_out_until } = msg.payload;
      set((state) => ({
        memberTimeouts: {
          ...state.memberTimeouts,
          [`${server_id}:${user_id}`]: timed_out_until,
        },
      }));
    });

    ws.on("ReadStateUpdated", (msg: Extract<WsServerMessage, { type: "ReadStateUpdated" }>) => {
      const { channel_id } = msg.payload;
      // Another device marked this channel as read — clear local unread
      if (channel_id !== get().currentChannelId) {
        set((state) => {
          const { [channel_id]: _, ...restUnread } = state.unreadCounts;
          const { [channel_id]: __, ...restMention } = state.mentionCounts;
          return { unreadCounts: restUnread, mentionCounts: restMention };
        });
      }
    });

    ws.on("ReactionAdded", (msg: Extract<WsServerMessage, { type: "ReactionAdded" }>) => {
      const { message_id, sender_token, emoji } = msg.payload;
      set((state) => {
        const groups = [...(state.reactions[message_id] ?? [])];
        const existing = groups.find((g) => g.emoji === emoji);
        // Use sender_token as a placeholder user ID (real user IDs loaded via REST)
        // Skip if we already optimistically added this (our own reaction)
        if (existing) {
          if (!existing.userIds.includes(sender_token)) {
            existing.userIds = [...existing.userIds, sender_token];
          }
        } else {
          groups.push({ emoji, userIds: [sender_token] });
        }
        return { reactions: { ...state.reactions, [message_id]: groups } };
      });
    });

    ws.on("ReactionRemoved", (msg: Extract<WsServerMessage, { type: "ReactionRemoved" }>) => {
      const { message_id, emoji } = msg.payload;
      set((state) => {
        const groups = (state.reactions[message_id] ?? [])
          .map((g) => {
            if (g.emoji !== emoji) return g;
            // Remove one entry (we don't know which user, so pop the last non-myId entry)
            const myId = useAuthStore.getState().user?.id;
            const idx = g.userIds.findIndex((id) => id !== myId);
            if (idx >= 0) {
              const newIds = [...g.userIds];
              newIds.splice(idx, 1);
              return { ...g, userIds: newIds };
            }
            return g;
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

    // Voice state events
    ws.on("VoiceStateUpdate", (msg: Extract<WsServerMessage, { type: "VoiceStateUpdate" }>) => {
      import("./voice.js").then(({ useVoiceStore }) => {
        const { channel_id, user_id, username, joined } = msg.payload;
        useVoiceStore.getState().handleVoiceStateUpdate(
          channel_id, user_id, username, null, null, joined,
        );
      });
    });

    ws.on("VoiceMuteUpdate", (msg: Extract<WsServerMessage, { type: "VoiceMuteUpdate" }>) => {
      import("./voice.js").then(({ useVoiceStore }) => {
        const { channel_id, user_id, server_muted, server_deafened } = msg.payload;
        useVoiceStore.getState().handleVoiceMuteUpdate(
          channel_id, user_id, server_muted, server_deafened,
        );
      });
    });

    // DM/group call events
    ws.on("CallRinging", (msg: Extract<WsServerMessage, { type: "CallRinging" }>) => {
      import("./voice.js").then(({ useVoiceStore }) => {
        const { channel_id, caller_id, caller_name } = msg.payload;
        useVoiceStore.getState().handleCallRinging(channel_id, caller_id, caller_name);
      });
    });

    ws.on("CallAccepted", (msg: Extract<WsServerMessage, { type: "CallAccepted" }>) => {
      import("./voice.js").then(({ useVoiceStore }) => {
        const { channel_id, user_id } = msg.payload;
        useVoiceStore.getState().handleCallAccepted(channel_id, user_id);
      });
    });

    ws.on("CallRejected", (msg: Extract<WsServerMessage, { type: "CallRejected" }>) => {
      import("./voice.js").then(({ useVoiceStore }) => {
        const { channel_id, user_id } = msg.payload;
        useVoiceStore.getState().handleCallRejected(channel_id, user_id);
      });
    });

    ws.on("CallEnded", (msg: Extract<WsServerMessage, { type: "CallEnded" }>) => {
      import("./voice.js").then(({ useVoiceStore }) => {
        const { channel_id, ended_by } = msg.payload;
        useVoiceStore.getState().handleCallEnded(channel_id, ended_by);
      });
    });

    // Custom emoji events
    ws.on("EmojiCreated", (msg: Extract<WsServerMessage, { type: "EmojiCreated" }>) => {
      const { server_id, emoji } = msg.payload;
      set((state) => {
        const existing = state.customEmojis[server_id] ?? [];
        // Deduplicate: broadcast_to_server sends once per channel, so skip if already added
        if (existing.some((e) => e.id === emoji.id)) return state;
        return {
          customEmojis: {
            ...state.customEmojis,
            [server_id]: [...existing, emoji],
          },
        };
      });
    });

    ws.on("EmojiDeleted", (msg: Extract<WsServerMessage, { type: "EmojiDeleted" }>) => {
      const { server_id, emoji_id } = msg.payload;
      set((state) => ({
        customEmojis: {
          ...state.customEmojis,
          [server_id]: (state.customEmojis[server_id] ?? []).filter((e) => e.id !== emoji_id),
        },
      }));
    });

    // Friend events — dynamically import friends store to avoid circular deps
    ws.on("FriendRequestReceived", () => {
      import("./friends.js").then(({ useFriendsStore }) => {
        useFriendsStore.getState().loadFriends();
      });
      sendNotification("Friend Request", "You received a new friend request");
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

    ws.on("ServerUpdated", () => {
      // Server structure changed (channels/categories) — reload
      get().loadChannels();
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
    // Prevent concurrent calls (React Strict Mode fires effects twice)
    if ((get() as any)._channelsLoading) return;
    set({ _channelsLoading: true } as any);

    const { api } = useAuthStore.getState();

    // Load servers first (everything else depends on the server list)
    const servers = await api.listServers();

    // Normalize relative icon URLs to absolute (needed for Tauri / custom server URL)
    const base = getServerUrl();
    for (const srv of servers) {
      if (srv.icon_url && srv.icon_url.startsWith("/")) {
        srv.icon_url = base + srv.icon_url;
      }
    }

    // Fire ALL independent requests in parallel — DMs, members, and blocked
    // users no longer wait for server channels/categories/roles to finish
    const [
      serverChannelArrays,
      serverCategoryArrays,
      serverRoleArrays,
      dmChannels,
      memberArrays,
      blockedUsers,
      serverEmojiArrays,
      readStates,
    ] = await Promise.all([
      Promise.all(servers.map((server) => api.listServerChannels(server.id))),
      Promise.all(servers.map((server) => api.listCategories(server.id))),
      Promise.all(servers.map((server) => api.listRoles(server.id))),
      api.listDmChannels(),
      Promise.all(servers.map((server) => api.listServerMembers(server.id))),
      api.getBlockedUsers().catch(() => [] as Array<{ user_id: string; username: string; blocked_at: string }>),
      Promise.all(servers.map((server) => api.listServerEmojis(server.id).catch((err) => {
        console.warn("Failed to fetch emojis for server", server.id, err);
        return [] as CustomEmojiResponse[];
      }))),
      api.getReadStates().catch(() => []),
    ]);

    const allChannels: ChannelResponse[] = serverChannelArrays.flat();

    // Build categories map: serverId -> CategoryResponse[]
    const categories: Record<string, CategoryResponse[]> = {};
    const roles: Record<string, RoleResponse[]> = {};
    const customEmojis: Record<string, CustomEmojiResponse[]> = {};
    servers.forEach((server, i) => {
      categories[server.id] = serverCategoryArrays[i];
      roles[server.id] = serverRoleArrays[i];
      customEmojis[server.id] = serverEmojiArrays[i];
    });

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
        const meta = JSON.parse(unicodeAtob(ch.encrypted_meta));
        if (meta.names) {
          for (const [id, name] of Object.entries(meta.names)) {
            if (!dmUserNames[id]) dmUserNames[id] = name as string;
          }
        }
      } catch { /* non-fatal */ }
    }

    // Build global userId -> displayName and avatar maps from server members
    const userNames: Record<string, string> = {};
    const userAvatars: Record<string, string> = {};
    for (const members of memberArrays) {
      for (const m of members) {
        userNames[m.user_id] = m.nickname || m.display_name || m.username;
        if (m.avatar_url) userAvatars[m.user_id] = m.avatar_url;
      }
    }

    // Build myPermissions map from server responses
    const myPermissions: Record<string, bigint> = {};
    for (const server of servers) {
      if (server.my_permissions) {
        myPermissions[server.id] = BigInt(server.my_permissions);
      }
    }

    // Build userId -> highest-priority role color map
    const userRoleColors: Record<string, string> = {};
    for (let i = 0; i < servers.length; i++) {
      const srvRoles = serverRoleArrays[i];
      const members = memberArrays[i];
      for (const m of members) {
        if (userRoleColors[m.user_id]) continue; // first server wins
        const coloredRoles = srvRoles
          .filter((r) => !r.is_default && r.color && m.role_ids.includes(r.id))
          .sort((a, b) => b.position - a.position);
        if (coloredRoles.length > 0) {
          userRoleColors[m.user_id] = coloredRoles[0].color!;
        }
      }
    }

    // Build myRoleIds map: serverId -> current user's role IDs in that server
    const myRoleIds: Record<string, string[]> = {};
    if (user) {
      for (let i = 0; i < servers.length; i++) {
        const me = memberArrays[i].find((m) => m.user_id === user.id);
        if (me) myRoleIds[servers[i].id] = me.role_ids;
      }
    }

    // Merge DM/group names (server member names take priority)
    const mergedUserNames = { ...dmUserNames, ...userNames };

    // Build server-side unread counts
    const serverUnreads: Record<string, number> = {};
    for (const rs of readStates) {
      if (rs.unread_count > 0) {
        serverUnreads[rs.channel_id] = rs.unread_count;
      }
    }

    set({
      servers,
      channels: allChannels,
      categories,
      roles,
      customEmojis,
      userNames: mergedUserNames,
      userAvatars,
      blockedUserIds: blockedUsers.map((b) => b.user_id),
      myPermissions,
      myRoleIds,
      userRoleColors,
      unreadCounts: serverUnreads,
      dataLoaded: true,
      _channelsLoading: false,
    } as any);

    // Subscribe to all channels via WebSocket
    const { ws } = get();
    if (ws && get().wsState === "connected") {
      for (const ch of allChannels) {
        ws.subscribe(ch.id);
      }
    }

    // Fetch bulk presence for all server members
    const allMemberIds = new Set<string>();
    for (const members of memberArrays) {
      for (const m of members) {
        allMemberIds.add(m.user_id);
      }
    }
    usePresenceStore.getState().fetchPresence([...allMemberIds]);

    // Ensure current user always shows their own status (avoids race with WS connect)
    const { user: currentUser } = useAuthStore.getState();
    if (currentUser) {
      const ps = usePresenceStore.getState();
      ps.setStatus(currentUser.id, ps.ownStatus);
    }
  },

  async selectChannel(channelId) {
    // Snapshot unread count before clearing, for "NEW" divider
    const unreadSnapshot = get().unreadCounts[channelId] ?? 0;

    set((state) => {
      const { [channelId]: _, ...restUnread } = state.unreadCounts;
      const { [channelId]: __, ...restMention } = state.mentionCounts;
      const newDividers = unreadSnapshot > 0
        ? { ...state.newMessageDividers, [channelId]: unreadSnapshot }
        : state.newMessageDividers;
      return { currentChannelId: channelId, unreadCounts: restUnread, mentionCounts: restMention, newMessageDividers: newDividers };
    });

    // Mark channel as read on server (fire-and-forget via WS)
    const wsConn = get().ws;
    if (wsConn) {
      try { wsConn.markRead(channelId); } catch { /* non-fatal */ }
    }

    // Clear the "NEW" divider after a delay so it's visible briefly
    if (unreadSnapshot > 0) {
      setTimeout(() => {
        set((state) => {
          const { [channelId]: _, ...rest } = state.newMessageDividers;
          return { newMessageDividers: rest };
        });
      }, 5000);
    }

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

      // Reverse to process in chronological order (oldest first).
      // DM initial (X3DH) messages must establish the session before
      // follow-up messages can decrypt, and sender key fetch is also
      // more efficient when processed chronologically.
      rawMessages.reverse();

      const decrypted: DecryptedMessage[] = [];
      for (const raw of rawMessages) {
        // System messages are unencrypted — parse directly
        if (raw.message_type === "system") {
          let sysText: string;
          try { sysText = unicodeAtob(raw.encrypted_body); } catch { sysText = raw.encrypted_body; }
          decrypted.push({
            id: raw.id,
            channelId: raw.channel_id,
            senderId: raw.sender_token,
            text: sysText,
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
        } catch (err) {
          // Can't decrypt — try local cache (survives re-login)
          console.warn("[E2EE] Decryption failed for message", raw.id, err);
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

    // Reconnect if WS dropped
    if (!ws.isConnected) {
      console.warn("[WS] Not connected, attempting reconnect...");
      ws.connect();
      // Wait briefly for connection
      await new Promise((r) => setTimeout(r, 1000));
      if (!ws.isConnected) {
        console.error("[WS] Reconnect failed — cannot send message");
        return;
      }
    }

    const { user } = useAuthStore.getState();
    if (!user) return;

    try {
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
    } catch (err) {
      console.error("[sendMessage] Failed to send:", err);
    }
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

  togglePendingUploadSpoiler(index: number) {
    set((state) => ({
      pendingUploads: state.pendingUploads.map((u, i) =>
        i === index ? { ...u, spoiler: !u.spoiler } : u
      ),
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

        // 2. Upload encrypted blob with progress tracking via XHR
        const encryptedBuf = (encrypted.buffer as ArrayBuffer).slice(
          encrypted.byteOffset,
          encrypted.byteOffset + encrypted.byteLength,
        );
        const { attachment_id } = await new Promise<{ attachment_id: string }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const token = api.currentAccessToken;
          xhr.open("POST", `${getServerUrl()}/api/v1/attachments/upload`);
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              set((state) => ({
                pendingUploads: state.pendingUploads.map((u, idx) =>
                  idx === i ? { ...u, progress: pct } : u
                ),
              }));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try { resolve(JSON.parse(xhr.responseText)); }
              catch { reject(new Error("Invalid upload response")); }
            } else {
              reject(new Error(`Upload failed: ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error("Upload network error"));
          xhr.send(encryptedBuf);
        });

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

        // Pass through spoiler flag
        if (upload.spoiler) {
          meta.spoiler = true;
        }

        // Pre-cache the original file as a blob URL so the rendered message
        // shows the full-quality image immediately (avoids re-downloading the
        // same file we just uploaded and showing a pixelated thumbnail instead).
        if (isMediaFile(upload.file.type)) {
          const { preCacheBlobUrl } = await import("../components/MessageAttachments.js");
          preCacheBlobUrl(attachment_id, URL.createObjectURL(upload.file));
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

    // Clear only successful uploads; keep failed ones visible so the user sees the error
    const failedUploads = get().pendingUploads.filter((u) => u.status === "error");
    set({ pendingUploads: failedUploads });
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

    // Optimistic update: apply the edit locally for the sender immediately
    ownEditIds.add(messageId);
    set((state) => {
      const channelMsgs = state.messages[currentChannelId];
      if (!channelMsgs) return { editingMessageId: null };
      return {
        editingMessageId: null,
        messages: {
          ...state.messages,
          [currentChannelId]: channelMsgs.map((m) =>
            m.id === messageId
              ? { ...m, text, edited: true, contentType: formatting?.contentType, formatting: formatting?.data }
              : m,
          ),
        },
      };
    });
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
    // Optimistic update with our real user_id
    const myId = useAuthStore.getState().user?.id;
    if (myId) {
      set((state) => {
        const groups = [...(state.reactions[messageId] ?? [])];
        const existing = groups.find((g) => g.emoji === emoji);
        if (existing) {
          if (!existing.userIds.includes(myId)) {
            existing.userIds = [...existing.userIds, myId];
          }
        } else {
          groups.push({ emoji, userIds: [myId] });
        }
        return { reactions: { ...state.reactions, [messageId]: groups } };
      });
    }
    ws.addReaction(messageId, emoji);
  },

  removeReaction(messageId: string, emoji: string) {
    const { ws } = get();
    if (!ws) return;
    // Optimistic update — remove our own user_id
    const myId = useAuthStore.getState().user?.id;
    if (myId) {
      set((state) => {
        const groups = (state.reactions[messageId] ?? [])
          .map((g) => {
            if (g.emoji !== emoji) return g;
            return { ...g, userIds: g.userIds.filter((id) => id !== myId) };
          })
          .filter((g) => g.userIds.length > 0);
        return { reactions: { ...state.reactions, [messageId]: groups } };
      });
    }
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
    const { user } = useAuthStore.getState();
    if (!user) throw new Error("Not authenticated");

    // Look up the target user by username
    const targetUser = await api.getUserByUsername(targetUsername);
    const targetUserId = targetUser.id;

    // Don't pre-establish E2EE session here. Sessions are created on-demand:
    //  - For sending: encryptOutgoing() fetches key bundle and calls ensureSession()
    //  - For receiving: decryptIncoming() runs X3DH respond on initial messages
    // Pre-creating a session here would conflict with incoming initial messages
    // from the peer, causing decryption failures.

    // Create the DM channel (includes usernames for display)
    const meta = JSON.stringify({
      type: "dm",
      participants: [user.id, targetUserId],
      names: { [user.id]: user.username, [targetUserId]: targetUser.username },
    });
    const metaBase64 = unicodeBtoa(meta);

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

    // Switch UI to DM view (hide friends list)
    const ui = useUiStore.getState();
    if (ui.selectedServerId !== null) ui.selectServer(null);
    ui.setShowFriends(false);

    return channel;
  },

  async getOrCreateDmChannel(targetUsername) {
    const { api } = useAuthStore.getState();
    const { user } = useAuthStore.getState();
    if (!user) throw new Error("Not authenticated");

    const targetUser = await api.getUserByUsername(targetUsername);
    const targetUserId = targetUser.id;

    const meta = JSON.stringify({
      type: "dm",
      participants: [user.id, targetUserId],
      names: { [user.id]: user.username, [targetUserId]: targetUser.username },
    });
    const metaBase64 = unicodeBtoa(meta);

    const channel = await api.createDm({
      target_user_id: targetUserId,
      encrypted_meta: metaBase64,
    });

    mapChannelToPeer(channel.id, targetUserId);

    const { ws } = get();
    if (ws) ws.subscribe(channel.id);

    // Add channel to state WITHOUT changing currentChannelId
    set((state) => {
      const exists = state.channels.some((ch) => ch.id === channel.id);
      return {
        channels: exists ? state.channels : [...state.channels, channel],
        messages: { ...state.messages, [channel.id]: state.messages[channel.id] ?? [] },
      };
    });

    return channel;
  },

  async sendMessageToChannel(channelId, text, formatting) {
    const { ws } = get();
    if (!ws) return;

    if (!ws.isConnected) {
      ws.connect();
      await new Promise((r) => setTimeout(r, 1000));
      if (!ws.isConnected) return;
    }

    const { user } = useAuthStore.getState();
    if (!user) return;

    try {
      const { senderToken, encryptedBody } = await encryptOutgoing(
        user.id,
        channelId,
        text,
        undefined,
        formatting,
      );

      const tempId = `temp-${crypto.randomUUID()}`;
      pendingAcks.push(tempId);

      const optimistic: DecryptedMessage = {
        id: tempId,
        channelId,
        senderId: user.id,
        text,
        contentType: formatting?.contentType,
        formatting: formatting?.data,
        timestamp: new Date().toISOString(),
        raw: {} as MessageResponse,
      };
      set((state) => appendMessage(state, channelId, optimistic));

      ws.sendMessage(channelId, senderToken, encryptedBody);
    } catch (err) {
      console.error("[sendMessageToChannel] Failed to send:", err);
    }
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

  navigateUnread(direction) {
    const { channels, currentChannelId, unreadCounts } = get();
    const selectedServerId = useUiStore.getState().selectedServerId;

    // Filter to text channels in the current server (or DMs if no server selected)
    const relevantChannels = channels.filter((ch) =>
      selectedServerId
        ? ch.server_id === selectedServerId && ch.channel_type !== "voice"
        : ch.server_id === null,
    );

    if (relevantChannels.length === 0) return;

    const currentIdx = relevantChannels.findIndex((ch) => ch.id === currentChannelId);

    // Find channels with unreads
    const unreadChannels = relevantChannels
      .map((ch, idx) => ({ ch, idx }))
      .filter(({ ch }) => (unreadCounts[ch.id] ?? 0) > 0);

    if (unreadChannels.length === 0) return;

    let target: typeof unreadChannels[0] | undefined;

    if (direction === "down") {
      // Find the next unread channel after current index
      target = unreadChannels.find(({ idx }) => idx > currentIdx);
      // Wrap around
      if (!target) target = unreadChannels[0];
    } else {
      // Find the previous unread channel before current index
      target = [...unreadChannels].reverse().find(({ idx }) => idx < currentIdx);
      // Wrap around
      if (!target) target = unreadChannels[unreadChannels.length - 1];
    }

    if (target) {
      get().selectChannel(target.ch.id);
    }
  },

  async refreshPermissions(serverId) {
    const { api } = useAuthStore.getState();
    try {
      const result = await api.getMyPermissions(serverId);
      set((state) => ({
        myPermissions: {
          ...state.myPermissions,
          [serverId]: BigInt(result.permissions),
        },
      }));
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

/** Check if a tiptap formatting object mentions a specific user (by ID, @everyone, or @role). */
function formattingMentionsUser(formatting: unknown, userId: string, userRoleIds?: string[]): boolean {
  if (!formatting || typeof formatting !== "object") return false;
  const node = formatting as Record<string, unknown>;
  if (node.type === "mention") {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (!attrs) return false;
    // @everyone mentions all users
    if (attrs.id === "everyone") return true;
    // @role mentions users who have that role
    if (attrs.mentionType === "role" && userRoleIds && typeof attrs.id === "string") {
      if (userRoleIds.includes(attrs.id)) return true;
    }
    // Direct @user mention
    if (attrs.id === userId) return true;
  }
  const content = node.content;
  if (Array.isArray(content)) {
    return content.some((child) => formattingMentionsUser(child, userId, userRoleIds));
  }
  return false;
}

/** Clear a specific user from the typing indicator for a channel. */
function clearTypingForUser(channelId: string, userId: string): void {
  useChatStore.setState((state) => {
    const channelTyping = state.typingUsers[channelId];
    if (!channelTyping || channelTyping.length === 0) return state;
    const filtered = channelTyping.filter((t) => t.userId !== userId);
    if (filtered.length === channelTyping.length) return state;
    return { typingUsers: { ...state.typingUsers, [channelId]: filtered } };
  });
}

// Track recently processed message IDs to deduplicate (DM messages may arrive
// via both channel broadcast and direct delivery to user connections).
const processedMsgIds = new Set<string>();

async function handleIncomingMessage(raw: MessageResponse) {
  // Skip our own messages — already displayed via optimistic insert
  if (ownMessageIds.has(raw.id)) {
    ownMessageIds.delete(raw.id);
    return;
  }

  // Deduplicate: DM messages may arrive twice (broadcast + direct delivery)
  if (processedMsgIds.has(raw.id)) return;
  processedMsgIds.add(raw.id);
  if (processedMsgIds.size > 500) {
    const toRemove = [...processedMsgIds].slice(0, 250);
    for (const id of toRemove) processedMsgIds.delete(id);
  }

  // If this message is for an unknown channel, reload channels to discover it
  const knownChannels = useChatStore.getState().channels;
  if (!knownChannels.some((ch) => ch.id === raw.channel_id)) {
    await useChatStore.getState().loadChannels();

    // Subscribe to the newly discovered channel and map DM peer
    const { ws } = useChatStore.getState();
    if (ws) ws.subscribe(raw.channel_id);
    const newChannel = useChatStore.getState().channels.find((ch) => ch.id === raw.channel_id);
    if (newChannel) {
      const myId = useAuthStore.getState().user?.id;
      if (myId) mapDmChannelPeer(newChannel, myId);
    }
  }

  // Increment unread count if this message is for a non-active channel
  if (raw.channel_id !== useChatStore.getState().currentChannelId) {
    useChatStore.setState((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [raw.channel_id]: (state.unreadCounts[raw.channel_id] ?? 0) + 1,
      },
    }));
  }

  // System messages are unencrypted (but base64-encoded as bytea)
  if (raw.message_type === "system") {
    let sysText: string;
    try { sysText = unicodeAtob(raw.encrypted_body); } catch { sysText = raw.encrypted_body; }

    // Update userNames from member_joined events so new users show their name
    // Also bump memberListVersion so MemberSidebar refreshes
    try {
      const data = JSON.parse(sysText);
      if (data.event === "member_joined" && data.user_id && data.username) {
        useChatStore.setState((state) => ({
          userNames: { ...state.userNames, [data.user_id]: data.username },
          memberListVersion: state.memberListVersion + 1,
        }));
        // Invalidate sender keys for ALL channels in this server so we
        // re-distribute to the new member on next send
        const thisChannel = useChatStore.getState().channels.find((c: { id: string }) => c.id === raw.channel_id);
        if (thisChannel?.server_id) {
          for (const ch of useChatStore.getState().channels) {
            if (ch.server_id === thisChannel.server_id) {
              invalidateSenderKey(ch.id);
            }
          }
        }
      }
      if (data.event === "member_left" || data.event === "member_kicked") {
        useChatStore.setState((state) => ({
          memberListVersion: state.memberListVersion + 1,
        }));
        // Invalidate sender keys so we stop encrypting for the departed member
        const depChannel = useChatStore.getState().channels.find((c: { id: string }) => c.id === raw.channel_id);
        if (depChannel?.server_id) {
          for (const ch of useChatStore.getState().channels) {
            if (ch.server_id === depChannel.server_id) {
              invalidateSenderKey(ch.id);
            }
          }
        }
      }
    } catch { /* not valid JSON, ignore */ }

    const msg: DecryptedMessage = {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: raw.sender_token,
      text: sysText,
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
    // Clear typing indicator for this sender — they just sent a message
    clearTypingForUser(raw.channel_id, msg.senderId);

    // Detect @mentions and replies to current user for mention badge
    if (raw.channel_id !== useChatStore.getState().currentChannelId) {
      const myId = useAuthStore.getState().user?.id;
      if (myId) {
        // Look up user's role IDs for @role mention detection
        const state = useChatStore.getState();
        const channel = state.channels.find((ch) => ch.id === raw.channel_id);
        const roleIds = channel?.server_id ? state.myRoleIds[channel.server_id] ?? [] : [];
        const isMentioned = formattingMentionsUser(msg.formatting, myId, roleIds);
        const isReplyToMe = msg.replyToId
          ? (useChatStore.getState().messages[raw.channel_id] ?? []).some(
              (m) => m.id === msg.replyToId && m.senderId === myId,
            )
          : false;
        if (isMentioned || isReplyToMe) {
          useChatStore.setState((state) => ({
            mentionCounts: {
              ...state.mentionCounts,
              [raw.channel_id]: (state.mentionCounts[raw.channel_id] ?? 0) + 1,
            },
          }));
        }

        // Notification with server/channel override cascade
        const { channelNotifications, serverNotifications } = useUiStore.getState();
        const channelSetting = channelNotifications[raw.channel_id] ?? "default";
        const serverSetting = channel?.server_id
          ? (serverNotifications[channel.server_id] ?? "default")
          : "default";

        // Cascade: channel > server > inherent default
        // Inherent default: server channels = "mentions", DMs = "all"
        let effective = channelSetting as string;
        if (effective === "default") effective = serverSetting;
        if (effective === "default") effective = channel?.server_id ? "mentions" : "all";

        const shouldNotify =
          effective === "all" ||
          (effective === "mentions" && (isMentioned || isReplyToMe));

        if (shouldNotify) {
          const senderName = useChatStore.getState().userNames[msg.senderId] ?? "Someone";
          const body = msg.text?.slice(0, 100) || "sent a message";
          sendNotification("New Message", `${senderName}: ${body}`);
        }
      }
    }

    useChatStore.setState((state) => appendMessage(state, raw.channel_id, msg));
  } catch (err) {
    console.warn("[E2EE] WS message decryption failed", raw.id, err);
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

  // Skip re-decryption for our own edits — already applied optimistically
  if (ownEditIds.has(message_id)) {
    ownEditIds.delete(message_id);
    return;
  }

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
      }).catch((err) => {
        console.warn("[E2EE] Failed to decrypt edited message", message_id, err);
      });

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

/** Match URLs pointing directly to an image file */
const IMAGE_EXT_RE = /\.(?:gif|png|jpe?g|webp|avif|apng|svg)(?:\?[^\s]*)?$/i;

/** Known GIF/image hosting services — treat their pages as direct image embeds */
const GIF_HOST_RE = /(?:tenor\.com(?:\/view)?|giphy\.com\/gifs|i\.imgur\.com)\//i;

/** Hosts that serve HTML pages (not raw images) even when the URL ends in .gif */
const GIF_PAGE_HOSTS = /^(?:tenor\.com|giphy\.com)$/i;

function isDirectImageUrl(url: string): boolean {
  try {
    const { pathname, hostname } = new URL(url);
    // Tenor/Giphy pages can end in .gif but return HTML, not image data
    if (GIF_PAGE_HOSTS.test(hostname)) return false;
    return IMAGE_EXT_RE.test(pathname);
  } catch {
    return IMAGE_EXT_RE.test(url);
  }
}

async function fetchLinkPreviews(text: string): Promise<LinkPreview[]> {
  const urls = text.match(URL_RE);
  if (!urls || urls.length === 0) return [];

  const { api } = useAuthStore.getState();
  const unique = [...new Set(urls)].slice(0, MAX_PREVIEWS);

  // Separate direct image URLs from regular URLs
  const imageUrls: string[] = [];
  const regularUrls: string[] = [];
  for (const url of unique) {
    if (isDirectImageUrl(url)) {
      imageUrls.push(url);
    } else {
      regularUrls.push(url);
    }
  }

  // Create inline image embeds (no backend fetch needed)
  const previews: LinkPreview[] = imageUrls.map((url) => ({
    url,
    image: url,
  }));

  // Fetch OG metadata for non-image URLs from backend
  if (regularUrls.length > 0) {
    const results = await Promise.allSettled(
      regularUrls.map((url) =>
        Promise.race([
          api.fetchLinkPreview(url),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), PREVIEW_TIMEOUT),
          ),
        ]),
      ),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value && (r.value.title || r.value.description || r.value.image)) {
        previews.push(r.value);
      }
    }
  }

  return previews;
}

function isMediaFile(mimeType: string): boolean {
  return mimeType.startsWith("image/") || mimeType.startsWith("video/");
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
