import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFriendsStore } from "../store/friends.js";
import { usePresenceStore } from "../store/presence.js";
import { useChatStore } from "../store/chat.js";
import ConfirmDialog from "./ConfirmDialog.js";
import Avatar from "./Avatar.js";
import InviteToServerModal from "./InviteToServerModal.js";
import { useMenuKeyboard } from "../hooks/useMenuKeyboard.js";
import type { FriendResponse } from "@haven/core";

type Tab = "online" | "all" | "pending" | "blocked";

export default function FriendsList() {
  const { t } = useTranslation();
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

  const servers = useChatStore((s) => s.servers);

  const [tab, setTab] = useState<Tab>("online");
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ friend: FriendResponse; x: number; y: number } | null>(null);
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);

  useEffect(() => {
    loadFriends();
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

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
        setAddSuccess(t("friendsList.nowFriends", { username: result.username }));
      } else {
        setAddSuccess(t("friendsList.requestSent", { username: result.username }));
      }
      setAddInput("");
    } catch (err: any) {
      setAddError(err.message || t("friendsList.failedSendRequest"));
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
        <span className="friends-title">{t("friendsList.title")}</span>
        <div className="friends-tabs">
          <button className={`friends-tab ${tab === "online" ? "active" : ""}`} onClick={() => setTab("online")}>
            {t("friendsList.tab.online")}
          </button>
          <button className={`friends-tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
            {t("friendsList.tab.all")}
          </button>
          <button className={`friends-tab ${tab === "pending" ? "active" : ""}`} onClick={() => setTab("pending")}>
            {t("friendsList.tab.pending")}{pendingCount > 0 && <span className="request-badge">{pendingCount}</span>}
          </button>
          <button className={`friends-tab ${tab === "blocked" ? "active" : ""}`} onClick={() => setTab("blocked")}>
            {t("friendsList.tab.blocked")}
          </button>
        </div>
      </div>

      <div className="friends-body">
        {/* Add Friend Input */}
        <div className="add-friend-section">
          <h3>{t("friendsList.addFriend")}</h3>
          <p className="add-friend-hint">{t("friendsList.addFriendHint")}</p>
          <div className="add-friend-row">
            <input
              type="text"
              placeholder={t("friendsList.addFriendPlaceholder")}
              value={addInput}
              onChange={(e) => { setAddInput(e.target.value); setAddError(""); setAddSuccess(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              aria-label={t("friendsList.addFriendAriaLabel")}
            />
            <button className="btn-primary" onClick={handleAdd} disabled={!addInput.trim()}>
              {t("friendsList.sendFriendRequest")}
            </button>
          </div>
          {addError && <div className="add-friend-error" aria-live="polite">{addError}</div>}
          {addSuccess && <div className="add-friend-success" aria-live="polite">{addSuccess}</div>}
        </div>

        <div className="friends-divider" />

        {/* Friend List */}
        <div className="friends-section-title">
          {tab === "online" && `${t("friendsList.sectionOnline")} — ${filtered.length}`}
          {tab === "all" && `${t("friendsList.sectionAllFriends")} — ${filtered.length}`}
          {tab === "pending" && `${t("friendsList.sectionPending")} — ${filtered.length}`}
          {tab === "blocked" && `${t("friendsList.sectionBlocked")} — ${blockedUserIds.length}`}
        </div>

        {loading && <div className="friends-empty">{t("friendsList.loading")}</div>}

        {!loading && filtered.length === 0 && tab !== "blocked" && (
          <div className="friends-empty">
            {tab === "online" && t("friendsList.emptyOnline")}
            {tab === "all" && t("friendsList.emptyAll")}
            {tab === "pending" && t("friendsList.emptyPending")}
          </div>
        )}

        {tab === "blocked" && blockedUserIds.length === 0 && (
          <div className="friends-empty">{t("friendsList.emptyBlocked")}</div>
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
                hasServers={servers.length > 0}
                onAccept={() => acceptRequest(friend.id)}
                onDecline={() => declineRequest(friend.id)}
                onRemove={() => setConfirmRemove({
                  id: friend.id,
                  name: friend.display_name || friend.username,
                })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ friend, x: e.clientX, y: e.clientY });
                }}
                onInviteToServer={() => setInviteTarget(friend.username)}
              />
            );
          })}
        </div>
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title={t("friendsList.confirm.removeTitle")}
          message={t("friendsList.confirm.removeMessage", { name: confirmRemove.name })}
          confirmLabel={t("friendsList.confirm.removeLabel")}
          danger
          onConfirm={() => {
            removeFriend(confirmRemove.id);
            setConfirmRemove(null);
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      {contextMenu && (
        <FriendContextMenu
          friend={contextMenu.friend}
          x={contextMenu.x}
          y={contextMenu.y}
          hasServers={servers.length > 0}
          onMessage={() => {
            useChatStore.getState().startDm(contextMenu.friend.username).catch(() => {});
            setContextMenu(null);
          }}
          onInviteToServer={() => {
            setInviteTarget(contextMenu.friend.username);
            setContextMenu(null);
          }}
          onRemove={() => {
            setConfirmRemove({
              id: contextMenu.friend.id,
              name: contextMenu.friend.display_name || contextMenu.friend.username,
            });
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {inviteTarget && (
        <InviteToServerModal
          targetUsername={inviteTarget}
          onClose={() => setInviteTarget(null)}
        />
      )}
    </div>
  );
}

function FriendRow({
  friend,
  isOnline,
  hasServers,
  onAccept,
  onDecline,
  onRemove,
  onContextMenu,
  onInviteToServer,
}: {
  friend: FriendResponse;
  isOnline: boolean;
  hasServers: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onRemove: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onInviteToServer: () => void;
}) {
  const { t } = useTranslation();
  const startDm = useChatStore((s) => s.startDm);
  const displayName = friend.display_name || friend.username;

  return (
    <div className="friend-row" onContextMenu={onContextMenu}>
      <div className="friend-row-left">
        <div className="friend-avatar">
          <Avatar avatarUrl={friend.avatar_url} name={displayName} size={32} />
          <span className={`friend-avatar-status ${isOnline ? "online" : "offline"}`} />
        </div>
        <div className="friend-info">
          <span className="friend-name">{displayName}</span>
          <span className="friend-username">
            {friend.status === "pending"
              ? friend.is_incoming
                ? t("friendsList.incomingFriendRequest")
                : t("friendsList.outgoingFriendRequest")
              : isOnline
                ? t("friendsList.online")
                : t("friendsList.offline")}
          </span>
        </div>
      </div>
      <div className="friend-actions">
        {friend.status === "pending" && friend.is_incoming && (
          <>
            <button className="friend-action-btn accept" onClick={onAccept} title={t("friendsList.acceptTitle")} aria-label={t("friendsList.acceptAriaLabel")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
              </svg>
            </button>
            <button className="friend-action-btn decline" onClick={onDecline} title={t("friendsList.declineTitle")} aria-label={t("friendsList.declineAriaLabel")}>
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
              title={t("friendsList.messageTitle")}
              aria-label={t("friendsList.messageAriaLabel")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            <button className="friend-action-btn decline" onClick={onRemove} title={t("friendsList.removeFriendTitle")} aria-label={t("friendsList.removeFriendAriaLabel")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
              </svg>
            </button>
          </>
        )}
        {friend.status === "pending" && !friend.is_incoming && (
          <button className="friend-action-btn decline" onClick={onRemove} title={t("friendsList.cancelRequestTitle")} aria-label={t("friendsList.cancelRequestAriaLabel")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function FriendContextMenu({
  friend,
  x,
  y,
  hasServers,
  onMessage,
  onInviteToServer,
  onRemove,
  onClose,
}: {
  friend: FriendResponse;
  x: number;
  y: number;
  hasServers: boolean;
  onMessage: () => void;
  onInviteToServer: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useMenuKeyboard(menuRef);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const isAccepted = friend.status === "accepted";

  return (
    <div
      ref={menuRef}
      className="channel-context-menu"
      style={{ top: Math.min(y, window.innerHeight - 200), left: Math.min(x, window.innerWidth - 200) }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      role="menu"
      aria-label={t("friendsList.contextMenu.ariaLabel")}
      tabIndex={-1}
    >
      {isAccepted && (
        <button role="menuitem" tabIndex={-1} onClick={onMessage}>
          {t("friendsList.contextMenu.message")}
        </button>
      )}
      {isAccepted && hasServers && (
        <button role="menuitem" tabIndex={-1} onClick={onInviteToServer}>
          {t("friendsList.contextMenu.inviteToServer")}
        </button>
      )}
      {isAccepted && (
        <>
          <div className="context-divider" role="separator" />
          <button role="menuitem" tabIndex={-1} className="danger" onClick={onRemove}>
            {t("friendsList.contextMenu.removeFriend")}
          </button>
        </>
      )}
      {friend.status === "pending" && (
        <button role="menuitem" tabIndex={-1} className="danger" onClick={onRemove}>
          {friend.is_incoming ? t("friendsList.contextMenu.declineRequest") : t("friendsList.contextMenu.cancelRequest")}
        </button>
      )}
    </div>
  );
}
