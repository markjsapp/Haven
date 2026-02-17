import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { useFriendsStore } from "../store/friends.js";
import { unicodeBtoa } from "../lib/base64.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import Avatar from "./Avatar.js";

interface CreateGroupDmProps {
  onClose: () => void;
}

const MAX_MEMBERS = 10; // including self

export default function CreateGroupDm({ onClose }: CreateGroupDmProps) {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const user = useAuthStore((s) => s.user);
  const friends = useFriendsStore((s) => s.friends);
  const loadFriends = useFriendsStore((s) => s.loadFriends);
  const startDm = useChatStore((s) => s.startDm);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const acceptedFriends = friends.filter((f) => f.status === "accepted");
  const remaining = MAX_MEMBERS - 1 - selected.size; // subtract self

  const filteredFriends = search.trim()
    ? acceptedFriends.filter((f) => {
        const q = search.toLowerCase();
        return (
          f.username.toLowerCase().includes(q) ||
          (f.display_name?.toLowerCase().includes(q) ?? false)
        );
      })
    : acceptedFriends;

  function toggleFriend(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        if (remaining <= 0) return prev;
        next.add(userId);
      }
      return next;
    });
    setSearch("");
    searchRef.current?.focus();
  }

  function removeFriend(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
    searchRef.current?.focus();
  }

  function getDisplayName(userId: string): string {
    const f = acceptedFriends.find((fr) => fr.user_id === userId);
    return f?.display_name || f?.username || userId.slice(0, 8);
  }

  async function handleCreate() {
    if (selected.size === 0 || !user) return;

    setError("");
    setCreating(true);

    try {
      if (selected.size === 1) {
        // 1:1 DM — use existing startDm which handles E2EE session setup
        const friendId = Array.from(selected)[0];
        const friend = acceptedFriends.find((f) => f.user_id === friendId);
        if (!friend) throw new Error("Friend not found");
        await startDm(friend.username);
        onClose();
      } else {
        // Group DM
        const memberIds = Array.from(selected);
        const names: Record<string, string> = {
          [user.id]: user.display_name || user.username,
        };
        for (const f of acceptedFriends) {
          if (selected.has(f.user_id)) {
            names[f.user_id] = f.display_name || f.username;
          }
        }

        const meta = JSON.stringify({
          type: "group",
          name: groupName.trim() || undefined,
          participants: [user.id, ...memberIds],
          names,
        });

        const channel = await api.createGroupDm({
          member_ids: memberIds,
          encrypted_meta: unicodeBtoa(meta),
        });

        const { ws } = useChatStore.getState();
        if (ws) ws.subscribe(channel.id);

        useChatStore.setState((state) => {
          const exists = state.channels.some((ch) => ch.id === channel.id);
          return {
            channels: exists ? state.channels : [...state.channels, channel],
            currentChannelId: channel.id,
            messages: { ...state.messages, [channel.id]: state.messages[channel.id] ?? [] },
          };
        });

        onClose();
      }
    } catch (err: any) {
      setError(err.message || t("createGroupDm.failed"));
    } finally {
      setCreating(false);
    }
  }

  const isGroup = selected.size >= 2;
  const buttonLabel = creating
    ? t("createGroupDm.submitLoading")
    : isGroup
      ? t("createGroupDm.submitGroup")
      : t("createGroupDm.submitDm");

  return (
    <div className="create-dm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="create-dm-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("createGroupDm.title")}>
        <div className="create-dm-header">
          <div>
            <h3>{t("createGroupDm.title")}</h3>
            <p className="create-dm-subtitle">
              {remaining <= 0
                ? t("createGroupDm.groupFull")
                : remaining === 1
                  ? t("createGroupDm.remainingSingular")
                  : t("createGroupDm.remainingPlural", { count: remaining })}
            </p>
          </div>
          <button className="create-dm-close" onClick={onClose} aria-label={t("createGroupDm.close")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="create-dm-body">
          {/* Search input with selected friend chips */}
          <div className="create-dm-search-wrap">
            {Array.from(selected).map((uid) => (
              <span key={uid} className="create-dm-chip">
                {getDisplayName(uid)}
                <button className="create-dm-chip-remove" onClick={() => removeFriend(uid)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </span>
            ))}
            <input
              ref={searchRef}
              className="create-dm-search-input"
              type="text"
              placeholder={selected.size === 0 ? t("createGroupDm.searchPlaceholder") : ""}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !search && selected.size > 0) {
                  // Remove last selected friend on backspace in empty search
                  const last = Array.from(selected).pop();
                  if (last) removeFriend(last);
                }
              }}
              autoFocus
            />
          </div>

          {/* Friend list */}
          <div className="create-dm-friend-list">
            {filteredFriends.length === 0 ? (
              <div className="create-dm-empty">
                {search ? t("createGroupDm.noMatchingFriends") : t("createGroupDm.noFriendsToAdd")}
              </div>
            ) : (
              filteredFriends.map((f) => {
                const isSelected = selected.has(f.user_id);
                const isDisabled = !isSelected && remaining <= 0;
                return (
                  <label
                    key={f.user_id}
                    className={`create-dm-friend-item ${isDisabled ? "disabled" : ""}`}
                  >
                    <Avatar
                      avatarUrl={f.avatar_url}
                      name={f.display_name || f.username}
                      size={36}
                    />
                    <div className="create-dm-friend-info">
                      <span className="create-dm-friend-name">
                        {f.display_name || f.username}
                      </span>
                      <span className="create-dm-friend-username">{f.username}</span>
                    </div>
                    <input
                      type="checkbox"
                      className="create-dm-checkbox"
                      checked={isSelected}
                      onChange={() => toggleFriend(f.user_id)}
                      disabled={isDisabled}
                    />
                  </label>
                );
              })
            )}
          </div>

          {/* Group name — only when 2+ selected */}
          {isGroup && (
            <div className="create-dm-group-name">
              <svg className="create-dm-group-name-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" />
              </svg>
              <input
                className="create-dm-group-name-input"
                type="text"
                placeholder={Array.from(selected).map(getDisplayName).join(", ")}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                maxLength={64}
              />
              <span className="create-dm-group-name-label">{t("createGroupDm.groupNameLabel")}</span>
            </div>
          )}

          {error && <div className="create-dm-error">{error}</div>}
        </div>

        <div className="create-dm-footer">
          <button className="btn-secondary" onClick={onClose}>{t("createGroupDm.cancel")}</button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={creating || selected.size === 0}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
