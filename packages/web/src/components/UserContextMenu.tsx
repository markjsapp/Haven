import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { useFriendsStore } from "../store/friends.js";
import { useUiStore } from "../store/ui.js";
import { Permission, type UserProfileResponse } from "@haven/core";
import { usePermissions } from "../hooks/usePermissions.js";
import { useMenuKeyboard } from "../hooks/useMenuKeyboard.js";
import InviteToServerModal from "./InviteToServerModal.js";

interface Props {
  userId: string;
  serverId?: string;
  position: { x: number; y: number };
  onClose: () => void;
  onOpenProfile: () => void;
  onManageRoles?: () => void;
  onChangeNickname?: (userId: string) => void;
}

export default function UserContextMenu({ userId, serverId, position, onClose, onOpenProfile, onManageRoles, onChangeNickname }: Props) {
  const api = useAuthStore((s) => s.api);
  const currentUser = useAuthStore((s) => s.user);
  const startDm = useChatStore((s) => s.startDm);
  const { can } = usePermissions(serverId);
  const ref = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useMenuKeyboard(ref);
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);

  const isSelf = currentUser?.id === userId;
  const canKick = can(Permission.KICK_MEMBERS);
  const canBan = can(Permission.BAN_MEMBERS);
  const canManageRoles = can(Permission.MANAGE_ROLES);
  const canManageServer = can(Permission.MANAGE_SERVER);
  const canModerate = can(Permission.MODERATE_MEMBERS);

  // Note state
  const existingNote = useUiStore((s) => s.userNotes[userId] ?? "");
  const setUserNote = useUiStore((s) => s.setUserNote);
  const [noteText, setNoteText] = useState(existingNote);
  const [noteOpen, setNoteOpen] = useState(false);

  // Invite to server state
  const servers = useChatStore((s) => s.servers);
  const [showInviteModal, setShowInviteModal] = useState(false);

  // Timeout state
  const [timeoutOpen, setTimeoutOpen] = useState(false);

  useEffect(() => {
    api.getUserProfile(userId, serverId).then(setProfile).catch(() => {});
  }, [userId, serverId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (noteOpen && noteText !== existingNote) {
          setUserNote(userId, noteText);
        }
        onClose();
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (noteOpen && noteText !== existingNote) {
          setUserNote(userId, noteText);
        }
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose, noteOpen, noteText, existingNote, userId, setUserNote]);

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(position.y, window.innerHeight - 400),
    left: Math.min(position.x, window.innerWidth - 220),
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

  async function handleTimeout(seconds: number) {
    if (!serverId) return;
    try {
      await api.timeoutMember(serverId, userId, seconds);
      onClose();
    } catch {}
  }

  async function handleRemoveTimeout() {
    if (!serverId) return;
    try {
      await api.removeTimeout(serverId, userId);
      onClose();
    } catch {}
  }

  return (
    <div className="user-context-menu" ref={ref} style={style} role="menu" aria-label="User options" tabIndex={-1} onKeyDown={handleKeyDown}>
      <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={() => { onOpenProfile(); onClose(); }}>
        Profile
      </button>

      {!isSelf && (
        <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={handleMessage}>
          Message
        </button>
      )}

      {!isSelf && servers.length > 0 && (
        <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={() => setShowInviteModal(true)}>
          Invite to Server
        </button>
      )}

      {serverId && canManageRoles && onManageRoles && (
        <>
          <div className="user-context-divider" role="separator" />
          <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={() => { onManageRoles(); onClose(); }}>
            Manage Roles
          </button>
        </>
      )}

      {serverId && onChangeNickname && (isSelf || canManageServer) && (
        <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={() => { onChangeNickname(userId); onClose(); }}>
          {isSelf ? "Change Nickname" : "Change Nickname"}
        </button>
      )}

      {/* Add Note — not on self */}
      {!isSelf && (
        <>
          <div className="user-context-divider" role="separator" />
          <button
            className="user-context-item"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              if (noteOpen) {
                setUserNote(userId, noteText);
                setNoteOpen(false);
              } else {
                setNoteOpen(true);
              }
            }}
          >
            {existingNote ? "Edit Note" : "Add Note"}
            <span className="user-context-hint">Only visible to you</span>
          </button>
          {noteOpen && (
            <div className="context-note-input" onMouseDown={(e) => e.stopPropagation()}>
              <textarea
                className="context-note-textarea"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Click to add a note..."
                rows={3}
                autoFocus
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    setUserNote(userId, noteText);
                    setNoteOpen(false);
                  }
                }}
              />
            </div>
          )}
        </>
      )}

      {!isSelf && profile && (
        <>
          <div className="user-context-divider" role="separator" />

          {profile.is_friend ? (
            <button className="user-context-item user-context-danger" role="menuitem" tabIndex={-1} onClick={handleRemoveFriend}>
              Remove Friend
            </button>
          ) : !profile.friend_request_status ? (
            <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={handleAddFriend}>
              Add Friend
            </button>
          ) : (
            <button className="user-context-item" role="menuitem" tabIndex={-1} disabled>
              {profile.friend_request_status === "pending_outgoing" ? "Request Sent" : "Request Pending"}
            </button>
          )}

          {serverId && (canKick || canBan || canModerate) && (
            <>
              <div className="user-context-divider" role="separator" />
              {canModerate && (
                <>
                  <button
                    className="user-context-item user-context-danger"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => setTimeoutOpen(!timeoutOpen)}
                  >
                    Timeout
                  </button>
                  {timeoutOpen && (
                    <div className="context-timeout-options">
                      <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={() => handleTimeout(60)}>60 seconds</button>
                      <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={() => handleTimeout(300)}>5 minutes</button>
                      <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={() => handleTimeout(600)}>10 minutes</button>
                      <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={() => handleTimeout(3600)}>1 hour</button>
                      <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={() => handleTimeout(86400)}>1 day</button>
                      <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={() => handleTimeout(604800)}>1 week</button>
                      <button className="user-context-item" role="menuitem" tabIndex={-1} onClick={handleRemoveTimeout}>Remove Timeout</button>
                    </div>
                  )}
                </>
              )}
              {canKick && (
                <button className="user-context-item user-context-danger" role="menuitem" tabIndex={-1} onClick={handleKick}>
                  Kick
                </button>
              )}
              {canBan && (
                <button className="user-context-item user-context-danger" role="menuitem" tabIndex={-1} onClick={handleBan}>
                  Ban
                </button>
              )}
            </>
          )}

          <div className="user-context-divider" role="separator" />
          <button className="user-context-item user-context-danger" role="menuitem" tabIndex={-1} onClick={handleBlock}>
            {profile?.is_blocked ? "Unblock" : "Block"}
          </button>
        </>
      )}

      {showInviteModal && profile && (
        <InviteToServerModal
          targetUsername={profile.username}
          onClose={() => { setShowInviteModal(false); onClose(); }}
        />
      )}
    </div>
  );
}
