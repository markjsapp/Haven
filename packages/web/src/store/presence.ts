import { create } from "zustand";
import { useAuthStore } from "./auth.js";

interface PresenceState {
  /** user_id -> "online" | "offline" */
  statuses: Record<string, string>;

  /** Update a single user's status (called from WS handler). */
  setStatus(userId: string, status: string): void;

  /** Fetch bulk presence for a list of user IDs. */
  fetchPresence(userIds: string[]): Promise<void>;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  statuses: {},

  setStatus(userId, status) {
    set((s) => ({
      statuses: { ...s.statuses, [userId]: status },
    }));
  },

  async fetchPresence(userIds) {
    if (userIds.length === 0) return;
    const { api } = useAuthStore.getState();
    try {
      const entries = await api.getPresence(userIds);
      const update: Record<string, string> = {};
      for (const e of entries) {
        update[e.user_id] = e.status;
      }
      set((s) => ({ statuses: { ...s.statuses, ...update } }));
    } catch {
      // Non-fatal
    }
  },
}));
