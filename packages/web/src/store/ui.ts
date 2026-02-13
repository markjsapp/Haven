import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NotificationOverride = "default" | "all" | "mentions" | "nothing";
export type AccessibilityFont = "default" | "opendyslexic" | "atkinson";

interface MuteEntry {
  /** Unix timestamp (ms) when mute expires, or null for indefinite */
  expiresAt: number | null;
}

interface MentionPopup {
  userId: string;
  position: { top: number; left: number };
}

interface UiState {
  selectedServerId: string | null; // null = Home/DMs view
  memberSidebarOpen: boolean;
  showFriends: boolean; // Show FriendsList in main content area
  showUserSettings: boolean;
  pinnedPanelOpen: boolean;
  searchPanelOpen: boolean;
  mentionPopup: MentionPopup | null;

  /** channelId -> mute entry */
  mutedChannels: Record<string, MuteEntry>;
  /** channelId -> notification override */
  channelNotifications: Record<string, NotificationOverride>;

  /** Accessibility preferences */
  a11yReducedMotion: boolean;
  a11yFont: AccessibilityFont;
  a11yHighContrast: boolean;
  a11yAlwaysShowTimestamps: boolean;

  selectServer(id: string | null): void;
  toggleMemberSidebar(): void;
  setShowFriends(show: boolean): void;
  setShowUserSettings(show: boolean): void;
  togglePinnedPanel(): void;
  toggleSearchPanel(): void;
  setMentionPopup(popup: MentionPopup | null): void;

  muteChannel(channelId: string, durationMs: number | null): void;
  unmuteChannel(channelId: string): void;
  isChannelMuted(channelId: string): boolean;
  setChannelNotification(channelId: string, setting: NotificationOverride): void;

  setA11yReducedMotion(enabled: boolean): void;
  setA11yFont(font: AccessibilityFont): void;
  setA11yHighContrast(enabled: boolean): void;
  setA11yAlwaysShowTimestamps(enabled: boolean): void;
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
      mentionPopup: null,
      mutedChannels: {},
      channelNotifications: {},

      a11yReducedMotion: false,
      a11yFont: "default",
      a11yHighContrast: false,
      a11yAlwaysShowTimestamps: false,

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

      setMentionPopup(popup) {
        set({ mentionPopup: popup });
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

      setA11yReducedMotion(enabled) { set({ a11yReducedMotion: enabled }); },
      setA11yFont(font) { set({ a11yFont: font }); },
      setA11yHighContrast(enabled) { set({ a11yHighContrast: enabled }); },
      setA11yAlwaysShowTimestamps(enabled) { set({ a11yAlwaysShowTimestamps: enabled }); },
    }),
    {
      name: "haven:ui",
      partialize: (state) => ({
        selectedServerId: state.selectedServerId,
        memberSidebarOpen: state.memberSidebarOpen,
        mutedChannels: state.mutedChannels,
        channelNotifications: state.channelNotifications,
        a11yReducedMotion: state.a11yReducedMotion,
        a11yFont: state.a11yFont,
        a11yHighContrast: state.a11yHighContrast,
        a11yAlwaysShowTimestamps: state.a11yAlwaysShowTimestamps,
      }),
    },
  ),
);
