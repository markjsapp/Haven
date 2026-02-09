import { create } from "zustand";
import {
  HavenWs,
  type ChannelResponse,
  type MessageResponse,
  type WsServerMessage,
} from "@haven/core";
import { useAuthStore } from "./auth.js";
import { decryptIncoming, encryptOutgoing, ensureSession } from "../lib/crypto.js";

export interface DecryptedMessage {
  id: string;
  channelId: string;
  senderId: string;
  text: string;
  timestamp: string;
  raw: MessageResponse;
}

interface ChatState {
  channels: ChannelResponse[];
  currentChannelId: string | null;
  messages: Record<string, DecryptedMessage[]>;
  ws: HavenWs | null;
  wsState: "disconnected" | "connecting" | "connected";

  connect(): void;
  disconnect(): void;
  loadChannels(): Promise<void>;
  selectChannel(channelId: string): Promise<void>;
  sendMessage(text: string): Promise<void>;
  startDm(targetUsername: string): Promise<ChannelResponse>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  channels: [],
  currentChannelId: null,
  messages: {},
  ws: null,
  wsState: "disconnected",

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

    ws.connect();
    set({ ws, wsState: "connecting" });
  },

  disconnect() {
    get().ws?.disconnect();
    set({ ws: null, wsState: "disconnected" });
  },

  async loadChannels() {
    const { api } = useAuthStore.getState();

    // Load servers, then channels for each server (in parallel)
    const servers = await api.listServers();
    const serverChannelArrays = await Promise.all(
      servers.map((server) => api.listServerChannels(server.id))
    );
    const allChannels: ChannelResponse[] = serverChannelArrays.flat();

    // Also load DM channels
    const dmChannels = await api.listDmChannels();
    allChannels.push(...dmChannels);

    set({ channels: allChannels });

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

    // Load message history if we haven't already
    if (!get().messages[channelId]) {
      const { api } = useAuthStore.getState();
      const rawMessages = await api.getMessages(channelId, { limit: 50 });

      const decrypted: DecryptedMessage[] = [];
      for (const raw of rawMessages) {
        try {
          const msg = await decryptIncoming(raw);
          decrypted.push(msg);
        } catch {
          // Can't decrypt — may not have session yet. Show as encrypted.
          decrypted.push({
            id: raw.id,
            channelId: raw.channel_id,
            senderId: "unknown",
            text: "[encrypted message]",
            timestamp: raw.timestamp,
            raw,
          });
        }
      }

      // Messages come newest-first from API, reverse for display
      decrypted.reverse();

      set((state) => ({
        messages: { ...state.messages, [channelId]: decrypted },
      }));
    }

    // Subscribe to this channel
    const { ws } = get();
    if (ws) ws.subscribe(channelId);
  },

  async sendMessage(text) {
    const { currentChannelId, ws } = get();
    if (!currentChannelId || !ws) return;

    const { user } = useAuthStore.getState();
    if (!user) return;

    const { senderToken, encryptedBody } = await encryptOutgoing(
      user.id,
      currentChannelId,
      text,
    );

    ws.sendMessage(currentChannelId, senderToken, encryptedBody);
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
  // If this message is for an unknown channel, reload channels to discover it
  const knownChannels = useChatStore.getState().channels;
  if (!knownChannels.some((ch) => ch.id === raw.channel_id)) {
    await useChatStore.getState().loadChannels();
  }

  try {
    const msg = await decryptIncoming(raw);
    useChatStore.setState((state) => appendMessage(state, raw.channel_id, msg));
  } catch {
    const fallback: DecryptedMessage = {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: "unknown",
      text: "[encrypted message]",
      timestamp: raw.timestamp,
      raw,
    };
    useChatStore.setState((state) => appendMessage(state, raw.channel_id, fallback));
  }
}
