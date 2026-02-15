import { create } from "zustand";
import type { FriendResponse, ChannelResponse } from "@haven/core";
import { useAuthStore } from "./auth.js";

interface FriendsState {
  friends: FriendResponse[];
  dmRequests: ChannelResponse[];
  loading: boolean;

  loadFriends(): Promise<void>;
  loadDmRequests(): Promise<void>;
  sendRequest(username: string): Promise<FriendResponse>;
  acceptRequest(friendshipId: string): Promise<void>;
  declineRequest(friendshipId: string): Promise<void>;
  removeFriend(friendshipId: string): Promise<void>;
  acceptDmRequest(channelId: string): Promise<void>;
  declineDmRequest(channelId: string): Promise<void>;
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  dmRequests: [],
  loading: false,

  async loadFriends() {
    if (get().loading) return; // Prevent duplicate in-flight requests (StrictMode)
    const { api } = useAuthStore.getState();
    set({ loading: true });
    try {
      const friends = await api.listFriends();
      set({ friends });
    } finally {
      set({ loading: false });
    }
  },

  async loadDmRequests() {
    const { api } = useAuthStore.getState();
    try {
      const dmRequests = await api.listDmRequests();
      set({ dmRequests });
    } catch {
      // non-fatal
    }
  },

  async sendRequest(username: string) {
    const { api } = useAuthStore.getState();
    const friend = await api.sendFriendRequest({ username });
    set((s) => ({ friends: [...s.friends, friend] }));
    return friend;
  },

  async acceptRequest(friendshipId: string) {
    const { api } = useAuthStore.getState();
    const updated = await api.acceptFriendRequest(friendshipId);
    set((s) => ({
      friends: s.friends.map((f) => (f.id === friendshipId ? updated : f)),
    }));
  },

  async declineRequest(friendshipId: string) {
    const { api } = useAuthStore.getState();
    await api.declineFriendRequest(friendshipId);
    set((s) => ({
      friends: s.friends.filter((f) => f.id !== friendshipId),
    }));
  },

  async removeFriend(friendshipId: string) {
    const { api } = useAuthStore.getState();
    await api.removeFriend(friendshipId);
    set((s) => ({
      friends: s.friends.filter((f) => f.id !== friendshipId),
    }));
  },

  async acceptDmRequest(channelId: string) {
    const { api } = useAuthStore.getState();
    await api.handleDmRequest(channelId, { action: "accept" });
    set((s) => ({
      dmRequests: s.dmRequests.filter((r) => r.id !== channelId),
    }));
  },

  async declineDmRequest(channelId: string) {
    const { api } = useAuthStore.getState();
    await api.handleDmRequest(channelId, { action: "decline" });
    set((s) => ({
      dmRequests: s.dmRequests.filter((r) => r.id !== channelId),
    }));
  },
}));
