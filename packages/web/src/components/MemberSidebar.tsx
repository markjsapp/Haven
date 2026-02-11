import { useEffect, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { usePresenceStore } from "../store/presence.js";
import { useChatStore } from "../store/chat.js";
import ProfilePopup from "./ProfilePopup.js";
import type { ServerMemberResponse, RoleResponse } from "@haven/core";

export default function MemberSidebar({ serverId }: { serverId: string }) {
  const api = useAuthStore((s) => s.api);
  const presenceStatuses = usePresenceStore((s) => s.statuses);
  const fetchPresence = usePresenceStore((s) => s.fetchPresence);
  const roles = useChatStore((s) => s.roles[serverId] ?? []);

  const [members, setMembers] = useState<ServerMemberResponse[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [profilePopup, setProfilePopup] = useState<{
    userId: string;
    position: { top: number; left: number };
  } | null>(null);

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
        const name = (m.display_name || m.username).toLowerCase();
        return name.includes(searchQuery.toLowerCase());
      })
    : members;

  const online = filtered.filter((m) => presenceStatuses[m.user_id] === "online");
  const offline = filtered.filter((m) => presenceStatuses[m.user_id] !== "online");

  const handleMemberClick = (userId: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setProfilePopup({
      userId,
      position: { top: rect.top, left: rect.left - 310 },
    });
  };

  return (
    <aside className="member-sidebar">
      <div className="member-sidebar-header">
        <div className="search-input-wrapper">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="search-icon">
            <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder="Search"
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
      {online.length > 0 && (
        <>
          <div className="member-group-header">ONLINE — {online.length}</div>
          {online.map((m) => (
            <MemberItem
              key={m.user_id}
              member={m}
              isOnline
              roles={roles}
              onClick={(e) => handleMemberClick(m.user_id, e)}
            />
          ))}
        </>
      )}
      {offline.length > 0 && (
        <>
          <div className="member-group-header">OFFLINE — {offline.length}</div>
          {offline.map((m) => (
            <MemberItem
              key={m.user_id}
              member={m}
              isOnline={false}
              roles={roles}
              onClick={(e) => handleMemberClick(m.user_id, e)}
            />
          ))}
        </>
      )}
      {filtered.length === 0 && (
        <div className="member-group-header">
          {searchQuery ? "No matches" : "MEMBERS — 0"}
        </div>
      )}
      </div>

      {profilePopup && (
        <ProfilePopup
          userId={profilePopup.userId}
          position={profilePopup.position}
          onClose={() => setProfilePopup(null)}
        />
      )}
    </aside>
  );
}

function MemberItem({
  member,
  isOnline,
  roles,
  onClick,
}: {
  member: ServerMemberResponse;
  isOnline: boolean;
  roles: RoleResponse[];
  onClick: (e: React.MouseEvent) => void;
}) {
  const displayName = member.display_name || member.username;

  // Find the highest-position non-default role with a color for this member's badge
  // For now, show the highest-position role that has a color (we don't have per-member role assignments in the member list yet, so show the server's top colored role as a placeholder)
  // TODO: Once member_roles are exposed via API, show actual assigned roles
  const topRole = roles
    .filter((r) => !r.is_default && r.color)
    .sort((a, b) => b.position - a.position)[0];

  return (
    <div className={`member-item ${isOnline ? "" : "offline"}`} onClick={onClick}>
      <div className="member-avatar">
        {displayName.charAt(0).toUpperCase()}
        <span className={`member-avatar-status ${isOnline ? "online" : "offline"}`} />
      </div>
      <div className="member-info">
        <span className="member-name" style={topRole?.color ? { color: topRole.color } : undefined}>
          {displayName}
        </span>
      </div>
    </div>
  );
}
