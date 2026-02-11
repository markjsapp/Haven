import { create } from "zustand";

interface UiState {
  selectedServerId: string | null; // null = Home/DMs view
  memberSidebarOpen: boolean;
  showFriends: boolean; // Show FriendsList in main content area

  selectServer(id: string | null): void;
  toggleMemberSidebar(): void;
  setShowFriends(show: boolean): void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedServerId: null,
  memberSidebarOpen: true,
  showFriends: false,

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
}));
