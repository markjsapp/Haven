import { useEffect, useRef, useState } from "react";
import { useVoiceStore } from "../store/voice.js";
import { useAuthStore } from "../store/auth.js";
import { useUiStore } from "../store/ui.js";
import { usePermissions } from "../hooks/usePermissions.js";
import { useMenuKeyboard } from "../hooks/useMenuKeyboard.js";
import { Permission } from "@haven/core";

interface Props {
  userId: string;
  channelId: string;
  serverId: string;
  serverMuted: boolean;
  serverDeafened: boolean;
  position: { x: number; y: number };
  onClose: () => void;
}

export default function VoiceContextMenu({
  userId,
  channelId,
  serverId,
  serverMuted,
  serverDeafened,
  position,
  onClose,
}: Props) {
  const currentUser = useAuthStore((s) => s.user);
  const api = useAuthStore((s) => s.api);
  const { isMuted, isDeafened, toggleMute, toggleDeafen, userVolumes, setUserVolume } = useVoiceStore();
  const { can } = usePermissions(serverId);
  const ref = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useMenuKeyboard(ref);

  const isSelf = currentUser?.id === userId;
  const canMuteMembers = can(Permission.MUTE_MEMBERS);

  // Note state
  const existingNote = useUiStore((s) => s.userNotes[userId] ?? "");
  const setUserNote = useUiStore((s) => s.setUserNote);
  const [noteText, setNoteText] = useState(existingNote);
  const [noteOpen, setNoteOpen] = useState(false);

  // Volume state (0-200, default 100)
  const volume = userVolumes[userId] ?? 100;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Save note on close if it was open
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

  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(position.y, window.innerHeight - 400),
    left: Math.min(position.x, window.innerWidth - 220),
    zIndex: 400,
  };

  async function handleServerMute() {
    try {
      await api.serverMuteUser(channelId, userId, !serverMuted);
      onClose();
    } catch (err) {
      console.error("Failed to server mute:", err);
    }
  }

  async function handleServerDeafen() {
    try {
      await api.serverDeafenUser(channelId, userId, !serverDeafened);
      onClose();
    } catch (err) {
      console.error("Failed to server deafen:", err);
    }
  }

  function handleNoteToggle() {
    if (noteOpen) {
      // Save note when closing
      setUserNote(userId, noteText);
      setNoteOpen(false);
    } else {
      setNoteOpen(true);
    }
  }

  return (
    <div
      className="user-context-menu"
      ref={ref}
      style={style}
      role="menu"
      aria-label="Voice user options"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Self-mute/deafen — only for the current user */}
      {isSelf && (
        <>
          <button
            className="user-context-item"
            role="menuitem"
            tabIndex={-1}
            onClick={() => { toggleMute(); onClose(); }}
          >
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <button
            className="user-context-item"
            role="menuitem"
            tabIndex={-1}
            onClick={() => { toggleDeafen(); onClose(); }}
          >
            {isDeafened ? "Undeafen" : "Deafen"}
          </button>
        </>
      )}

      {/* Server mute/deafen — only for admins with MUTE_MEMBERS permission, not on self */}
      {!isSelf && canMuteMembers && (
        <>
          <button
            className="user-context-item"
            role="menuitem"
            tabIndex={-1}
            onClick={handleServerMute}
          >
            {serverMuted ? "Server Unmute" : "Server Mute"}
          </button>
          <button
            className="user-context-item"
            role="menuitem"
            tabIndex={-1}
            onClick={handleServerDeafen}
          >
            {serverDeafened ? "Server Undeafen" : "Server Deafen"}
          </button>
        </>
      )}

      {/* Add Note — not on self */}
      {!isSelf && (
        <>
          <div className="user-context-divider" role="separator" />
          <button
            className="user-context-item"
            role="menuitem"
            tabIndex={-1}
            onClick={handleNoteToggle}
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
                  // Prevent menu keyboard handler from firing
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

      {/* User Volume — only for other users (not self) */}
      {!isSelf && (
        <>
          <div className="user-context-divider" role="separator" />
          <div className="context-volume-section">
            <span className="context-volume-label">User Volume</span>
            <div className="context-volume-slider-row">
              <input
                type="range"
                className="context-volume-slider"
                min={0}
                max={200}
                value={volume}
                onChange={(e) => setUserVolume(userId, Number(e.target.value))}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="User volume"
              />
              <span className="context-volume-value">{volume}%</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
