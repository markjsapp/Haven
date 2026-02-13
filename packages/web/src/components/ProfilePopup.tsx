import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { useFriendsStore } from "../store/friends.js";
import { usePresenceStore, STATUS_CONFIG } from "../store/presence.js";
import Avatar from "./Avatar.js";
import EmojiPicker from "./EmojiPicker.js";
import ConfirmDialog from "./ConfirmDialog.js";
import type { UserProfileResponse } from "@haven/core";

interface ProfilePopupProps {
  userId: string;
  serverId?: string;
  position: { top: number; left: number };
  onClose: () => void;
}

export default function ProfilePopup({ userId, serverId, position, onClose }: ProfilePopupProps) {
  const api = useAuthStore((s) => s.api);
  const currentUser = useAuthStore((s) => s.user);
  const presenceStatus = usePresenceStore((s) => s.statuses[userId] ?? "offline");
  const startDm = useChatStore((s) => s.startDm);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [dmText, setDmText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmUnfriend, setConfirmUnfriend] = useState(false);

  // Edit mode (own profile)
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    display_name: "",
    about_me: "",
    custom_status: "",
  });

  const popupRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const dmInputRef = useRef<HTMLInputElement>(null);

  const isOwnProfile = currentUser?.id === userId;
  const statusConfig = STATUS_CONFIG[presenceStatus] ?? STATUS_CONFIG.offline;

  // Fetch profile
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getUserProfile(userId, serverId).then((p) => {
      if (cancelled) return;
      setProfile(p);
      setEditForm({
        display_name: p.display_name ?? "",
        about_me: p.about_me ?? "",
        custom_status: p.custom_status ?? "",
      });
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId, serverId, api]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (showEmoji) { setShowEmoji(false); return; }
        if (showMoreMenu) { setShowMoreMenu(false); return; }
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose, showEmoji, showMoreMenu]);

  // Close more menu on outside click
  useEffect(() => {
    if (!showMoreMenu) return;
    function handleClick(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMoreMenu]);

  // Clamp position to viewport
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(position.top, window.innerHeight - 600),
    left: Math.min(position.left + 8, window.innerWidth - 350),
    zIndex: 1000,
  };

  // --- Actions ---

  const handleBlock = async () => {
    if (!profile) return;
    setActionLoading(true);
    try {
      if (profile.is_blocked) {
        await api.unblockUser(userId);
        setProfile({ ...profile, is_blocked: false });
      } else {
        await api.blockUser(userId);
        setProfile({ ...profile, is_blocked: true });
      }
      useChatStore.getState().loadBlockedUsers();
    } finally {
      setActionLoading(false);
      setShowMoreMenu(false);
    }
  };

  const handleFriendAction = async () => {
    if (!profile) return;
    setActionLoading(true);
    try {
      if (profile.friend_request_status === "pending_incoming" && profile.friendship_id) {
        await useFriendsStore.getState().acceptRequest(profile.friendship_id);
        setProfile({ ...profile, is_friend: true, friend_request_status: null });
      } else if (!profile.is_friend && !profile.friend_request_status) {
        await useFriendsStore.getState().sendRequest(profile.username);
        setProfile({ ...profile, friend_request_status: "pending_outgoing" });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeclineFriend = async () => {
    if (!profile?.friendship_id) return;
    setActionLoading(true);
    try {
      await useFriendsStore.getState().declineRequest(profile.friendship_id);
      setProfile({ ...profile, friend_request_status: null, friendship_id: null });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (!profile?.friendship_id) return;
    setActionLoading(true);
    try {
      await useFriendsStore.getState().removeFriend(profile.friendship_id);
      setProfile({ ...profile, is_friend: false, friendship_id: null, friend_request_status: null });
    } finally {
      setActionLoading(false);
      setShowMoreMenu(false);
    }
  };

  const handleSendDm = async () => {
    if (!profile || !dmText.trim()) return;
    try {
      // startDm creates the channel and sets it as current
      await startDm(profile.username);
      // sendMessage uses the now-current channel with proper encryption
      await sendMessage(dmText.trim());
      setDmText("");
      onClose();
    } catch {
      // DM creation may fail silently
    }
  };

  const handleSaveProfile = async () => {
    const updated = await api.updateProfile({
      display_name: editForm.display_name || null,
      about_me: editForm.about_me || null,
      custom_status: editForm.custom_status || null,
    });
    setProfile((prev) => prev ? {
      ...prev,
      display_name: updated.display_name,
      about_me: updated.about_me,
      custom_status: updated.custom_status,
    } : prev);
    setEditing(false);

    const authState = useAuthStore.getState();
    if (authState.user) {
      useAuthStore.setState({
        user: { ...authState.user, ...updated },
      });
    }
  };

  // --- Render ---

  if (loading) {
    return (
      <div className="profile-popup" ref={popupRef} style={style}>
        <div className="profile-popup-loading">Loading...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="profile-popup" ref={popupRef} style={style}>
        <div className="profile-popup-loading">User not found</div>
      </div>
    );
  }

  const displayName = profile.display_name || profile.username;

  // Friend button state
  let friendBtnTitle = "Send Friend Request";
  let friendBtnDisabled = false;
  if (profile.is_friend) {
    friendBtnTitle = "Already friends";
    friendBtnDisabled = true;
  } else if (profile.friend_request_status === "pending_outgoing") {
    friendBtnTitle = "Friend Request Sent";
    friendBtnDisabled = true;
  } else if (profile.friend_request_status === "pending_incoming") {
    friendBtnTitle = "Accept Friend Request";
  }

  return (
    <div className="profile-popup" ref={popupRef} style={style} role="dialog" aria-label={`Profile: ${displayName}`}>
      {/* Banner with action buttons */}
      <div
        className={`profile-popup-banner${profile.banner_url ? " has-image" : ""}`}
        style={profile.banner_url ? { backgroundImage: `url(${profile.banner_url})` } : undefined}
      >
        {!isOwnProfile && (
          <div className="profile-popup-header-actions">
            <button
              className={`profile-header-btn ${profile.is_friend ? "profile-header-btn-active" : ""}`}
              onClick={handleFriendAction}
              disabled={friendBtnDisabled || actionLoading}
              title={friendBtnTitle}
              aria-label={friendBtnTitle}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </button>
            <div className="profile-more-wrap" ref={moreMenuRef}>
              <button
                className="profile-header-btn"
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                title="More"
                aria-label="More options"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
              {showMoreMenu && (
                <div className="profile-more-menu" role="menu" aria-label="More options">
                  {profile.is_friend && profile.friendship_id && (
                    <button className="profile-more-item profile-more-danger" onClick={() => { setConfirmUnfriend(true); setShowMoreMenu(false); }} disabled={actionLoading}>
                      Remove Friend
                    </button>
                  )}
                  <button className="profile-more-item profile-more-danger" onClick={handleBlock} disabled={actionLoading}>
                    {profile.is_blocked ? "Unblock" : "Block"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Avatar with presence */}
      <div className="profile-popup-avatar-row">
        <div className="profile-popup-avatar-wrap">
          <Avatar
            avatarUrl={profile.avatar_url}
            name={displayName}
            size={72}
            className="profile-popup-avatar"
          />
          <span
            className="profile-popup-presence-dot"
            style={{ backgroundColor: statusConfig.color }}
            aria-label={statusConfig.label}
          />
        </div>
      </div>

      <div className="profile-popup-body">
        {editing ? (
          <div className="profile-popup-edit">
            <label className="profile-edit-label">
              Display Name
              <input
                className="profile-edit-input"
                value={editForm.display_name}
                onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                maxLength={32}
                placeholder={profile.username}
              />
            </label>
            <label className="profile-edit-label">
              About Me
              <textarea
                className="profile-edit-textarea"
                value={editForm.about_me}
                onChange={(e) => setEditForm({ ...editForm, about_me: e.target.value })}
                maxLength={190}
                rows={3}
                placeholder="Tell us about yourself"
              />
            </label>
            <label className="profile-edit-label">
              Status
              <input
                className="profile-edit-input"
                value={editForm.custom_status}
                onChange={(e) => setEditForm({ ...editForm, custom_status: e.target.value })}
                maxLength={128}
                placeholder="What's happening?"
              />
            </label>
            <div className="profile-edit-actions">
              <button className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveProfile}>Save</button>
            </div>
          </div>
        ) : (
          <>
            {/* Names */}
            <div className="profile-popup-names">
              <span className="profile-popup-displayname">{displayName}</span>
              <span className="profile-popup-username">{profile.username}</span>
            </div>

            {/* Pending incoming friend request actions */}
            {!isOwnProfile && profile.friend_request_status === "pending_incoming" && (
              <div className="profile-popup-friend-actions">
                <button className="btn-primary btn-sm" onClick={handleFriendAction} disabled={actionLoading}>
                  Accept
                </button>
                <button className="btn-secondary btn-sm" onClick={handleDeclineFriend} disabled={actionLoading}>
                  Ignore
                </button>
              </div>
            )}

            {/* Mutual info */}
            {!isOwnProfile && (profile.mutual_friend_count > 0 || profile.mutual_server_count > 0) && (
              <div className="profile-popup-mutuals">
                {profile.mutual_friends.length > 0 && (
                  <div className="profile-popup-mutual-avatars">
                    {profile.mutual_friends.slice(0, 3).map((mf) => (
                      <Avatar
                        key={mf.user_id}
                        avatarUrl={mf.avatar_url}
                        name={mf.display_name || mf.username}
                        size={18}
                        className="mutual-avatar-tiny"
                      />
                    ))}
                  </div>
                )}
                <span className="profile-popup-mutual-text">
                  {profile.mutual_friend_count > 0 && (
                    <>{profile.mutual_friend_count} Mutual Friend{profile.mutual_friend_count !== 1 ? "s" : ""}</>
                  )}
                  {profile.mutual_friend_count > 0 && profile.mutual_server_count > 0 && " • "}
                  {profile.mutual_server_count > 0 && (
                    <>{profile.mutual_server_count} Mutual Server{profile.mutual_server_count !== 1 ? "s" : ""}</>
                  )}
                </span>
              </div>
            )}

            {/* Custom status */}
            {profile.custom_status && (
              <div className="profile-popup-status">
                {profile.custom_status_emoji && (
                  <span className="profile-popup-status-emoji">{profile.custom_status_emoji}</span>
                )}
                {profile.custom_status}
              </div>
            )}

            {/* About me */}
            {profile.about_me && (
              <div className="profile-popup-section">
                <div className="profile-popup-section-label">ABOUT ME</div>
                <div className="profile-popup-about">{profile.about_me}</div>
              </div>
            )}

            {/* Roles (only when viewing in a server context) */}
            {profile.roles && profile.roles.length > 0 && (
              <div className="profile-popup-section">
                <div className="profile-popup-section-label">ROLES</div>
                <div className="profile-popup-roles">
                  {profile.roles.filter((r) => !r.is_default).map((role) => (
                    <span key={role.id} className="profile-popup-role-pill">
                      <span
                        className="profile-popup-role-dot"
                        style={{ backgroundColor: role.color || "#99aab5" }}
                      />
                      {role.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Member since */}
            <div className="profile-popup-section">
              <div className="profile-popup-section-label">MEMBER SINCE</div>
              <div className="profile-popup-date">
                {new Date(profile.created_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </div>
            </div>

            {/* Own profile: Edit button */}
            {isOwnProfile && (
              <div className="profile-popup-actions">
                <button className="btn-secondary profile-popup-btn" onClick={() => setEditing(true)}>
                  Edit Profile
                </button>
              </div>
            )}

            {/* DM message input (other users only) */}
            {!isOwnProfile && (
              <div className="profile-popup-message-wrap">
                <input
                  ref={dmInputRef}
                  className="profile-popup-message-input"
                  placeholder={`Message @${profile.username}`}
                  value={dmText}
                  onChange={(e) => setDmText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendDm();
                    }
                  }}
                />
                <button
                  className="profile-popup-emoji-btn"
                  onClick={() => setShowEmoji(!showEmoji)}
                  type="button"
                  title="Emoji"
                  aria-label="Emoji"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
                  </svg>
                </button>
                {showEmoji && (
                  <div className="profile-popup-emoji-picker">
                    <EmojiPicker
                      onSelect={(emoji) => {
                        setDmText((prev) => prev + emoji);
                        setShowEmoji(false);
                        dmInputRef.current?.focus();
                      }}
                      onClose={() => setShowEmoji(false)}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {confirmUnfriend && profile && (
        <ConfirmDialog
          title="Remove Friend"
          message={`Are you sure you want to remove ${profile.display_name || profile.username} as a friend?`}
          confirmLabel="Remove Friend"
          danger
          onConfirm={() => {
            setConfirmUnfriend(false);
            handleRemoveFriend();
          }}
          onCancel={() => setConfirmUnfriend(false)}
        />
      )}
    </div>
  );
}
