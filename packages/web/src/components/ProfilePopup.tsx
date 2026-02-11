import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import type { UserProfileResponse } from "@haven/core";

interface ProfilePopupProps {
  userId: string;
  position: { top: number; left: number };
  onClose: () => void;
}

export default function ProfilePopup({ userId, position, onClose }: ProfilePopupProps) {
  const api = useAuthStore((s) => s.api);
  const currentUser = useAuthStore((s) => s.user);
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    display_name: "",
    about_me: "",
    custom_status: "",
  });
  const popupRef = useRef<HTMLDivElement>(null);

  const isOwnProfile = currentUser?.id === userId;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getUserProfile(userId).then((p) => {
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
  }, [userId, api]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  // Clamp position to viewport
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(position.top, window.innerHeight - 420),
    left: Math.min(position.left + 8, window.innerWidth - 320),
    zIndex: 1000,
  };

  const handleBlock = async () => {
    if (!profile) return;
    if (profile.is_blocked) {
      await api.unblockUser(userId);
      setProfile({ ...profile, is_blocked: false });
    } else {
      await api.blockUser(userId);
      setProfile({ ...profile, is_blocked: true });
    }
    // Refresh the blocked users list in the chat store
    useChatStore.getState().loadBlockedUsers();
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

    // Update the auth store user object with new profile data
    const authState = useAuthStore.getState();
    if (authState.user) {
      useAuthStore.setState({
        user: { ...authState.user, ...updated },
      });
    }
  };

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

  return (
    <div className="profile-popup" ref={popupRef} style={style}>
      <div className="profile-popup-banner" />
      <div className="profile-popup-avatar-row">
        <div className="profile-popup-avatar">
          {displayName.charAt(0).toUpperCase()}
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
            <div className="profile-popup-names">
              <span className="profile-popup-displayname">{displayName}</span>
              <span className="profile-popup-username">{profile.username}</span>
            </div>

            {profile.custom_status && (
              <div className="profile-popup-status">
                {profile.custom_status_emoji && (
                  <span className="profile-popup-status-emoji">{profile.custom_status_emoji}</span>
                )}
                {profile.custom_status}
              </div>
            )}

            {profile.about_me && (
              <div className="profile-popup-section">
                <div className="profile-popup-section-label">ABOUT ME</div>
                <div className="profile-popup-about">{profile.about_me}</div>
              </div>
            )}

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

            <div className="profile-popup-actions">
              {isOwnProfile ? (
                <button className="btn-secondary profile-popup-btn" onClick={() => setEditing(true)}>
                  Edit Profile
                </button>
              ) : (
                <button
                  className={`profile-popup-btn ${profile.is_blocked ? "btn-secondary" : "btn-danger"}`}
                  onClick={handleBlock}
                >
                  {profile.is_blocked ? "Unblock" : "Block"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
