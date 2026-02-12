import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFriendsStore } from "../friends.js";
import { useAuthStore } from "../auth.js";

// ── Mock the auth store's API ───────────────────────────

function mockApi() {
  return {
    listFriends: vi.fn(),
    listDmRequests: vi.fn(),
    sendFriendRequest: vi.fn(),
    acceptFriendRequest: vi.fn(),
    declineFriendRequest: vi.fn(),
    removeFriend: vi.fn(),
    handleDmRequest: vi.fn(),
  };
}

let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  // Reset friends store
  useFriendsStore.setState({
    friends: [],
    dmRequests: [],
    loading: false,
  });

  // Install mock API into auth store
  api = mockApi();
  useAuthStore.setState({ api: api as any });
});

// ── Tests ────────────────────────────────────────────────

describe("useFriendsStore", () => {
  describe("loadFriends", () => {
    it("fetches friends from API and stores them", async () => {
      const fakeFriends = [
        { id: "f1", user_id: "u1", username: "alice", status: "accepted", is_incoming: false },
        { id: "f2", user_id: "u2", username: "bob", status: "pending", is_incoming: true },
      ];
      api.listFriends.mockResolvedValueOnce(fakeFriends);

      await useFriendsStore.getState().loadFriends();

      expect(api.listFriends).toHaveBeenCalledOnce();
      expect(useFriendsStore.getState().friends).toEqual(fakeFriends);
    });

    it("sets loading during fetch", async () => {
      let resolvePromise: (v: any) => void;
      api.listFriends.mockReturnValueOnce(
        new Promise((resolve) => { resolvePromise = resolve; }),
      );

      const promise = useFriendsStore.getState().loadFriends();
      expect(useFriendsStore.getState().loading).toBe(true);

      resolvePromise!([]);
      await promise;
      expect(useFriendsStore.getState().loading).toBe(false);
    });

    it("clears loading even on error", async () => {
      api.listFriends.mockRejectedValueOnce(new Error("Network error"));

      await expect(useFriendsStore.getState().loadFriends()).rejects.toThrow();
      expect(useFriendsStore.getState().loading).toBe(false);
    });
  });

  describe("sendRequest", () => {
    it("calls API and appends to friends list", async () => {
      const newFriend = {
        id: "f3",
        user_id: "u3",
        username: "carol",
        status: "pending",
        is_incoming: false,
      };
      api.sendFriendRequest.mockResolvedValueOnce(newFriend);

      const result = await useFriendsStore.getState().sendRequest("carol");

      expect(api.sendFriendRequest).toHaveBeenCalledWith({ username: "carol" });
      expect(result).toEqual(newFriend);
      expect(useFriendsStore.getState().friends).toContainEqual(newFriend);
    });
  });

  describe("acceptRequest", () => {
    it("calls API and updates friend status in list", async () => {
      const pending = { id: "f1", user_id: "u1", username: "alice", status: "pending", is_incoming: true };
      const accepted = { ...pending, status: "accepted" };
      useFriendsStore.setState({ friends: [pending] as any });
      api.acceptFriendRequest.mockResolvedValueOnce(accepted);

      await useFriendsStore.getState().acceptRequest("f1");

      expect(api.acceptFriendRequest).toHaveBeenCalledWith("f1");
      const friends = useFriendsStore.getState().friends;
      expect(friends[0].status).toBe("accepted");
    });
  });

  describe("declineRequest", () => {
    it("calls API and removes from friends list", async () => {
      const pending = { id: "f1", user_id: "u1", username: "alice", status: "pending", is_incoming: true };
      useFriendsStore.setState({ friends: [pending] as any });
      api.declineFriendRequest.mockResolvedValueOnce(undefined);

      await useFriendsStore.getState().declineRequest("f1");

      expect(api.declineFriendRequest).toHaveBeenCalledWith("f1");
      expect(useFriendsStore.getState().friends).toHaveLength(0);
    });
  });

  describe("removeFriend", () => {
    it("calls API and removes from friends list", async () => {
      const friend = { id: "f1", user_id: "u1", username: "alice", status: "accepted", is_incoming: false };
      useFriendsStore.setState({ friends: [friend] as any });
      api.removeFriend.mockResolvedValueOnce(undefined);

      await useFriendsStore.getState().removeFriend("f1");

      expect(api.removeFriend).toHaveBeenCalledWith("f1");
      expect(useFriendsStore.getState().friends).toHaveLength(0);
    });
  });

  describe("loadDmRequests", () => {
    it("fetches DM requests from API", async () => {
      const requests = [{ id: "ch1", dm_status: "pending" }];
      api.listDmRequests.mockResolvedValueOnce(requests);

      await useFriendsStore.getState().loadDmRequests();

      expect(useFriendsStore.getState().dmRequests).toEqual(requests);
    });

    it("swallows errors silently", async () => {
      api.listDmRequests.mockRejectedValueOnce(new Error("fail"));

      // Should not throw
      await useFriendsStore.getState().loadDmRequests();
      expect(useFriendsStore.getState().dmRequests).toEqual([]);
    });
  });

  describe("DM request actions", () => {
    it("acceptDmRequest calls API and removes from list", async () => {
      useFriendsStore.setState({
        dmRequests: [{ id: "ch1" }, { id: "ch2" }] as any,
      });
      api.handleDmRequest.mockResolvedValueOnce(undefined);

      await useFriendsStore.getState().acceptDmRequest("ch1");

      expect(api.handleDmRequest).toHaveBeenCalledWith("ch1", { action: "accept" });
      expect(useFriendsStore.getState().dmRequests).toHaveLength(1);
      expect(useFriendsStore.getState().dmRequests[0].id).toBe("ch2");
    });

    it("declineDmRequest calls API and removes from list", async () => {
      useFriendsStore.setState({
        dmRequests: [{ id: "ch1" }] as any,
      });
      api.handleDmRequest.mockResolvedValueOnce(undefined);

      await useFriendsStore.getState().declineDmRequest("ch1");

      expect(api.handleDmRequest).toHaveBeenCalledWith("ch1", { action: "decline" });
      expect(useFriendsStore.getState().dmRequests).toHaveLength(0);
    });
  });
});
