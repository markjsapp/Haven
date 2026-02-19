import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NotificationOverride = "default" | "all" | "mentions" | "nothing";
export type AccessibilityFont = "default" | "opendyslexic" | "atkinson";
export type Theme = "night" | "default" | "light" | "sage" | "cosmos" | "forest" | "bluebird";

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
  showAdminPanel: boolean;
  pinnedPanelOpen: boolean;
  searchPanelOpen: boolean;
  mentionPopup: MentionPopup | null;

  /** channelId -> mute entry */
  mutedChannels: Record<string, MuteEntry>;
  /** channelId -> notification override */
  channelNotifications: Record<string, NotificationOverride>;
  /** serverId -> notification override */
  serverNotifications: Record<string, NotificationOverride>;

  /** Appearance */
  theme: Theme;

  /** Accessibility preferences */
  a11yReducedMotion: boolean;
  a11yFont: AccessibilityFont;
  a11yHighContrast: boolean;
  a11yAlwaysShowTimestamps: boolean;

  /** Private user notes (userId -> note text, only visible to you) */
  userNotes: Record<string, string>;

  /** Show a send button in the message bar */
  showSendButton: boolean;

  /** Enable browser spellcheck in message bar */
  spellcheck: boolean;

  /** Custom CSS injected by the user */
  customCss: string;

  /** Mobile sidebar overlay state (not persisted) */
  mobileSidebarOpen: boolean;

  /** Resizable sidebar widths */
  channelSidebarWidth: number;
  memberSidebarWidth: number;
  serverBarWidth: number;

  /** Hide muted channels in channel sidebar */
  hideMutedChannels: boolean;

  selectServer(id: string | null): void;
  toggleMemberSidebar(): void;
  setShowFriends(show: boolean): void;
  setShowUserSettings(show: boolean): void;
  setShowAdminPanel(show: boolean): void;
  togglePinnedPanel(): void;
  toggleSearchPanel(): void;
  setMentionPopup(popup: MentionPopup | null): void;

  muteChannel(channelId: string, durationMs: number | null): void;
  unmuteChannel(channelId: string): void;
  isChannelMuted(channelId: string): boolean;
  setChannelNotification(channelId: string, setting: NotificationOverride): void;
  setServerNotification(serverId: string, setting: NotificationOverride): void;

  setTheme(theme: Theme): void;
  setA11yReducedMotion(enabled: boolean): void;
  setA11yFont(font: AccessibilityFont): void;
  setA11yHighContrast(enabled: boolean): void;
  setA11yAlwaysShowTimestamps(enabled: boolean): void;
  setUserNote(userId: string, note: string): void;
  setShowSendButton(show: boolean): void;
  setSpellcheck(enabled: boolean): void;
  setCustomCss(css: string): void;
  toggleMobileSidebar(): void;
  setMobileSidebarOpen(open: boolean): void;
  setChannelSidebarWidth(w: number): void;
  setMemberSidebarWidth(w: number): void;
  setServerBarWidth(w: number): void;
  setHideMutedChannels(hide: boolean): void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      selectedServerId: null,
      memberSidebarOpen: true,
      showFriends: false,
      showUserSettings: false,
      showAdminPanel: false,
      pinnedPanelOpen: false,
      searchPanelOpen: false,
      mentionPopup: null,
      mutedChannels: {},
      channelNotifications: {},
      serverNotifications: {},

      theme: "night",

      a11yReducedMotion: false,
      a11yFont: "default",
      a11yHighContrast: false,
      a11yAlwaysShowTimestamps: false,

      userNotes: {},
      showSendButton: false,
      spellcheck: true,
      customCss: "",
      mobileSidebarOpen: false,
      channelSidebarWidth: 240,
      memberSidebarWidth: 240,
      serverBarWidth: 72,
      hideMutedChannels: false,

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

      setShowAdminPanel(show) {
        set({ showAdminPanel: show });
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

      setServerNotification(serverId, setting) {
        set((s) => {
          if (setting === "default") {
            const { [serverId]: _, ...rest } = s.serverNotifications;
            return { serverNotifications: rest };
          }
          return {
            serverNotifications: { ...s.serverNotifications, [serverId]: setting },
          };
        });
      },

      setTheme(theme) { set({ theme }); },
      setA11yReducedMotion(enabled) { set({ a11yReducedMotion: enabled }); },
      setA11yFont(font) { set({ a11yFont: font }); },
      setA11yHighContrast(enabled) { set({ a11yHighContrast: enabled }); },
      setA11yAlwaysShowTimestamps(enabled) { set({ a11yAlwaysShowTimestamps: enabled }); },
      setShowSendButton(show) { set({ showSendButton: show }); },
      setSpellcheck(enabled) { set({ spellcheck: enabled }); },
      setCustomCss(css) { set({ customCss: css }); },
      toggleMobileSidebar() { set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })); },
      setMobileSidebarOpen(open) { set({ mobileSidebarOpen: open }); },
      setChannelSidebarWidth(w) { set({ channelSidebarWidth: w }); },
      setMemberSidebarWidth(w) { set({ memberSidebarWidth: w }); },
      setServerBarWidth(w) { set({ serverBarWidth: w }); },
      setHideMutedChannels(hide) { set({ hideMutedChannels: hide }); },
      setUserNote(userId, note) {
        set((s) => {
          if (!note.trim()) {
            const { [userId]: _, ...rest } = s.userNotes;
            return { userNotes: rest };
          }
          return { userNotes: { ...s.userNotes, [userId]: note } };
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
        serverNotifications: state.serverNotifications,
        theme: state.theme,
        a11yReducedMotion: state.a11yReducedMotion,
        a11yFont: state.a11yFont,
        a11yHighContrast: state.a11yHighContrast,
        a11yAlwaysShowTimestamps: state.a11yAlwaysShowTimestamps,
        userNotes: state.userNotes,
        showSendButton: state.showSendButton,
        spellcheck: state.spellcheck,
        customCss: state.customCss,
        channelSidebarWidth: state.channelSidebarWidth,
        memberSidebarWidth: state.memberSidebarWidth,
        serverBarWidth: state.serverBarWidth,
        hideMutedChannels: state.hideMutedChannels,
      }),
    },
  ),
);
