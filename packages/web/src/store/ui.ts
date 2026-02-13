import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NotificationOverride = "default" | "all" | "mentions" | "nothing";

interface MuteEntry {
  /** Unix timestamp (ms) when mute expires, or null for indefinite */
  expiresAt: number | null;
}

interface UiState {
  selectedServerId: string | null; // null = Home/DMs view
  memberSidebarOpen: boolean;
  showFriends: boolean; // Show FriendsList in main content area
  showUserSettings: boolean;
  pinnedPanelOpen: boolean;
  searchPanelOpen: boolean;

  /** channelId -> mute entry */
  mutedChannels: Record<string, MuteEntry>;
  /** channelId -> notification override */
  channelNotifications: Record<string, NotificationOverride>;

  selectServer(id: string | null): void;
  toggleMemberSidebar(): void;
  setShowFriends(show: boolean): void;
  setShowUserSettings(show: boolean): void;
  togglePinnedPanel(): void;
  toggleSearchPanel(): void;

  muteChannel(channelId: string, durationMs: number | null): void;
  unmuteChannel(channelId: string): void;
  isChannelMuted(channelId: string): boolean;
  setChannelNotification(channelId: string, setting: NotificationOverride): void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      selectedServerId: null,
      memberSidebarOpen: true,
      showFriends: false,
      showUserSettings: false,
      pinnedPanelOpen: false,
      searchPanelOpen: false,
      mutedChannels: {},
      channelNotifications: {},

      selectServer(id) {
        set({
          selectedServerId: id,
          memberSidebarOpen: id !== null,
          showFriends: id === null ? true : false,
        });
      },

      toggleMemberSidebar() {
        set((s) => ({ memberSidebarOpen: !s.memberSidebarOpen }));
      },

      setShowFriends(show) {
        set({ showFriends: show });
      },

      setShowUserSettings(show) {
        set({ showUserSettings: show });
      },

      togglePinnedPanel() {
        set((s) => ({ pinnedPanelOpen: !s.pinnedPanelOpen, searchPanelOpen: false }));
      },

      toggleSearchPanel() {
        set((s) => ({ searchPanelOpen: !s.searchPanelOpen, pinnedPanelOpen: false }));
      },

      muteChannel(channelId, durationMs) {
        set((s) => ({
          mutedChannels: {
            ...s.mutedChannels,
            [channelId]: {
              expiresAt: durationMs !== null ? Date.now() + durationMs : null,
            },
          },
        }));
      },

      unmuteChannel(channelId) {
        set((s) => {
          const { [channelId]: _, ...rest } = s.mutedChannels;
          return { mutedChannels: rest };
        });
      },

      isChannelMuted(channelId) {
        const entry = get().mutedChannels[channelId];
        if (!entry) return false;
        if (entry.expiresAt === null) return true; // indefinite
        if (Date.now() < entry.expiresAt) return true;
        // Expired — clean up lazily
        const { [channelId]: _, ...rest } = get().mutedChannels;
        set({ mutedChannels: rest });
        return false;
      },

      setChannelNotification(channelId, setting) {
        set((s) => {
          if (setting === "default") {
            const { [channelId]: _, ...rest } = s.channelNotifications;
            return { channelNotifications: rest };
          }
          return {
            channelNotifications: { ...s.channelNotifications, [channelId]: setting },
          };
        });
      },
    }),
    {
      name: "haven:ui",
      partialize: (state) => ({
        selectedServerId: state.selectedServerId,
        memberSidebarOpen: state.memberSidebarOpen,
        mutedChannels: state.mutedChannels,
        channelNotifications: state.channelNotifications,
      }),
    },
  ),
);
