import { useEffect, useState, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { usePresenceStore, STATUS_CONFIG } from "../store/presence.js";
import { useChatStore } from "../store/chat.js";
import { useFriendsStore } from "../store/friends.js";
const ProfilePopup = lazy(() => import("./ProfilePopup.js"));
import ConfirmDialog from "./ConfirmDialog.js";
import Avatar from "./Avatar.js";
import type { ChannelMemberInfo, UserProfileResponse } from "@haven/core";

interface DmMemberSidebarProps {
  channelId: string;
  channelType: string;
}

const MAX_GROUP_MEMBERS = 10;

export default function DmMemberSidebar({ channelId, channelType }: DmMemberSidebarProps) {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const currentUser = useAuthStore((s) => s.user);
  const presenceStatuses = usePresenceStore((s) => s.statuses);
  const fetchPresence = usePresenceStore((s) => s.fetchPresence);
  const loadChannels = useChatStore((s) => s.loadChannels);

  const [members, setMembers] = useState<ChannelMemberInfo[]>([]);
  const [profilePopup, setProfilePopup] = useState<{
    userId: string;
    position: { top: number; left: number };
  } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addError, setAddError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.listChannelMembers(channelId).then((list) => {
      if (cancelled) return;
      setMembers(list);
      const ids = list.map((m) => m.user_id);
      if (ids.length > 0) fetchPresence(ids);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [channelId, api, fetchPresence]);

  const handleMemberClick = (userId: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setProfilePopup({
      userId,
      position: { top: rect.top, left: rect.left - 310 },
    });
  };

  const isGroup = channelType === "group";
  const isDm = channelType === "dm";

  // For 1-on-1 DMs, find the other person
  const otherMember = isDm && currentUser
    ? members.find((m) => m.user_id !== currentUser.id)
    : null;

  const handleLeaveGroup = async () => {
    try {
      await api.leaveChannel(channelId);
      await loadChannels();
      useChatStore.setState({ currentChannelId: null });
    } catch { /* non-fatal */ }
  };

  // Add member to group
  const friends = useFriendsStore((s) => s.friends);
  const loadFriends = useFriendsStore((s) => s.loadFriends);

  useEffect(() => {
    if (showAddMember) loadFriends();
  }, [showAddMember]);

  const memberIds = new Set(members.map((m) => m.user_id));
  const availableFriends = friends
    .filter((f) => f.status === "accepted" && !memberIds.has(f.user_id))
    .filter((f) => {
      if (!addSearch.trim()) return true;
      const q = addSearch.toLowerCase();
      return f.username.toLowerCase().includes(q) || (f.display_name?.toLowerCase().includes(q) ?? false);
    });

  const canAddMore = members.length < MAX_GROUP_MEMBERS;

  async function handleAddMember(userId: string) {
    setAddError("");
    try {
      await api.addGroupMember(channelId, userId);
      // Refresh member list
      const list = await api.listChannelMembers(channelId);
      setMembers(list);
      setShowAddMember(false);
      setAddSearch("");
    } catch (err: any) {
      setAddError(err.message || t("dmMemberSidebar.failedAddMember"));
    }
  }

  // 1-on-1 DM → show profile card instead of member list
  if (isDm && otherMember) {
    return (
      <aside className="member-sidebar dm-member-sidebar">
        <DmProfileCard userId={otherMember.user_id} />
      </aside>
    );
  }

  // Group DM or fallback → show member list
  return (
    <aside className="member-sidebar dm-member-sidebar">
      <div className="member-sidebar-header">
        <span className="dm-member-sidebar-title">
          {t("dmMemberSidebar.membersTitle")} — {members.length}
        </span>
        {isGroup && canAddMore && (
          <button
            className="dm-add-member-btn"
            onClick={() => setShowAddMember(!showAddMember)}
            title={t("dmMemberSidebar.addMemberTitle")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
          </button>
        )}
      </div>

      {showAddMember && (
        <div className="dm-add-member-panel">
          <input
            type="text"
            className="dm-add-member-search"
            placeholder={t("dmMemberSidebar.searchFriendsPlaceholder")}
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
            autoFocus
          />
          {addError && <div className="error-small" style={{ padding: "4px 8px" }}>{addError}</div>}
          <div className="dm-add-member-list">
            {availableFriends.length === 0 ? (
              <div className="dm-add-member-empty">
                {addSearch ? t("dmMemberSidebar.noMatches") : t("dmMemberSidebar.noFriendsToAdd")}
              </div>
            ) : (
              availableFriends.map((f) => (
                <div key={f.user_id} className="dm-add-member-item" onClick={() => handleAddMember(f.user_id)}>
                  <Avatar
                    avatarUrl={f.avatar_url}
                    name={f.display_name || f.username}
                    size={28}
                  />
                  <span className="dm-add-member-name">{f.display_name || f.username}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="member-sidebar-content">
        {members.map((m) => {
          const status = presenceStatuses[m.user_id] ?? "offline";
          const statusColor = STATUS_CONFIG[status]?.color ?? STATUS_CONFIG.offline.color;
          const displayName = m.display_name || m.username;
          const isOffline = status === "offline";

          return (
            <div
              key={m.user_id}
              className={`member-item ${isOffline ? "offline" : ""}`}
              onClick={(e) => handleMemberClick(m.user_id, e)}
            >
              <div className="member-avatar-wrap">
                <Avatar
                  avatarUrl={m.avatar_url}
                  name={displayName}
                  size={32}
                />
                <span
                  className="member-avatar-status"
                  style={{ backgroundColor: statusColor }}
                />
              </div>
              <div className="member-info">
                <span className="member-name">{displayName}</span>
              </div>
            </div>
          );
        })}

        {isGroup && (
          <div className="dm-member-sidebar-actions">
            <button className="btn-danger dm-leave-btn" onClick={() => setConfirmLeave(true)}>
              {t("dmMemberSidebar.leaveGroup")}
            </button>
          </div>
        )}
      </div>

      {profilePopup && (
        <Suspense fallback={null}>
          <ProfilePopup
            userId={profilePopup.userId}
            position={profilePopup.position}
            onClose={() => setProfilePopup(null)}
          />
        </Suspense>
      )}

      {confirmLeave && (
        <ConfirmDialog
          title={t("dmMemberSidebar.confirm.leaveTitle")}
          message={t("dmMemberSidebar.confirm.leaveMessage")}
          confirmLabel={t("dmMemberSidebar.confirm.leaveLabel")}
          danger
          onConfirm={() => { setConfirmLeave(false); handleLeaveGroup(); }}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </aside>
  );
}

/** Inline profile card for 1-on-1 DM sidebar */
function DmProfileCard({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const presenceStatus = usePresenceStore((s) => s.statuses[userId] ?? "offline");
  const statusConfig = STATUS_CONFIG[presenceStatus] ?? STATUS_CONFIG.offline;

  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getUserProfile(userId).then((p) => {
      if (!cancelled) {
        setProfile(p);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId, api]);

  if (loading) {
    return <div className="dm-profile-card-loading">{t("dmMemberSidebar.profile.loadingProfile")}</div>;
  }

  if (!profile) {
    return <div className="dm-profile-card-loading">{t("dmMemberSidebar.profile.profileUnavailable")}</div>;
  }

  const displayName = profile.display_name || profile.username;

  return (
    <div className="dm-profile-card">
      {/* Banner */}
      <div
        className={`dm-profile-banner${profile.banner_url ? " has-image" : ""}`}
        style={profile.banner_url ? { backgroundImage: `url(${profile.banner_url})` } : undefined}
      />

      {/* Avatar + presence */}
      <div className="dm-profile-avatar-section">
        <div className="dm-profile-avatar-wrap">
          <Avatar
            avatarUrl={profile.avatar_url}
            name={displayName}
            size={80}
            className="dm-profile-avatar"
          />
          <span
            className="dm-profile-presence-dot"
            style={{ backgroundColor: statusConfig.color }}
            aria-label={statusConfig.label}
          />
        </div>
      </div>

      {/* Name block */}
      <div className="dm-profile-names">
        <span className="dm-profile-displayname">{displayName}</span>
        <span className="dm-profile-username">{profile.username}</span>
      </div>

      <div className="dm-profile-divider" />

      {/* Custom status */}
      {profile.custom_status && (
        <>
          <div className="dm-profile-section">
            <div className="dm-profile-section-value">{profile.custom_status}</div>
          </div>
          <div className="dm-profile-divider" />
        </>
      )}

      {/* About me */}
      {profile.about_me && (
        <>
          <div className="dm-profile-section">
            <div className="dm-profile-section-label">{t("dmMemberSidebar.profile.aboutMe")}</div>
            <div className="dm-profile-section-value">{profile.about_me}</div>
          </div>
          <div className="dm-profile-divider" />
        </>
      )}

      {/* Member since */}
      <div className="dm-profile-section">
        <div className="dm-profile-section-label">{t("dmMemberSidebar.profile.memberSince")}</div>
        <div className="dm-profile-section-value">
          {new Date(profile.created_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </div>
      </div>

      {/* Mutual info */}
      {(profile.mutual_server_count > 0 || profile.mutual_friend_count > 0) && (
        <>
          <div className="dm-profile-divider" />
          <div className="dm-profile-section">
            {profile.mutual_server_count > 0 && (
              <div className="dm-profile-mutual-row">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="dm-profile-mutual-icon">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
                <span>{profile.mutual_server_count} {profile.mutual_server_count !== 1 ? t("dmMemberSidebar.profile.mutualServers") : t("dmMemberSidebar.profile.mutualServer")}</span>
              </div>
            )}
            {profile.mutual_friend_count > 0 && (
              <div className="dm-profile-mutual-row">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="dm-profile-mutual-icon">
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                </svg>
                <span>{profile.mutual_friend_count} {profile.mutual_friend_count !== 1 ? t("dmMemberSidebar.profile.mutualFriends") : t("dmMemberSidebar.profile.mutualFriend")}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
