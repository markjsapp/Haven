import { useEffect, useState, useRef } from "react";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { useFriendsStore } from "../store/friends.js";
import { usePresenceStore, STATUS_CONFIG } from "../store/presence.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import Avatar from "./Avatar.js";
import ConfirmDialog from "./ConfirmDialog.js";
import type { UserProfileResponse } from "@haven/core";

interface Props {
  userId: string;
  serverId?: string;
  onClose: () => void;
}

export default function FullProfileCard({ userId, serverId, onClose }: Props) {
  const api = useAuthStore((s) => s.api);
  const currentUser = useAuthStore((s) => s.user);
  const presenceStatus = usePresenceStore((s) => s.statuses[userId] ?? "offline");
  const startDm = useChatStore((s) => s.startDm);

  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmUnfriend, setConfirmUnfriend] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const isOwnProfile = currentUser?.id === userId;
  const statusConfig = STATUS_CONFIG[presenceStatus] ?? STATUS_CONFIG.offline;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getUserProfile(userId, serverId).then((p) => {
      if (cancelled) return;
      setProfile(p);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId, serverId, api]);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

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

  const handleRemoveFriend = async () => {
    if (!profile?.friendship_id) return;
    setActionLoading(true);
    try {
      await useFriendsStore.getState().removeFriend(profile.friendship_id);
      setProfile({ ...profile, is_friend: false, friendship_id: null, friend_request_status: null });
    } finally {
      setActionLoading(false);
    }
  };

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
    }
  };

  const handleMessage = async () => {
    if (!profile) return;
    try {
      await startDm(profile.username);
      onClose();
    } catch {}
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose} role="presentation">
        <div className="full-profile-card" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="dialog" aria-modal="true" aria-label="User profile">
          <div className="full-profile-loading">Loading...</div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="modal-overlay" onClick={onClose} role="presentation">
        <div className="full-profile-card" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="dialog" aria-modal="true" aria-label="User profile">
          <div className="full-profile-loading">User not found</div>
        </div>
      </div>
    );
  }

  const displayName = profile.display_name || profile.username;
  const joinDate = new Date(profile.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="full-profile-card" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="full-profile-title">
        <button className="modal-close-btn full-profile-close" onClick={onClose} aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
          </svg>
        </button>

        <div className="full-profile-layout">
          {/* Left side — profile info */}
          <div className="full-profile-left">
            <div
              className={`full-profile-banner${profile.banner_url ? " has-image" : ""}`}
              style={profile.banner_url ? { backgroundImage: `url(${profile.banner_url})` } : undefined}
            />

            <div className="full-profile-avatar-section">
              <div className="full-profile-avatar-wrap">
                <Avatar
                  avatarUrl={profile.avatar_url}
                  name={displayName}
                  size={96}
                  className="full-profile-avatar"
                />
                <span
                  className="full-profile-presence-dot"
                  style={{ backgroundColor: statusConfig.color }}
                />
              </div>
            </div>

            <div className="full-profile-info">
              {/* Custom status */}
              {profile.custom_status && (
                <div className="full-profile-custom-status">
                  {profile.custom_status_emoji && (
                    <span>{profile.custom_status_emoji} </span>
                  )}
                  {profile.custom_status}
                </div>
              )}

              <div className="full-profile-names">
                <h2 className="full-profile-displayname" id="full-profile-title">{displayName}</h2>
                <span className="full-profile-username">{profile.username}</span>
              </div>

              {/* About Me */}
              {profile.about_me && (
                <div className="full-profile-section">
                  <div className="full-profile-section-label">About Me</div>
                  <div className="full-profile-about">{profile.about_me}</div>
                </div>
              )}

              {/* Member Since */}
              <div className="full-profile-section">
                <div className="full-profile-section-label">Member Since</div>
                <div className="full-profile-date">{joinDate}</div>
              </div>

              {/* Roles */}
              {profile.roles && profile.roles.filter((r) => !r.is_default).length > 0 && (
                <div className="full-profile-section">
                  <div className="full-profile-section-label">Roles</div>
                  <div className="full-profile-roles">
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

              {/* Action buttons */}
              {!isOwnProfile && (
                <div className="full-profile-actions">
                  <button className="btn-primary full-profile-msg-btn" onClick={handleMessage}>
                    Message
                  </button>
                  {!profile.is_friend && !profile.friend_request_status && (
                    <button
                      className="btn-secondary"
                      onClick={handleFriendAction}
                      disabled={actionLoading}
                    >
                      Add Friend
                    </button>
                  )}
                  {profile.friend_request_status === "pending_outgoing" && (
                    <button className="btn-secondary" disabled>
                      Request Sent
                    </button>
                  )}
                  {profile.friend_request_status === "pending_incoming" && (
                    <button
                      className="btn-primary"
                      onClick={handleFriendAction}
                      disabled={actionLoading}
                    >
                      Accept Request
                    </button>
                  )}
                  {profile.is_friend && profile.friendship_id && (
                    <button
                      className="btn-secondary"
                      onClick={() => setConfirmUnfriend(true)}
                      disabled={actionLoading}
                    >
                      Remove Friend
                    </button>
                  )}
                  <button
                    className="btn-secondary"
                    onClick={handleBlock}
                    disabled={actionLoading}
                  >
                    {profile.is_blocked ? "Unblock" : "Block"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right side — mutuals / activity */}
          <div className="full-profile-right">
            {(profile.mutual_friend_count > 0 || profile.mutual_server_count > 0) ? (
              <>
                {profile.mutual_friend_count > 0 && (
                  <div className="full-profile-section">
                    <div className="full-profile-section-label">
                      {profile.mutual_friend_count} Mutual Friend{profile.mutual_friend_count !== 1 ? "s" : ""}
                    </div>
                    <div className="full-profile-mutual-list">
                      {profile.mutual_friends.map((mf) => (
                        <div key={mf.user_id} className="full-profile-mutual-item">
                          <Avatar
                            avatarUrl={mf.avatar_url}
                            name={mf.display_name || mf.username}
                            size={32}
                          />
                          <span className="full-profile-mutual-name">
                            {mf.display_name || mf.username}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {profile.mutual_server_count > 0 && (
                  <div className="full-profile-section">
                    <div className="full-profile-section-label">
                      {profile.mutual_server_count} Mutual Server{profile.mutual_server_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="full-profile-empty-right">
                <p>No mutual friends or servers</p>
              </div>
            )}
          </div>
        </div>

        {confirmUnfriend && profile && (
          <ConfirmDialog
            title="Remove Friend"
            message={`Are you sure you want to remove ${displayName} as a friend?`}
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
    </div>
  );
}
