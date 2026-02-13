import { useEffect, useState, lazy, Suspense } from "react";
import { useAuthStore } from "../store/auth.js";
import { usePresenceStore, STATUS_CONFIG } from "../store/presence.js";
import { useChatStore } from "../store/chat.js";
const ProfilePopup = lazy(() => import("./ProfilePopup.js"));
import FullProfileCard from "./FullProfileCard.js";
import UserContextMenu from "./UserContextMenu.js";
import EditMemberRolesModal from "./EditMemberRolesModal.js";
import Avatar from "./Avatar.js";
import type { ServerMemberResponse, RoleResponse } from "@haven/core";

export default function MemberSidebar({ serverId }: { serverId: string }) {
  const api = useAuthStore((s) => s.api);
  const presenceStatuses = usePresenceStore((s) => s.statuses);
  const fetchPresence = usePresenceStore((s) => s.fetchPresence);
  const roles = useChatStore((s) => s.roles[serverId]) ?? [];
  const ownerId = useChatStore((s) => s.servers.find((sv) => sv.id === serverId)?.owner_id);

  const [members, setMembers] = useState<ServerMemberResponse[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [profilePopup, setProfilePopup] = useState<{
    userId: string;
    position: { top: number; left: number };
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    userId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [fullProfileUserId, setFullProfileUserId] = useState<string | null>(null);
  const [editRolesTarget, setEditRolesTarget] = useState<{ userId: string; username: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listServerMembers(serverId).then((list) => {
      if (cancelled) return;
      setMembers(list);
      const ids = list.map((m) => m.user_id);
      if (ids.length > 0) fetchPresence(ids);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [serverId]);

  const filtered = searchQuery
    ? members.filter((m) => {
        const q = searchQuery.toLowerCase();
        const name = (m.nickname || m.display_name || m.username).toLowerCase();
        return name.includes(q) || m.username.toLowerCase().includes(q);
      })
    : members;

  // Group members by presence status
  const statusGroups: { key: string; label: string; members: ServerMemberResponse[] }[] = [];
  const buckets: Record<string, ServerMemberResponse[]> = { online: [], idle: [], dnd: [], offline: [] };
  for (const m of filtered) {
    const status = presenceStatuses[m.user_id] ?? "offline";
    if (status === "online") buckets.online.push(m);
    else if (status === "idle") buckets.idle.push(m);
    else if (status === "dnd") buckets.dnd.push(m);
    else buckets.offline.push(m);
  }
  if (buckets.online.length > 0) statusGroups.push({ key: "online", label: "ONLINE", members: buckets.online });
  if (buckets.idle.length > 0) statusGroups.push({ key: "idle", label: "IDLE", members: buckets.idle });
  if (buckets.dnd.length > 0) statusGroups.push({ key: "dnd", label: "DO NOT DISTURB", members: buckets.dnd });
  if (buckets.offline.length > 0) statusGroups.push({ key: "offline", label: "OFFLINE", members: buckets.offline });

  const handleMemberClick = (userId: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setProfilePopup({
      userId,
      position: { top: rect.top, left: rect.left - 310 },
    });
  };

  const handleContextMenu = (userId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      userId,
      position: { x: e.clientX, y: e.clientY },
    });
  };

  return (
    <aside className="member-sidebar" aria-label="Server members">
      <div className="member-sidebar-header">
        <div className="search-input-wrapper">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="search-icon" aria-hidden="true">
            <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder="Search"
            aria-label="Search members"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear-btn" onClick={() => setSearchQuery("")}>
              &times;
            </button>
          )}
        </div>
      </div>
      <div className="member-sidebar-content">
      {statusGroups.map((group) => (
        <div key={group.key}>
          <div className="member-group-header">{group.label} — {group.members.length}</div>
          {group.members.map((m) => (
            <MemberItem
              key={m.user_id}
              member={m}
              status={presenceStatuses[m.user_id] ?? "offline"}
              roles={roles}
              isOwner={m.user_id === ownerId}
              onClick={(e) => handleMemberClick(m.user_id, e)}
              onContextMenu={(e) => handleContextMenu(m.user_id, e)}
            />
          ))}
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="member-group-header">
          {searchQuery ? "No matches" : "MEMBERS — 0"}
        </div>
      )}
      </div>

      {profilePopup && (
        <Suspense fallback={null}>
          <ProfilePopup
            userId={profilePopup.userId}
            serverId={serverId}
            position={profilePopup.position}
            onClose={() => setProfilePopup(null)}
          />
        </Suspense>
      )}

      {contextMenu && (
        <UserContextMenu
          userId={contextMenu.userId}
          serverId={serverId}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          onOpenProfile={() => {
            setFullProfileUserId(contextMenu.userId);
          }}
          onManageRoles={() => {
            const m = members.find((mem) => mem.user_id === contextMenu.userId);
            if (m) {
              setEditRolesTarget({ userId: m.user_id, username: m.display_name || m.username });
            }
          }}
        />
      )}

      {fullProfileUserId && (
        <FullProfileCard
          userId={fullProfileUserId}
          serverId={serverId}
          onClose={() => setFullProfileUserId(null)}
        />
      )}

      {editRolesTarget && (
        <EditMemberRolesModal
          serverId={serverId}
          userId={editRolesTarget.userId}
          username={editRolesTarget.username}
          onClose={() => setEditRolesTarget(null)}
          onChanged={() => {
            // Reload members to get updated role_ids
            api.listServerMembers(serverId).then(setMembers).catch(() => {});
          }}
        />
      )}
    </aside>
  );
}

function MemberItem({
  member,
  status,
  roles,
  isOwner,
  onClick,
  onContextMenu,
}: {
  member: ServerMemberResponse;
  status: string;
  roles: RoleResponse[];
  isOwner: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const displayName = member.nickname || member.display_name || member.username;
  const showUsername = !!member.nickname;
  const isOffline = status === "offline";
  const statusColor = STATUS_CONFIG[status]?.color ?? STATUS_CONFIG.offline.color;

  const topRole = roles
    .filter((r) => !r.is_default && r.color && member.role_ids.includes(r.id))
    .sort((a, b) => b.position - a.position)[0];

  return (
    <div className={`member-item ${isOffline ? "offline" : ""}`} role="button" tabIndex={0} onClick={onClick} onContextMenu={onContextMenu} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e as any); } }}>
      <div className="member-avatar-wrap">
        <Avatar
          avatarUrl={member.avatar_url}
          name={displayName}
          size={32}
        />
        <span className="member-avatar-status" style={{ backgroundColor: statusColor }} aria-label={status === "online" ? "Online" : status === "idle" ? "Idle" : status === "dnd" ? "Do Not Disturb" : "Offline"} />
      </div>
      <div className="member-info">
        <span className="member-name" style={topRole?.color ? { color: topRole.color } : undefined}>
          {displayName}
        </span>
        {showUsername && (
          <span className="member-username">{member.display_name || member.username}</span>
        )}
      </div>
      {isOwner && (
        <span title="Server Owner">
          <svg className="member-owner-crown" width="16" height="16" viewBox="0 0 16 16" fill="#f0b232" aria-hidden="true">
            <path d="M2 11l2-6 4 3 4-3 2 6H2zm6-9l2.5 4L8 8 5.5 6 8 2z" />
          </svg>
        </span>
      )}
    </div>
  );
}
