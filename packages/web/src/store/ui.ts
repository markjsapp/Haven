import { create } from "zustand";

interface UiState {
  selectedServerId: string | null; // null = Home/DMs view
  memberSidebarOpen: boolean;

  selectServer(id: string | null): void;
  toggleMemberSidebar(): void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedServerId: null,
  memberSidebarOpen: false,

  selectServer(id) {
    set({
      selectedServerId: id,
      // Auto-close member sidebar when switching to Home
      memberSidebarOpen: id === null ? false : undefined,
    });
  },

  toggleMemberSidebar() {
    set((s) => ({ memberSidebarOpen: !s.memberSidebarOpen }));
  },
}));
