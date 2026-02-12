import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VoiceParticipant } from "@haven/core";
import { useAuthStore } from "./auth.js";

export type VoiceConnectionState = "disconnected" | "connecting" | "connected";

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

  // WS event handler
  handleVoiceStateUpdate(
    channelId: string,
    userId: string,
    username: string,
    displayName: string | null,
    avatarUrl: string | null,
    joined: boolean,
  ): void;

  // Load initial participants for a channel
  loadParticipants(channelId: string): Promise<void>;
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

      // Audio settings (defaults)
      inputDeviceId: "",
      outputDeviceId: "",
      inputVolume: 1.0,
      outputVolume: 1.0,
      echoCancellation: true,
      noiseSuppression: true,

      async joinVoice(channelId: string) {
        const api = useAuthStore.getState().api;
        try {
          set({ connectionState: "connecting", currentChannelId: channelId });
          const res = await api.joinVoice(channelId);
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
                { user_id: userId, username, display_name: displayName, avatar_url: avatarUrl },
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
      }),
    },
  ),
);
