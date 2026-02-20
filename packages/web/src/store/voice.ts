import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VoiceParticipant } from "@haven/core";
import { useAuthStore } from "./auth.js";
import { useChatStore } from "./chat.js";
import { useUiStore } from "./ui.js";

export type VoiceConnectionState = "disconnected" | "connecting" | "connected";
export type ScreenShareQuality = "360p" | "720p" | "720p60" | "1080p" | "1080p60" | "1440p" | "1440p60" | "4k" | "4k60";

interface VoiceSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  inputVolume: number;
  outputVolume: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
}

interface VoiceState extends VoiceSettings {
  // Connection state
  connectionState: VoiceConnectionState;
  currentChannelId: string | null;
  livekitToken: string | null;
  livekitUrl: string | null;

  // Local state
  isMuted: boolean;
  isDeafened: boolean;

  // Remote participants (by channel_id)
  participants: Record<string, VoiceParticipant[]>;

  /** Per-user volume overrides (userId -> 0–200, default 100) */
  userVolumes: Record<string, number>;

  // Screen share
  isScreenSharing: boolean;
  screenSharePreset: ScreenShareQuality;
  setScreenSharePreset(preset: ScreenShareQuality): void;
  setIsScreenSharing(sharing: boolean): void;

  // Actions
  joinVoice(channelId: string): Promise<void>;
  leaveVoice(): Promise<void>;
  toggleMute(): void;
  toggleDeafen(): void;
  setConnectionState(state: VoiceConnectionState): void;

  // Settings actions
  setInputDevice(deviceId: string): void;
  setOutputDevice(deviceId: string): void;
  setInputVolume(v: number): void;
  setOutputVolume(v: number): void;
  setEchoCancellation(v: boolean): void;
  setNoiseSuppression(v: boolean): void;
  setUserVolume(userId: string, volume: number): void;

  // WS event handler
  handleVoiceStateUpdate(
    channelId: string,
    userId: string,
    username: string,
    displayName: string | null,
    avatarUrl: string | null,
    joined: boolean,
  ): void;

  // Handle server mute/deafen update from WS
  handleVoiceMuteUpdate(
    channelId: string,
    userId: string,
    serverMuted: boolean,
    serverDeafened: boolean,
  ): void;

  // Load initial participants for a channel
  loadParticipants(channelId: string): Promise<void>;

  // DM/group call state
  incomingCall: { channelId: string; callerId: string; callerName: string } | null;
  outgoingCall: { channelId: string } | null;
  activeCallChannelId: string | null;

  // Call actions
  startCall(channelId: string): void;
  acceptCall(channelId: string): void;
  rejectCall(channelId: string): void;
  endCall(channelId: string): void;

