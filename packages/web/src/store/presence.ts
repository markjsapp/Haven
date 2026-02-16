import { create } from "zustand";
import { useAuthStore } from "./auth.js";

export type PresenceStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  online: { label: "Online", color: "var(--status-online, #23a55a)" },
  idle: { label: "Idle", color: "var(--status-idle, #f0b232)" },
  dnd: { label: "Do Not Disturb", color: "var(--status-dnd, #f23f43)" },
  invisible: { label: "Invisible", color: "var(--status-offline, #80848e)" },
  offline: { label: "Offline", color: "var(--status-offline, #80848e)" },
};

interface PresenceState {
  /** user_id -> status string */
  statuses: Record<string, string>;

  /** Current user's own status choice. */
  ownStatus: PresenceStatus;

  /** Reference to WS setStatus function, set by chat store after connect. */
  _wsSendStatus: ((status: string) => void) | null;

  /** Update a single user's status (called from WS handler). */
  setStatus(userId: string, status: string): void;

  /** Set and broadcast own status via WebSocket. */
  setOwnStatus(status: PresenceStatus): void;

  /** Fetch bulk presence for a list of user IDs. */
  fetchPresence(userIds: string[]): Promise<void>;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  statuses: {},
  ownStatus: "online",
  _wsSendStatus: null,

  setStatus(userId, status) {
    set((s) => ({
      statuses: { ...s.statuses, [userId]: status },
    }));
  },

  setOwnStatus(status) {
    // Update both local preference AND the statuses map so member sidebar stays in sync
    const userId = useAuthStore.getState().user?.id;
    set((s) => ({
      ownStatus: status,
      statuses: userId
        ? { ...s.statuses, [userId]: status === "invisible" ? "offline" : status }
        : s.statuses,
    }));
    const fn = get()._wsSendStatus;
    if (fn) fn(status);
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
