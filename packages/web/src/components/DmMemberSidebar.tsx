import { useEffect, useState, lazy, Suspense } from "react";
import { useAuthStore } from "../store/auth.js";
import { usePresenceStore, STATUS_CONFIG } from "../store/presence.js";
import { useChatStore } from "../store/chat.js";
import { useFriendsStore } from "../store/friends.js";
const ProfilePopup = lazy(() => import("./ProfilePopup.js"));
import ConfirmDialog from "./ConfirmDialog.js";
import Avatar from "./Avatar.js";
import type { ChannelMemberInfo } from "@haven/core";

interface DmMemberSidebarProps {
  channelId: string;
  channelType: string;
}

const MAX_GROUP_MEMBERS = 10;

export default function DmMemberSidebar({ channelId, channelType }: DmMemberSidebarProps) {
  const api = useAuthStore((s) => s.api);
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
      setAddError(err.message || "Failed to add member");
    }
  }

  return (
    <aside className="member-sidebar dm-member-sidebar">
      <div className="member-sidebar-header">
        <span className="dm-member-sidebar-title">
          Members — {members.length}
        </span>
        {isGroup && canAddMore && (
          <button
            className="dm-add-member-btn"
            onClick={() => setShowAddMember(!showAddMember)}
            title="Add Member"
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
            placeholder="Search friends..."
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
            autoFocus
          />
          {addError && <div className="error-small" style={{ padding: "4px 8px" }}>{addError}</div>}
          <div className="dm-add-member-list">
            {availableFriends.length === 0 ? (
              <div className="dm-add-member-empty">
                {addSearch ? "No matches" : "No friends to add"}
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
              Leave Group
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
          title="Leave Group"
          message="Are you sure you want to leave this group DM?"
          confirmLabel="Leave"
          danger
          onConfirm={() => { setConfirmLeave(false); handleLeaveGroup(); }}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </aside>
  );
}
