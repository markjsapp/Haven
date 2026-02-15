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
  const memberListVersion = useChatStore((s) => s.memberListVersion);

  const [members, setMembers] = useState<ServerMemberResponse[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [nicknameTarget, setNicknameTarget] = useState<{ userId: string; currentNick: string } | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const currentUserId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.listServerMembers(serverId).then((list) => {
      if (cancelled) return;
      setMembers(list);
      setLoading(false);
      const ids = list.map((m) => m.user_id);
      if (ids.length > 0) fetchPresence(ids);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [serverId, memberListVersion]);

  const filtered = searchQuery
    ? members.filter((m) => {
        const q = searchQuery.toLowerCase();
        const name = (m.nickname || m.display_name || m.username).toLowerCase();
        return name.includes(q) || m.username.toLowerCase().includes(q);
      })
    : members;

  // Group members: online+role → under role, online+no role → by status, offline → all in "Offline"
  const nonDefaultRoles = roles.filter((r) => !r.is_default && r.color).sort((a, b) => b.position - a.position);

  const roleGroups: { key: string; label: string; color?: string; members: ServerMemberResponse[] }[] = [];
  const roleBuckets: Record<string, ServerMemberResponse[]> = {};
  const statusBuckets: Record<string, ServerMemberResponse[]> = { online: [], idle: [], dnd: [] };
  const offlineBucket: ServerMemberResponse[] = [];

  for (const m of filtered) {
    const status = presenceStatuses[m.user_id] ?? "offline";
    if (status === "offline" || status === "invisible") {
      offlineBucket.push(m);
      continue;
    }
    // Find highest non-default role
    const topRole = nonDefaultRoles.find((r) => m.role_ids.includes(r.id));
    if (topRole) {
      if (!roleBuckets[topRole.id]) roleBuckets[topRole.id] = [];
      roleBuckets[topRole.id].push(m);
    } else {
      if (status === "online") statusBuckets.online.push(m);
      else if (status === "idle") statusBuckets.idle.push(m);
      else if (status === "dnd") statusBuckets.dnd.push(m);
    }
  }

  // Add role groups (sorted by role position, highest first)
  for (const role of nonDefaultRoles) {
    const bucket = roleBuckets[role.id];
    if (bucket && bucket.length > 0) {
      roleGroups.push({ key: `role-${role.id}`, label: role.name.toUpperCase(), color: role.color ?? undefined, members: bucket });
    }
  }
  // Add status groups for roleless online members
  if (statusBuckets.online.length > 0) roleGroups.push({ key: "online", label: "ONLINE", members: statusBuckets.online });
  if (statusBuckets.idle.length > 0) roleGroups.push({ key: "idle", label: "IDLE", members: statusBuckets.idle });
  if (statusBuckets.dnd.length > 0) roleGroups.push({ key: "dnd", label: "DO NOT DISTURB", members: statusBuckets.dnd });
  // Add offline bucket last
  if (offlineBucket.length > 0) roleGroups.push({ key: "offline", label: "OFFLINE", members: offlineBucket });

  const statusGroups = roleGroups;

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
          <div className="member-group-header" style={group.color ? { color: group.color } : undefined}>{group.label} — {group.members.length}</div>
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
      {filtered.length === 0 && !loading && (
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
          onChangeNickname={(userId) => {
            const m = members.find((mem) => mem.user_id === userId);
            const current = m?.nickname ?? "";
            setNicknameTarget({ userId, currentNick: current });
            setNicknameInput(current);
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

      {nicknameTarget && (
        <div className="modal-overlay" onClick={() => setNicknameTarget(null)} role="presentation">
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="nickname-title">
            <h2 className="modal-title" id="nickname-title">Change Nickname</h2>
            <p className="modal-subtitle">
              {nicknameTarget.userId === currentUserId
                ? "Set a nickname for yourself in this server."
                : "Set a nickname for this member."}
            </p>
            <label className="modal-label">NICKNAME</label>
            <input
              className="modal-input"
              type="text"
              placeholder="Enter a nickname (leave empty to clear)"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const nick = nicknameInput.trim() || null;
                  const isSelf = nicknameTarget.userId === currentUserId;
                  const promise = isSelf
                    ? api.setNickname(serverId, nick)
                    : api.setMemberNickname(serverId, nicknameTarget.userId, nick);
                  promise.then(() => {
                    api.listServerMembers(serverId).then(setMembers).catch(() => {});
                    setNicknameTarget(null);
                  }).catch(() => {});
                }
              }}
              maxLength={32}
              autoFocus
            />
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setNicknameTarget(null)}>Cancel</button>
              <button
                className="btn-primary modal-submit"
                onClick={() => {
                  const nick = nicknameInput.trim() || null;
                  const isSelf = nicknameTarget.userId === currentUserId;
                  const promise = isSelf
                    ? api.setNickname(serverId, nick)
                    : api.setMemberNickname(serverId, nicknameTarget.userId, nick);
                  promise.then(() => {
                    api.listServerMembers(serverId).then(setMembers).catch(() => {});
                    setNicknameTarget(null);
                  }).catch(() => {});
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
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
