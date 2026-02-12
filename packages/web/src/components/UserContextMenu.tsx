import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { useFriendsStore } from "../store/friends.js";
import { Permission, type UserProfileResponse } from "@haven/core";
import { usePermissions } from "../hooks/usePermissions.js";

interface Props {
  userId: string;
  serverId?: string;
  position: { x: number; y: number };
  onClose: () => void;
  onOpenProfile: () => void;
  onManageRoles?: () => void;
}

export default function UserContextMenu({ userId, serverId, position, onClose, onOpenProfile, onManageRoles }: Props) {
  const api = useAuthStore((s) => s.api);
  const currentUser = useAuthStore((s) => s.user);
  const startDm = useChatStore((s) => s.startDm);
  const { can } = usePermissions(serverId);
  const ref = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);

  const isSelf = currentUser?.id === userId;
  const canKick = can(Permission.KICK_MEMBERS);
  const canBan = can(Permission.BAN_MEMBERS);
  const canManageRoles = can(Permission.MANAGE_ROLES);

  useEffect(() => {
    api.getUserProfile(userId, serverId).then(setProfile).catch(() => {});
  }, [userId, serverId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(position.y, window.innerHeight - 300),
    left: Math.min(position.x, window.innerWidth - 200),
    zIndex: 400,
  };

  async function handleMessage() {
    if (!profile) return;
    try {
      await startDm(profile.username);
      onClose();
    } catch {}
  }

  async function handleAddFriend() {
    if (!profile) return;
    try {
      await useFriendsStore.getState().sendRequest(profile.username);
      onClose();
    } catch {}
  }

  async function handleRemoveFriend() {
    if (!profile?.friendship_id) return;
    try {
      await useFriendsStore.getState().removeFriend(profile.friendship_id);
      onClose();
    } catch {}
  }

  async function handleBlock() {
    if (!profile) return;
    try {
      if (profile.is_blocked) {
        await api.unblockUser(userId);
      } else {
        await api.blockUser(userId);
      }
      onClose();
    } catch {}
  }

  async function handleKick() {
    if (!serverId) return;
    try {
      await api.kickMember(serverId, userId);
      onClose();
    } catch {}
  }

  async function handleBan() {
    if (!serverId) return;
    try {
      await api.banMember(serverId, userId, {});
      onClose();
    } catch {}
  }

  return (
    <div className="user-context-menu" ref={ref} style={style}>
      <button className="user-context-item" onClick={() => { onOpenProfile(); onClose(); }}>
        Profile
      </button>

      {!isSelf && (
        <button className="user-context-item" onClick={handleMessage}>
          Message
        </button>
      )}

      {!isSelf && profile && (
        <>
          <div className="user-context-divider" />

          {profile.is_friend ? (
            <button className="user-context-item user-context-danger" onClick={handleRemoveFriend}>
              Remove Friend
            </button>
          ) : !profile.friend_request_status ? (
            <button className="user-context-item" onClick={handleAddFriend}>
              Add Friend
            </button>
          ) : (
            <button className="user-context-item" disabled>
              {profile.friend_request_status === "pending_outgoing" ? "Request Sent" : "Request Pending"}
            </button>
          )}

          {serverId && (canManageRoles || canKick || canBan) && (
            <>
              <div className="user-context-divider" />
              {canManageRoles && onManageRoles && (
                <button className="user-context-item" onClick={() => { onManageRoles(); onClose(); }}>
                  Manage Roles
                </button>
              )}
              {canKick && (
                <button className="user-context-item user-context-danger" onClick={handleKick}>
                  Kick
                </button>
              )}
              {canBan && (
                <button className="user-context-item user-context-danger" onClick={handleBan}>
                  Ban
                </button>
              )}
            </>
          )}

          <div className="user-context-divider" />
          <button className="user-context-item user-context-danger" onClick={handleBlock}>
            {profile?.is_blocked ? "Unblock" : "Block"}
          </button>
        </>
      )}
    </div>
  );
}
