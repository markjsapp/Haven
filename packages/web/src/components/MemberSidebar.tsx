import { useEffect, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { usePresenceStore } from "../store/presence.js";
import ProfilePopup from "./ProfilePopup.js";
import type { ServerMemberResponse } from "@haven/core";

export default function MemberSidebar({ serverId }: { serverId: string }) {
  const api = useAuthStore((s) => s.api);
  const presenceStatuses = usePresenceStore((s) => s.statuses);
  const fetchPresence = usePresenceStore((s) => s.fetchPresence);

  const [members, setMembers] = useState<ServerMemberResponse[]>([]);
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

  const online = members.filter((m) => presenceStatuses[m.user_id] === "online");
  const offline = members.filter((m) => presenceStatuses[m.user_id] !== "online");

  const handleMemberClick = (userId: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setProfilePopup({
      userId,
      position: { top: rect.top, left: rect.left - 310 },
    });
  };

  return (
    <aside className="member-sidebar">
      {online.length > 0 && (
        <>
          <div className="member-group-header">ONLINE — {online.length}</div>
          {online.map((m) => (
            <MemberItem
              key={m.user_id}
              member={m}
              isOnline
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
              onClick={(e) => handleMemberClick(m.user_id, e)}
            />
          ))}
        </>
      )}
      {members.length === 0 && (
        <div className="member-group-header">MEMBERS — 0</div>
      )}

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
  onClick,
}: {
  member: ServerMemberResponse;
  isOnline: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const displayName = member.display_name || member.username;
  return (
    <div className={`member-item ${isOnline ? "" : "offline"}`} onClick={onClick}>
      <div className="member-avatar">
        {displayName.charAt(0).toUpperCase()}
        <span className={`member-avatar-status ${isOnline ? "online" : "offline"}`} />
      </div>
      <span className="member-name">{displayName}</span>
    </div>
  );
}
