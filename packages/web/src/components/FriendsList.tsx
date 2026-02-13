import { useEffect, useState } from "react";
import { useFriendsStore } from "../store/friends.js";
import { usePresenceStore } from "../store/presence.js";
import { useChatStore } from "../store/chat.js";
import ConfirmDialog from "./ConfirmDialog.js";
import type { FriendResponse } from "@haven/core";

type Tab = "online" | "all" | "pending" | "blocked";

export default function FriendsList() {
  const friends = useFriendsStore((s) => s.friends);
  const loading = useFriendsStore((s) => s.loading);
  const loadFriends = useFriendsStore((s) => s.loadFriends);
  const sendRequest = useFriendsStore((s) => s.sendRequest);
  const acceptRequest = useFriendsStore((s) => s.acceptRequest);
  const declineRequest = useFriendsStore((s) => s.declineRequest);
  const removeFriend = useFriendsStore((s) => s.removeFriend);
  const presenceStatuses = usePresenceStore((s) => s.statuses);
  const fetchPresence = usePresenceStore((s) => s.fetchPresence);
  const blockedUserIds = useChatStore((s) => s.blockedUserIds);

  const [tab, setTab] = useState<Tab>("online");
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    loadFriends();
  }, []);

  // Fetch presence for all accepted friends
  useEffect(() => {
    const accepted = friends.filter((f) => f.status === "accepted");
    if (accepted.length > 0) {
      fetchPresence(accepted.map((f) => f.user_id));
    }
  }, [friends]);

  const accepted = friends.filter((f) => f.status === "accepted");
  const pending = friends.filter((f) => f.status === "pending");
  const online = accepted.filter((f) => {
    const s = presenceStatuses[f.user_id] ?? "offline";
    return s !== "offline" && s !== "invisible";
  });

  async function handleAdd() {
    if (!addInput.trim()) return;
    setAddError("");
    setAddSuccess("");
    try {
      const result = await sendRequest(addInput.trim());
      if (result.status === "accepted") {
        setAddSuccess(`You are now friends with ${result.username}!`);
      } else {
        setAddSuccess(`Friend request sent to ${result.username}.`);
      }
      setAddInput("");
    } catch (err: any) {
      setAddError(err.message || "Failed to send request");
    }
  }

  function getFilteredFriends(): FriendResponse[] {
    switch (tab) {
      case "online":
        return online;
      case "all":
        return accepted;
      case "pending":
        return pending;
      case "blocked":
        return [];
      default:
        return [];
    }
  }

  const filtered = getFilteredFriends();
  const pendingCount = pending.filter((f) => f.is_incoming).length;

  return (
    <div className="friends-view">
      <div className="friends-header">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }} aria-hidden="true">
          <path d="M14 8.01c0 2.21-1.79 4-4 4s-4-1.79-4-4 1.79-4 4-4 4 1.79 4 4zm-4 6c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm9-3v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z" />
        </svg>
        <span className="friends-title">Friends</span>
        <div className="friends-tabs">
          <button className={`friends-tab ${tab === "online" ? "active" : ""}`} onClick={() => setTab("online")}>
            Online
          </button>
          <button className={`friends-tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
            All
          </button>
          <button className={`friends-tab ${tab === "pending" ? "active" : ""}`} onClick={() => setTab("pending")}>
            Pending{pendingCount > 0 && <span className="request-badge">{pendingCount}</span>}
          </button>
          <button className={`friends-tab ${tab === "blocked" ? "active" : ""}`} onClick={() => setTab("blocked")}>
            Blocked
          </button>
        </div>
      </div>

      <div className="friends-body">
        {/* Add Friend Input */}
        <div className="add-friend-section">
          <h3>Add Friend</h3>
          <p className="add-friend-hint">You can add friends by their username.</p>
          <div className="add-friend-row">
            <input
              type="text"
              placeholder="Enter a username"
              value={addInput}
              onChange={(e) => { setAddInput(e.target.value); setAddError(""); setAddSuccess(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              aria-label="Add friend by username"
            />
            <button className="btn-primary" onClick={handleAdd} disabled={!addInput.trim()}>
              Send Friend Request
            </button>
          </div>
          {addError && <div className="add-friend-error" aria-live="polite">{addError}</div>}
          {addSuccess && <div className="add-friend-success" aria-live="polite">{addSuccess}</div>}
        </div>

        <div className="friends-divider" />

        {/* Friend List */}
        <div className="friends-section-title">
          {tab === "online" && `ONLINE — ${filtered.length}`}
          {tab === "all" && `ALL FRIENDS — ${filtered.length}`}
          {tab === "pending" && `PENDING — ${filtered.length}`}
          {tab === "blocked" && `BLOCKED — ${blockedUserIds.length}`}
        </div>

        {loading && <div className="friends-empty">Loading...</div>}

        {!loading && filtered.length === 0 && tab !== "blocked" && (
          <div className="friends-empty">
            {tab === "online" && "No friends online right now."}
            {tab === "all" && "You haven't added any friends yet."}
            {tab === "pending" && "No pending friend requests."}
          </div>
        )}

        {tab === "blocked" && blockedUserIds.length === 0 && (
          <div className="friends-empty">No blocked users.</div>
        )}

        <div className="friend-list">
          {filtered.map((friend) => {
            const s = presenceStatuses[friend.user_id] ?? "offline";
            const friendOnline = s !== "offline" && s !== "invisible";
            return (
              <FriendRow
                key={friend.id}
                friend={friend}
                isOnline={friendOnline}
                onAccept={() => acceptRequest(friend.id)}
                onDecline={() => declineRequest(friend.id)}
                onRemove={() => setConfirmRemove({
                  id: friend.id,
                  name: friend.display_name || friend.username,
                })}
              />
            );
          })}
        </div>
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title="Remove Friend"
          message={`Are you sure you want to remove ${confirmRemove.name} as a friend?`}
          confirmLabel="Remove Friend"
          danger
          onConfirm={() => {
            removeFriend(confirmRemove.id);
            setConfirmRemove(null);
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

function FriendRow({
  friend,
  isOnline,
  onAccept,
  onDecline,
  onRemove,
}: {
  friend: FriendResponse;
  isOnline: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onRemove: () => void;
}) {
  const startDm = useChatStore((s) => s.startDm);
  const displayName = friend.display_name || friend.username;

  return (
    <div className="friend-row">
      <div className="friend-row-left">
        <div className="friend-avatar">
          {displayName.charAt(0).toUpperCase()}
          <span className={`friend-avatar-status ${isOnline ? "online" : "offline"}`} />
        </div>
        <div className="friend-info">
          <span className="friend-name">{displayName}</span>
          <span className="friend-username">
            {friend.status === "pending"
              ? friend.is_incoming
                ? "Incoming Friend Request"
                : "Outgoing Friend Request"
              : isOnline
                ? "Online"
                : "Offline"}
          </span>
        </div>
      </div>
      <div className="friend-actions">
        {friend.status === "pending" && friend.is_incoming && (
          <>
            <button className="friend-action-btn accept" onClick={onAccept} title="Accept" aria-label="Accept friend request">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
              </svg>
            </button>
            <button className="friend-action-btn decline" onClick={onDecline} title="Decline" aria-label="Decline friend request">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
              </svg>
            </button>
          </>
        )}
        {friend.status === "accepted" && (
          <>
            <button
              className="friend-action-btn message"
              onClick={() => startDm(friend.username).catch(() => {})}
              title="Message"
              aria-label="Send message"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
              </svg>
            </button>
            <button className="friend-action-btn decline" onClick={onRemove} title="Remove Friend" aria-label="Remove friend">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
              </svg>
            </button>
          </>
        )}
        {friend.status === "pending" && !friend.is_incoming && (
          <button className="friend-action-btn decline" onClick={onRemove} title="Cancel Request" aria-label="Cancel friend request">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
