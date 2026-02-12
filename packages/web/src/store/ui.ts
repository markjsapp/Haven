import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  selectedServerId: string | null; // null = Home/DMs view
  memberSidebarOpen: boolean;
  showFriends: boolean; // Show FriendsList in main content area
  showUserSettings: boolean;
  pinnedPanelOpen: boolean;
  searchPanelOpen: boolean;

  selectServer(id: string | null): void;
  toggleMemberSidebar(): void;
  setShowFriends(show: boolean): void;
  setShowUserSettings(show: boolean): void;
  togglePinnedPanel(): void;
  toggleSearchPanel(): void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      selectedServerId: null,
      memberSidebarOpen: true,
      showFriends: false,
      showUserSettings: false,
      pinnedPanelOpen: false,
      searchPanelOpen: false,

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
    }),
    {
      name: "haven:ui",
      partialize: (state) => ({
        selectedServerId: state.selectedServerId,
        memberSidebarOpen: state.memberSidebarOpen,
      }),
    },
  ),
);