  // Call WS event handlers
  handleCallRinging(channelId: string, callerId: string, callerName: string): void;
  handleCallAccepted(channelId: string, userId: string): void;
  handleCallRejected(channelId: string, userId: string): void;
  handleCallEnded(channelId: string, endedBy: string): void;
}

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set, get) => ({
      // Connection state
      connectionState: "disconnected",
      currentChannelId: null,
      livekitToken: null,
      livekitUrl: null,

      // Local state
      isMuted: false,
      isDeafened: false,

      // Remote participants
      participants: {},

      // Per-user volume (persisted)
      userVolumes: {},

      // Screen share
      isScreenSharing: false,
      screenSharePreset: "720p" as ScreenShareQuality,

      // Audio settings (defaults)
      inputDeviceId: "",
      outputDeviceId: "",
      inputVolume: 1.0,
      outputVolume: 1.0,
      echoCancellation: true,
      noiseSuppression: true,

      async joinVoice(channelId: string) {
        const api = useAuthStore.getState().api;
        const { currentChannelId: oldChannel, livekitToken: oldToken } = get();

        // If already in a channel, tear down the old LiveKit connection first.
        // Clearing the token unmounts <LiveKitRoom>, preventing cross-channel audio.
        if (oldChannel && oldToken) {
          set({ livekitToken: null, livekitUrl: null });
          // Yield to React so <LiveKitRoom> unmounts before we mount a new one
          await new Promise((r) => setTimeout(r, 50));
        }

        try {
          set({ connectionState: "connecting", currentChannelId: channelId });
          const res = await api.joinVoice(channelId);

          // Guard: user may have left voice while the API call was in-flight
          if (get().connectionState !== "connecting" || get().currentChannelId !== channelId) return;

          set({
            livekitToken: res.token,
            livekitUrl: res.url,
          });
        } catch (err) {
          console.error("Failed to join voice:", err);
          set({
            connectionState: "disconnected",
            currentChannelId: null,
            livekitToken: null,
            livekitUrl: null,
          });
        }
      },

      async leaveVoice() {
        const { currentChannelId } = get();
        if (currentChannelId) {
          const api = useAuthStore.getState().api;
          try {
            await api.leaveVoice(currentChannelId);
          } catch {
            // Best-effort
          }
        }
        set({
          connectionState: "disconnected",
          currentChannelId: null,
          livekitToken: null,
          livekitUrl: null,
          isMuted: false,
          isDeafened: false,
          isScreenSharing: false,
        });
      },

      toggleMute() {
        set((s) => ({ isMuted: !s.isMuted }));
      },

      toggleDeafen() {
        set((s) => ({ isDeafened: !s.isDeafened }));
      },

      setConnectionState(state: VoiceConnectionState) {
        set({ connectionState: state });
      },

      // Settings
      setInputDevice(deviceId) {
        set({ inputDeviceId: deviceId });
      },
      setOutputDevice(deviceId) {
        set({ outputDeviceId: deviceId });
      },
      setInputVolume(v) {
        set({ inputVolume: v });
      },
      setOutputVolume(v) {
        set({ outputVolume: v });
      },
      setEchoCancellation(v) {
        set({ echoCancellation: v });
      },
      setNoiseSuppression(v) {
        set({ noiseSuppression: v });
      },
      setUserVolume(userId, volume) {
        set((s) => ({
          userVolumes: { ...s.userVolumes, [userId]: volume },
        }));
      },
      setScreenSharePreset(preset) {
        set({ screenSharePreset: preset });
      },
      setIsScreenSharing(sharing) {
        set({ isScreenSharing: sharing });
      },

      handleVoiceStateUpdate(channelId, userId, username, displayName, avatarUrl, joined) {
        set((state) => {
          const current = state.participants[channelId] ?? [];
          let updated: VoiceParticipant[];
          if (joined) {
            // Add if not already present
            if (current.some((p) => p.user_id === userId)) {
              updated = current;
            } else {
              updated = [
                ...current,
                {
                  user_id: userId,
                  username,
                  display_name: displayName,
                  avatar_url: avatarUrl,
                  server_muted: false,
                  server_deafened: false,
                },
              ];
            }
          } else {
            // Remove
            updated = current.filter((p) => p.user_id !== userId);
          }
          return {
            participants: { ...state.participants, [channelId]: updated },
          };
        });
      },

      handleVoiceMuteUpdate(channelId, userId, serverMuted, serverDeafened) {
        set((state) => {
          const current = state.participants[channelId];
          if (!current) return state;
          return {
            participants: {
              ...state.participants,
              [channelId]: current.map((p) =>
                p.user_id === userId
                  ? { ...p, server_muted: serverMuted, server_deafened: serverDeafened }
                  : p,
              ),
            },
          };
        });
      },

      async loadParticipants(channelId: string) {
        const api = useAuthStore.getState().api;
        try {
          const participants = await api.getVoiceParticipants(channelId);
          set((state) => ({
            participants: { ...state.participants, [channelId]: participants },
          }));
        } catch {
          // Non-fatal
        }
      },

      // ─── DM/Group Call State ────────────────────────
      incomingCall: null,
      outgoingCall: null,
      activeCallChannelId: null,

      startCall(channelId: string) {
        const ws = useChatStore.getState().ws;
        if (!ws) return;
        set({ outgoingCall: { channelId } });
        ws.send({ type: "CallInvite", payload: { channel_id: channelId } });
      },

      acceptCall(channelId: string) {
        const ws = useChatStore.getState().ws;
        if (!ws) return;
        ws.send({ type: "CallAccept", payload: { channel_id: channelId } });
        set({ incomingCall: null, activeCallChannelId: channelId });
        // Navigate to the DM channel
        useUiStore.getState().selectServer(null);
        useChatStore.getState().selectChannel(channelId);
        // Join the LiveKit room
        get().joinVoice(channelId);
      },

      rejectCall(channelId: string) {
        const ws = useChatStore.getState().ws;
        if (!ws) return;
        ws.send({ type: "CallReject", payload: { channel_id: channelId } });
        set({ incomingCall: null });
      },

      endCall(channelId: string) {
        const ws = useChatStore.getState().ws;
        if (!ws) return;
        ws.send({ type: "CallEnd", payload: { channel_id: channelId } });
        get().leaveVoice();
        set({ activeCallChannelId: null, outgoingCall: null });
      },

      handleCallRinging(channelId, callerId, callerName) {
        set({ incomingCall: { channelId, callerId, callerName } });
      },

      handleCallAccepted(channelId, _userId) {
        const { outgoingCall } = get();
        if (outgoingCall?.channelId === channelId) {
          // Caller side: the callee accepted — join the LiveKit room
          set({ outgoingCall: null, activeCallChannelId: channelId });
          // Navigate to the DM channel
          useUiStore.getState().selectServer(null);
          useChatStore.getState().selectChannel(channelId);
          get().joinVoice(channelId);
        }
      },

      handleCallRejected(channelId, _userId) {
        const { outgoingCall } = get();
        if (outgoingCall?.channelId === channelId) {
          set({ outgoingCall: null });
        }
      },

      handleCallEnded(channelId, _endedBy) {
        const { activeCallChannelId, currentChannelId, incomingCall, outgoingCall } = get();
        // Clear incoming/outgoing if it matches
        if (incomingCall?.channelId === channelId) {
          set({ incomingCall: null });
        }
        if (outgoingCall?.channelId === channelId) {
          set({ outgoingCall: null });
        }
        // Disconnect from LiveKit if we're in this call
        if (activeCallChannelId === channelId && currentChannelId === channelId) {
          get().leaveVoice();
        }
        set({ activeCallChannelId: null });
      },
    }),
    {
      name: "haven-voice-settings",
      // Only persist audio settings, not connection state
      partialize: (state) => ({
        inputDeviceId: state.inputDeviceId,
        outputDeviceId: state.outputDeviceId,
        inputVolume: state.inputVolume,
        outputVolume: state.outputVolume,
        echoCancellation: state.echoCancellation,
        noiseSuppression: state.noiseSuppression,
        userVolumes: state.userVolumes,
        screenSharePreset: state.screenSharePreset,
      }),
    },
  ),
);
