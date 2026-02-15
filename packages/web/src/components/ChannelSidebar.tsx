import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from "react";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { useUiStore } from "../store/ui.js";
import { usePresenceStore } from "../store/presence.js";
import { useFriendsStore } from "../store/friends.js";
import { Permission, type ChannelResponse, type CategoryResponse } from "@haven/core";
import { usePermissions } from "../hooks/usePermissions.js";
import { unicodeBtoa } from "../lib/base64.js";
import { useMenuKeyboard } from "../hooks/useMenuKeyboard.js";
import { useRovingTabindex } from "../hooks/useRovingTabindex.js";
import {
  parseChannelName,
  parseDmPeerId,
  parseDmDisplayName,
  parseGroupName,
  parseGroupMemberCount,
  parseServerName,
} from "../lib/channel-utils.js";
import { STATUS_CONFIG } from "../store/presence.js";
import CreateGroupDm from "./CreateGroupDm.js";
import CreateChannelModal from "./CreateChannelModal.js";
import ConfirmDialog from "./ConfirmDialog.js";
import UserPanel from "./UserPanel.js";
const ServerSettings = lazy(() => import("./ServerSettings.js"));
import VoiceChannelPreview from "./VoiceChannelPreview.js";
import ChannelSettings from "./ChannelSettings.js";
import InviteToServerModal from "./InviteToServerModal.js";
import { useVoiceStore } from "../store/voice.js";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useSensors,
  useSensor,
  PointerSensor,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export default function ChannelSidebar() {
  const selectedServerId = useUiStore((s) => s.selectedServerId);

  return (
    <aside className="channel-sidebar" aria-label="Channels">
      {selectedServerId === null ? <DmView /> : <ServerView serverId={selectedServerId} />}
      <UserPanel />
    </aside>
  );
}

// ─── DM View ────────────────────────────────────────

function DmView() {
  const channels = useChatStore((s) => s.channels);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const startDm = useChatStore((s) => s.startDm);
  const user = useAuthStore((s) => s.user);
  const presenceStatuses = usePresenceStore((s) => s.statuses);
  const fetchPresence = usePresenceStore((s) => s.fetchPresence);
  const dmRequests = useFriendsStore((s) => s.dmRequests);
  const loadDmRequests = useFriendsStore((s) => s.loadDmRequests);
  const showFriends = useUiStore((s) => s.showFriends);
  const setShowFriends = useUiStore((s) => s.setShowFriends);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const mentionCounts = useChatStore((s) => s.mentionCounts);
  const typingUsers = useChatStore((s) => s.typingUsers);

  const [showCreateDm, setShowCreateDm] = useState(false);
  const [error, setError] = useState("");
  const [headerSearch, setHeaderSearch] = useState(false);
  const [headerSearchValue, setHeaderSearchValue] = useState("");

  const dmListRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown: handleDmRovingKeyDown } = useRovingTabindex(dmListRef);

  const allDmChannels = channels.filter(
    (ch) => (ch.channel_type === "dm" || ch.channel_type === "group") && ch.dm_status !== "pending"
  );
  const dmChannels = headerSearchValue
    ? allDmChannels.filter((ch) => {
        const name = ch.channel_type === "group"
          ? parseGroupName(ch.encrypted_meta, user?.id ?? "").toLowerCase()
          : parseDmDisplayName(ch.encrypted_meta, user?.id ?? "").toLowerCase();
        return name.includes(headerSearchValue.toLowerCase());
      })
    : allDmChannels;
  const pendingCount = dmRequests.length;

  // Load DM requests on mount
  useEffect(() => {
    loadDmRequests();
  }, []);

  // Fetch initial presence for DM peers
  useEffect(() => {
    if (!user || allDmChannels.length === 0) return;
    const peerIds = allDmChannels
      .map((ch) => parseDmPeerId(ch.encrypted_meta, user.id))
      .filter((id): id is string => id !== null);
    if (peerIds.length > 0) fetchPresence(peerIds);
  }, [allDmChannels.length, user?.id]);

  async function handleStartDm(username: string) {
    if (!username) return;
    setError("");
    try {
      await startDm(username);
      setHeaderSearch(false);
      setHeaderSearchValue("");
    } catch (err: any) {
      setError(err.message || "Failed");
    }
  }

  return (
    <>
      <div className="channel-sidebar-header">
        {headerSearch ? (
          <input
            className="channel-sidebar-header-input"
            type="text"
            placeholder="Find or start a conversation"
            aria-label="Find or start a conversation"
            value={headerSearchValue}
            onChange={(e) => setHeaderSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setHeaderSearch(false);
                setHeaderSearchValue("");
              }
              if (e.key === "Enter" && headerSearchValue.trim()) {
                // If no matching DM, start a new one
                if (dmChannels.length === 0) {
                  handleStartDm(headerSearchValue.trim());
                }
              }
            }}
            onBlur={() => {
              if (!headerSearchValue) {
                setHeaderSearch(false);
              }
            }}
            autoFocus
          />
        ) : (
          <button
            className="channel-sidebar-header-btn"
            onClick={() => setHeaderSearch(true)}
          >
            Find or start a conversation
          </button>
        )}
      </div>
      <div className="channel-sidebar-content" ref={dmListRef} onKeyDown={handleDmRovingKeyDown}>
        {/* Friends Button */}
        <button
          className={`friends-nav-btn ${showFriends ? "active" : ""}`}
          onClick={() => setShowFriends(true)}
          data-roving-item
          tabIndex={showFriends ? 0 : -1}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 8.01c0 2.21-1.79 4-4 4s-4-1.79-4-4 1.79-4 4-4 4 1.79 4 4zm-4 6c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm9-3v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z" />
          </svg>
          <span>Friends</span>
        </button>

        {/* Message Requests */}
        {pendingCount > 0 && (
          <div className="channel-category-header">
            <span>Message Requests</span>
            <span className="request-badge">{pendingCount}</span>
          </div>
        )}

        {pendingCount > 0 && (
          <ul className="channel-list">
            {dmRequests.map((ch) => (
              <li key={ch.id}>
                <button
                  className={`channel-item dm-item pending ${ch.id === currentChannelId ? "active" : ""}`}
                  onClick={() => { selectChannel(ch.id); setShowFriends(false); }}
                  data-roving-item
                  tabIndex={!showFriends && ch.id === currentChannelId ? 0 : -1}
                >
                  <div className="dm-avatar pending">
                    {parseDmDisplayName(ch.encrypted_meta, user?.id ?? "").charAt(0).toUpperCase()}
                  </div>
                  <span className="dm-item-name">
                    {parseDmDisplayName(ch.encrypted_meta, user?.id ?? "")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="channel-category-header">
          <span>Direct Messages</span>
          <button
            className="btn-icon"
            onClick={() => setShowCreateDm(true)}
            title="Create DM"
            aria-label="Create DM"
          >
            +
          </button>
        </div>

        <ul className="channel-list">
          {dmChannels.map((ch) => {
            if (ch.channel_type === "group") {
              const gName = parseGroupName(ch.encrypted_meta, user?.id ?? "");
              const memberCount = parseGroupMemberCount(ch.encrypted_meta);
              const unread = unreadCounts[ch.id] ?? 0;
              const grpTyping = (typingUsers[ch.id] ?? []).filter((t) => t.expiry > Date.now());
              const grpIsTyping = grpTyping.length > 0;
              // Use the first typing user's presence color for group typing indicator
              const grpTypingUserId = grpIsTyping ? grpTyping[0].userId : null;
              const grpTypingStatus = grpTypingUserId ? (presenceStatuses[grpTypingUserId] ?? "online") : "online";
              const grpTypingColor = grpIsTyping ? STATUS_CONFIG[grpTypingStatus]?.color ?? "var(--text-muted)" : undefined;
              return (
                <li key={ch.id}>
                  <button
                    className={`channel-item dm-item ${ch.id === currentChannelId ? "active" : ""} ${unread > 0 ? "unread" : ""}`}
                    onClick={() => { selectChannel(ch.id); setShowFriends(false); setHeaderSearch(false); setHeaderSearchValue(""); }}
                    data-roving-item
                    tabIndex={!showFriends && ch.id === currentChannelId ? 0 : -1}
                  >
                    <div className="dm-avatar group-dm-avatar">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                      </svg>
                      {grpIsTyping && (
                        <span className="dm-avatar-typing" aria-label="Typing" style={{ "--typing-color": grpTypingColor } as React.CSSProperties}>
                          <span /><span /><span />
                        </span>
                      )}
                    </div>
                    <div className="dm-item-text">
                      <span className="dm-item-name">{gName}</span>
                      {memberCount > 0 && (
                        <span className="dm-item-members">{memberCount} Members</span>
                      )}
                    </div>
                    {unread > 0 && <span className="unread-badge" aria-label={`${unread} unread messages`}>{unread}</span>}
                  </button>
                </li>
              );
            }
            const peerId = parseDmPeerId(ch.encrypted_meta, user?.id ?? "");
            const peerStatus = peerId ? (presenceStatuses[peerId] ?? "offline") : "offline";
            const isActive = peerStatus !== "offline" && peerStatus !== "invisible";
            const unread = unreadCounts[ch.id] ?? 0;
            const chTyping = (typingUsers[ch.id] ?? []).filter((t) => t.expiry > Date.now());
            const isTyping = chTyping.length > 0;
            const typingColor = isTyping ? STATUS_CONFIG[peerStatus]?.color ?? "var(--text-muted)" : undefined;
            return (
              <li key={ch.id}>
                <button
                  className={`channel-item dm-item ${ch.id === currentChannelId ? "active" : ""} ${unread > 0 ? "unread" : ""}`}
                  onClick={() => { selectChannel(ch.id); setShowFriends(false); setHeaderSearch(false); setHeaderSearchValue(""); }}
                  data-roving-item
                  tabIndex={!showFriends && ch.id === currentChannelId ? 0 : -1}
                >
                  <div className="dm-avatar">
                    {parseDmDisplayName(ch.encrypted_meta, user?.id ?? "").charAt(0).toUpperCase()}
                    {isTyping ? (
                      <span className="dm-avatar-typing" aria-label="Typing" style={{ "--typing-color": typingColor } as React.CSSProperties}>
                        <span /><span /><span />
                      </span>
                    ) : (
                      <span className={`dm-avatar-status ${isActive ? "online" : "offline"}`} aria-label={isActive ? "Online" : "Offline"} />
                    )}
                  </div>
                  <span className="dm-item-name">
                    {parseDmDisplayName(ch.encrypted_meta, user?.id ?? "")}
                  </span>
                  {unread > 0 && <span className="unread-badge" aria-label={`${unread} unread messages`}>{unread}</span>}
                </button>
              </li>
            );
          })}
          {headerSearchValue && dmChannels.length === 0 && (
            <li>
              <button
                className="channel-item dm-item start-dm-item"
                onClick={() => handleStartDm(headerSearchValue.trim())}
                data-roving-item
                tabIndex={-1}
              >
                <span className="dm-item-name">Start DM with <strong>{headerSearchValue.trim()}</strong></span>
              </button>
            </li>
          )}
        </ul>
        {error && <div className="error-small" style={{ padding: "0 12px" }}>{error}</div>}
      </div>

      {showCreateDm && (
        <CreateGroupDm onClose={() => setShowCreateDm(false)} />
      )}
    </>
  );
}

// ─── Channel Context Menu ─────────────────────────────

const MUTE_DURATIONS = [
  { label: "For 15 Minutes", ms: 15 * 60 * 1000 },
  { label: "For 1 Hour", ms: 60 * 60 * 1000 },
  { label: "For 3 Hours", ms: 3 * 60 * 60 * 1000 },
  { label: "For 8 Hours", ms: 8 * 60 * 60 * 1000 },
  { label: "For 24 Hours", ms: 24 * 60 * 60 * 1000 },
  { label: "Until I turn it back on", ms: null as number | null },
];

const NOTIFICATION_OPTIONS: { label: string; value: "default" | "all" | "mentions" | "nothing"; desc?: string }[] = [
  { label: "Use Category Default", value: "default", desc: "All Messages" },
  { label: "All Messages", value: "all" },
  { label: "Only @mentions", value: "mentions" },
  { label: "Nothing", value: "nothing" },
];

function ChannelContextMenu({
  channelId,
  x,
  y,
  submenu,
  canManageChannels,
  onPermissions,
  onDelete,
  onShowSubmenu,
  onClose,
}: {
  channelId: string;
  x: number;
  y: number;
  submenu?: "mute" | "notify";
  canManageChannels: boolean;
  onPermissions: () => void;
  onDelete: () => void;
  onShowSubmenu: (sub: "mute" | "notify" | undefined) => void;
  onClose: () => void;
}) {
  const muteChannel = useUiStore((s) => s.muteChannel);
  const unmuteChannel = useUiStore((s) => s.unmuteChannel);
  const isChannelMuted = useUiStore((s) => s.isChannelMuted);
  const setChannelNotification = useUiStore((s) => s.setChannelNotification);
  const channelNotifications = useUiStore((s) => s.channelNotifications);
  const menuRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useMenuKeyboard(menuRef);

  const muted = isChannelMuted(channelId);
  const currentNotify = channelNotifications[channelId] ?? "default";

  // Notification label for display
  const notifyLabel = NOTIFICATION_OPTIONS.find((o) => o.value === currentNotify)?.label ?? "All Messages";

  return (
    <div
      ref={menuRef}
      className="channel-context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      role="menu"
      aria-label="Channel options"
      tabIndex={-1}
    >
      {/* Mute Channel */}
      <div
        className="context-submenu-trigger"
        onMouseEnter={() => onShowSubmenu("mute")}
      >
        <button role="menuitem" tabIndex={-1} onClick={(e) => {
          e.stopPropagation();
          if (muted) {
            unmuteChannel(channelId);
            onClose();
          } else {
            onShowSubmenu(submenu === "mute" ? undefined : "mute");
          }
        }}>
          {muted ? "Unmute Channel" : "Mute Channel"}
          {!muted && <span className="context-submenu-arrow">›</span>}
        </button>
        {submenu === "mute" && !muted && (
          <div className="context-submenu" onMouseLeave={() => onShowSubmenu(undefined)}>
            {MUTE_DURATIONS.map((d) => (
              <button
                key={d.label}
                onClick={() => {
                  muteChannel(channelId, d.ms);
                  onClose();
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notification Settings */}
      <div
        className="context-submenu-trigger"
        onMouseEnter={() => onShowSubmenu("notify")}
      >
        <button role="menuitem" tabIndex={-1} onClick={(e) => {
          e.stopPropagation();
          onShowSubmenu(submenu === "notify" ? undefined : "notify");
        }}>
          <span className="context-btn-with-sub">
            <span>Notification Settings</span>
            <span className="context-sub-label">{notifyLabel}</span>
          </span>
          <span className="context-submenu-arrow">›</span>
        </button>
        {submenu === "notify" && (
          <div className="context-submenu" onMouseLeave={() => onShowSubmenu(undefined)}>
            {NOTIFICATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={currentNotify === opt.value ? "active" : ""}
                onClick={() => {
                  setChannelNotification(channelId, opt.value);
                  onClose();
                }}
              >
                <span className="context-btn-with-sub">
                  <span>{opt.label}</span>
                  {opt.desc && <span className="context-sub-label">{opt.desc}</span>}
                </span>
                <span className={`context-radio ${currentNotify === opt.value ? "context-radio-active" : ""}`} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Admin-only items */}
      {canManageChannels && (
        <>
          <div className="context-divider" role="separator" />
          <button role="menuitem" tabIndex={-1} onClick={onPermissions}>Edit Channel</button>
          <button role="menuitem" tabIndex={-1} className="danger" onClick={onDelete}>Delete Channel</button>
        </>
      )}
    </div>
  );
}

// ─── Category Context Menu (inline) ──────────────────
function CategoryContextMenuPopup({
  x,
  y,
  onCreateChannel,
  onRenameCategory,
  onCreateCategory,
  onDeleteCategory,
}: {
  x: number;
  y: number;
  onCreateChannel: () => void;
  onRenameCategory: () => void;
  onCreateCategory: () => void;
  onDeleteCategory: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useMenuKeyboard(menuRef);

  return (
    <div
      ref={menuRef}
      className="channel-context-menu"
      style={{ top: y, left: x }}
      role="menu"
      aria-label="Category options"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <button role="menuitem" tabIndex={-1} onClick={onCreateChannel}>
        Create Channel
      </button>
      <button role="menuitem" tabIndex={-1} onClick={onRenameCategory}>
        Rename Category
      </button>
      <button role="menuitem" tabIndex={-1} onClick={onCreateCategory}>
        Create Category
      </button>
      <button role="menuitem" tabIndex={-1} className="danger" onClick={onDeleteCategory}>
        Delete Category
      </button>
    </div>
  );
}

// ─── Server Header Context Menu (inline) ─────────────
function ServerHeaderContextMenu({
  x,
  y,
  onCreateChannel,
  onCreateCategory,
}: {
  x: number;
  y: number;
  onCreateChannel: () => void;
  onCreateCategory: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useMenuKeyboard(menuRef);

  return (
    <div
      ref={menuRef}
      className="channel-context-menu"
      style={{ top: y, left: x }}
      role="menu"
      aria-label="Server options"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <button role="menuitem" tabIndex={-1} onClick={onCreateChannel}>
        Create Channel
      </button>
      <button role="menuitem" tabIndex={-1} onClick={onCreateCategory}>
        Create Category
      </button>
    </div>
  );
}

// ─── Server Dropdown Menu (chevron click) ─────────────
function ServerDropdownMenu({
  anchorRect,
  onInvite,
  onSettings,
  onCreateChannel,
  onCreateCategory,
  onLeave,
  canCreateInvites,
  canManageServer,
  canManageChannels,
  isOwner,
  onClose,
}: {
  anchorRect: DOMRect;
  onInvite: () => void;
  onSettings: () => void;
  onCreateChannel: () => void;
  onCreateCategory: () => void;
  onLeave: () => void;
  canCreateInvites: boolean;
  canManageServer: boolean;
  canManageChannels: boolean;
  isOwner: boolean;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useMenuKeyboard(menuRef);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="channel-context-menu"
      style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
      role="menu"
      aria-label="Server options"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {canCreateInvites && (
        <button role="menuitem" tabIndex={-1} onClick={() => { onClose(); onInvite(); }}>
          Invite People
        </button>
      )}
      {canManageServer && (
        <button role="menuitem" tabIndex={-1} onClick={() => { onClose(); onSettings(); }}>
          Server Settings
        </button>
      )}
      {(canCreateInvites || canManageServer) && canManageChannels && (
        <div className="context-menu-divider" />
      )}
      {canManageChannels && (
        <button role="menuitem" tabIndex={-1} onClick={() => { onClose(); onCreateChannel(); }}>
          Create Channel
        </button>
      )}
      {canManageChannels && (
        <button role="menuitem" tabIndex={-1} onClick={() => { onClose(); onCreateCategory(); }}>
          Create Category
        </button>
      )}
      <div className="context-menu-divider" />
      <button role="menuitem" tabIndex={-1} className="context-menu-item-danger" onClick={() => { onClose(); onLeave(); }}>
        Leave Server
      </button>
    </div>
  );
}

// ─── Sortable Channel Item ────────────────────────────

function SortableChannelItem({
  ch,
  disabled,
  onContextMenu,
}: {
  ch: ChannelResponse;
  disabled?: boolean;
  onContextMenu?: (e: React.MouseEvent, chId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: ch.id,
    disabled: disabled,
    data: { type: "channel", categoryId: ch.category_id ?? "uncategorized" },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <li ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ChannelItemContent ch={ch} onContextMenu={onContextMenu} />
    </li>
  );
}

// ─── Channel Item Content (shared between sortable items and drag overlay) ────

function ChannelItemContent({ ch, isOverlay, onContextMenu }: { ch: ChannelResponse; isOverlay?: boolean; onContextMenu?: (e: React.MouseEvent, chId: string) => void }) {
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const mentionCounts = useChatStore((s) => s.mentionCounts);
  const isChannelMuted = useUiStore((s) => s.isChannelMuted);
  const channelNotifications = useUiStore((s) => s.channelNotifications);

  const isVoice = ch.channel_type === "voice";
  const muted = isChannelMuted(ch.id);
  const notifySetting = channelNotifications[ch.id] ?? "default";
  const rawUnread = unreadCounts[ch.id] ?? 0;
  const rawMentions = mentionCounts[ch.id] ?? 0;

  // Suppress indicators based on mute/notification settings
  const showUnreadDot = !muted && notifySetting !== "nothing" && notifySetting !== "mentions" && rawUnread > 0;
  const unread = muted || notifySetting === "nothing" ? 0 : rawUnread;
  const mentions = muted || notifySetting === "nothing" ? 0 : rawMentions;
  const voiceCurrentChannel = useVoiceStore.getState().currentChannelId;
  const isInThisVoice = voiceCurrentChannel === ch.id;

  const handleChannelClick = useCallback(() => {
    if (isVoice) {
      selectChannel(ch.id);
      if (!isInThisVoice) {
        useVoiceStore.getState().joinVoice(ch.id);
      }
    } else {
      selectChannel(ch.id);
    }
  }, [ch.id, isVoice, isInThisVoice, selectChannel]);

  return (
    <>
      <button
        className={`channel-item ${ch.id === currentChannelId ? "active" : ""} ${unread > 0 ? "unread" : ""} ${muted ? "muted" : ""} ${isInThisVoice ? "voice-active" : ""} ${isOverlay ? "drag-overlay" : ""}`}
        onClick={isOverlay ? undefined : handleChannelClick}
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, ch.id) : undefined}
        data-roving-item
        tabIndex={ch.id === currentChannelId ? 0 : -1}
      >
        {showUnreadDot && mentions === 0 && <span className="channel-unread-dot" />}
        {isVoice ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isInThisVoice ? "var(--green)" : "currentColor"} className="channel-type-icon">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        ) : (
          <span className="channel-hash">#</span>
        )}
        {parseChannelName(ch.encrypted_meta)}
        {muted && (
          <>
            <svg className="channel-muted-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16.5 12A4.5 4.5 0 0 0 14 8.27V6.11l-4-4L8.59 3.52 20.48 15.41 21.89 14l-5.39-5.39V12zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.9 8.9 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
            </svg>
            <span className="sr-only">Muted</span>
          </>
        )}
        {mentions > 0 && <span className="unread-badge" aria-label={`${mentions} unread messages`}>{mentions}</span>}
      </button>
      {!isOverlay && isVoice && <VoiceChannelPreview channelId={ch.id} />}
    </>
  );
}

// ─── Sortable Category ────────────────────────────────

function SortableCategorySection({
  cat,
  channels: catChannels,
  canManageChannels,
  isCollapsed,
  onToggleCollapse,
  onCreateChannel,
  onCategoryContextMenu,
  renamingCatId,
  renameCatValue,
  setRenameCatValue,
  onRenameCategory,
  setRenamingCatId,
  renamingId,
  renameValue,
  setRenameValue,
  onRenameChannel,
  setRenamingId,
  onChannelContextMenu,
  activeChannelId,
}: {
  cat: CategoryResponse;
  channels: ChannelResponse[];
  canManageChannels: boolean;
  isCollapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onCreateChannel: (catId: string, catName: string) => void;
  onCategoryContextMenu: (e: React.MouseEvent, catId: string) => void;
  renamingCatId: string | null;
  renameCatValue: string;
  setRenameCatValue: (v: string) => void;
  onRenameCategory: (catId: string) => void;
  setRenamingCatId: (v: string | null) => void;
  renamingId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onRenameChannel: (chId: string) => void;
  setRenamingId: (v: string | null) => void;
  onChannelContextMenu: (e: React.MouseEvent, chId: string) => void;
  activeChannelId: string | null;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `cat-${cat.id}`,
    disabled: false,
    data: { type: "category" },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const unreadCounts = useChatStore((s) => s.unreadCounts);

  // When collapsed, still show unread or active channels
  const visibleChannels = isCollapsed
    ? catChannels.filter(
        (ch) =>
          ch.id === currentChannelId ||
          (unreadCounts[ch.id] ?? 0) > 0
      )
    : catChannels;

  const channelIds = catChannels.map((ch) => ch.id);

  return (
    <div ref={setNodeRef} style={style}>
      <DroppableZone id={cat.id}>
        <div
          className="channel-category-header"
          onContextMenu={(e) => onCategoryContextMenu(e, cat.id)}
        >
          {renamingCatId === cat.id ? (
            <div className="dm-input-row" style={{ flex: 1 }}>
              <input
                type="text"
                value={renameCatValue}
                onChange={(e) => setRenameCatValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRenameCategory(cat.id);
                  if (e.key === "Escape") setRenamingCatId(null);
                }}
                autoFocus
              />
              <button className="btn-small" onClick={() => onRenameCategory(cat.id)}>Save</button>
            </div>
          ) : (
            <>
              <button
                className="category-collapse-btn"
                onClick={() => onToggleCollapse(cat.id)}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${cat.name}`}
                aria-expanded={!isCollapsed}
                {...attributes}
                {...listeners}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={`category-chevron ${isCollapsed ? "collapsed" : ""}`}
                >
                  <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
                </svg>
                <span>{cat.name.toUpperCase()}</span>
              </button>
              {canManageChannels && (
                <button
                  className="btn-icon"
                  onClick={() => onCreateChannel(cat.id, cat.name)}
                  title={`Create Channel in ${cat.name}`}
                  aria-label="Create Channel"
                >
                  +
                </button>
              )}
            </>
          )}
        </div>

        <SortableContext items={channelIds} strategy={verticalListSortingStrategy}>
          <ul className="channel-list">
            {(isCollapsed ? visibleChannels : catChannels).map((ch) => {
              if (renamingId === ch.id) {
                return (
                  <li key={ch.id}>
                    <div className="dm-input-row">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") onRenameChannel(ch.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        autoFocus
                      />
                      <button className="btn-small" onClick={() => onRenameChannel(ch.id)}>Save</button>
                    </div>
                  </li>
                );
              }
              return (
                <SortableChannelItem
                  key={ch.id}
                  ch={ch}
                  disabled={isCollapsed}
                  onContextMenu={onChannelContextMenu}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DroppableZone>
    </div>
  );
}

// ─── Droppable zone for receiving channels ─────────────

function DroppableZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${id}`,
    data: { type: "category-drop", categoryId: id },
  });
  return (
    <div ref={setNodeRef} className={`droppable-category ${isOver ? "over" : ""}`}>
      {children}
    </div>
  );
}

// ─── Server View ────────────────────────────────────

function ServerView({ serverId }: { serverId: string }) {
  const channels = useChatStore((s) => s.channels);
  const servers = useChatStore((s) => s.servers);
  const serverCategories = useChatStore((s) => s.categories[serverId]) ?? [];
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const api = useAuthStore((s) => s.api);
  const user = useAuthStore((s) => s.user);

  const [showSettings, setShowSettings] = useState(false);
  const [createModal, setCreateModal] = useState<{ categoryId?: string | null; categoryName?: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ channelId: string; x: number; y: number; submenu?: "mute" | "notify" } | null>(null);
  const [categoryContextMenu, setCategoryContextMenu] = useState<{ categoryId: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingCatId, setRenamingCatId] = useState<string | null>(null);
  const [renameCatValue, setRenameCatValue] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [confirmDeleteChannel, setConfirmDeleteChannel] = useState<string | null>(null);
  const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [serverContextMenu, setServerContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showServerDropdown, setShowServerDropdown] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [confirmLeaveServer, setConfirmLeaveServer] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);

  const channelListRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown: handleChannelRovingKeyDown } = useRovingTabindex(channelListRef);
  const server = servers.find((s) => s.id === serverId);
  const serverName = server ? parseServerName(server.encrypted_meta) : "Server";
  const serverChannels = channels.filter((ch) => ch.server_id === serverId);

  const [chUnreadAbove, setChUnreadAbove] = useState(false);
  const [chUnreadBelow, setChUnreadBelow] = useState(false);

  const checkChannelScrollIndicators = useCallback(() => {
    const container = channelListRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    let above = false;
    let below = false;
    const items = container.querySelectorAll(".channel-item.unread");
    for (const el of items) {
      const elRect = el.getBoundingClientRect();
      if (elRect.bottom < rect.top + 4) above = true;
      if (elRect.top > rect.bottom - 4) below = true;
    }
    setChUnreadAbove(above);
    setChUnreadBelow(below);
  }, [unreadCounts]);

  useEffect(() => {
    checkChannelScrollIndicators();
  }, [unreadCounts, serverChannels.length, checkChannelScrollIndicators]);

  useEffect(() => {
    const container = channelListRef.current;
    if (!container) return;
    container.addEventListener("scroll", checkChannelScrollIndicators, { passive: true });
    return () => container.removeEventListener("scroll", checkChannelScrollIndicators);
  }, [checkChannelScrollIndicators]);
  const { can, isOwner } = usePermissions(serverId);
  const canManageChannels = can(Permission.MANAGE_CHANNELS);
  const canCreateInvites = can(Permission.CREATE_INVITES);
  const canManageServer = can(Permission.MANAGE_SERVER);

  // Auto-select a channel when switching to a server with no active channel
  useEffect(() => {
    if (serverChannels.length === 0) return;
    const currentInServer = currentChannelId && serverChannels.some((ch) => ch.id === currentChannelId);
    if (currentInServer) return;

    // Prefer the system channel, then fall back to first text channel
    const systemId = server?.system_channel_id;
    const target = (systemId && serverChannels.find((ch) => ch.id === systemId))
      || serverChannels.find((ch) => ch.channel_type === "text")
      || serverChannels[0];
    if (target) selectChannel(target.id);
  }, [serverId, serverChannels.length]);

  // Group channels by category, sorted by position
  const { uncategorized, categorized } = useMemo(() => {
    const uncategorized: ChannelResponse[] = [];
    const categorized: Record<string, ChannelResponse[]> = {};

    for (const cat of serverCategories) {
      categorized[cat.id] = [];
    }

    for (const ch of serverChannels) {
      if (ch.category_id && categorized[ch.category_id]) {
        categorized[ch.category_id].push(ch);
      } else {
        uncategorized.push(ch);
      }
    }

    // Sort channels by position within each group
    uncategorized.sort((a, b) => a.position - b.position);
    for (const catId of Object.keys(categorized)) {
      categorized[catId].sort((a, b) => a.position - b.position);
    }

    return { uncategorized, categorized };
  }, [serverChannels, serverCategories]);

  // Build a mutable local order map for optimistic reordering
  const [localOrder, setLocalOrder] = useState<Record<string, string[]> | null>(null);

  // Get ordered channel IDs for a container
  const getChannelIds = useCallback(
    (containerId: string) => {
      if (localOrder && localOrder[containerId]) return localOrder[containerId];
      const list = containerId === "uncategorized" ? uncategorized : (categorized[containerId] ?? []);
      return list.map((ch) => ch.id);
    },
    [localOrder, uncategorized, categorized],
  );

  // Get channel list for a container (using local order if dragging)
  const getOrderedChannels = useCallback(
    (containerId: string) => {
      const ids = getChannelIds(containerId);
      return ids
        .map((id) => serverChannels.find((ch) => ch.id === id))
        .filter((ch): ch is ChannelResponse => ch != null);
    },
    [getChannelIds, serverChannels],
  );

  function toggleCollapse(categoryId: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  async function handleRename(channelId: string) {
    if (!renameValue.trim()) return;
    try {
      const meta = JSON.stringify({ name: renameValue.trim() });
      await api.updateChannel(channelId, { encrypted_meta: unicodeBtoa(meta) });
      await loadChannels();
      setRenamingId(null);
    } catch { /* non-fatal */ }
  }

  async function handleDelete(channelId: string) {
    try {
      const wasCurrent = useChatStore.getState().currentChannelId === channelId;
      await api.deleteChannel(channelId);
      await loadChannels();
      if (wasCurrent) {
        useChatStore.setState({ currentChannelId: null });
      }
    } catch { /* non-fatal */ }
  }

  async function handleRenameCategory(catId: string) {
    if (!renameCatValue.trim()) return;
    try {
      await api.updateCategory(serverId, catId, { name: renameCatValue.trim() });
      await loadChannels();
      setRenamingCatId(null);
    } catch { /* non-fatal */ }
  }

  async function handleDeleteCategory(catId: string) {
    try {
      await api.deleteCategory(serverId, catId);
      await loadChannels();
    } catch { /* non-fatal */ }
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;
    try {
      await api.createCategory(serverId, {
        name: newCategoryName.trim(),
        position: serverCategories.length,
      });
      await loadChannels();
      setNewCategoryName("");
      setShowCreateCategory(false);
    } catch { /* non-fatal */ }
  }

  async function handleLeaveServer() {
    try {
      await api.leaveServer(serverId);
      useUiStore.getState().selectServer(null);
      await loadChannels();
    } catch { /* non-fatal */ }
  }

  const headerBtnRef = useRef<HTMLButtonElement>(null);

  function handleContextMenu(e: React.MouseEvent, channelId: string) {
    e.preventDefault();
    setCategoryContextMenu(null);
    setServerContextMenu(null);
    setContextMenu({ channelId, x: e.clientX, y: e.clientY });
  }

  function handleCategoryContextMenu(e: React.MouseEvent, categoryId: string) {
    if (!canManageChannels) return;
    e.preventDefault();
    setContextMenu(null);
    setServerContextMenu(null);
    setCategoryContextMenu({ categoryId, x: e.clientX, y: e.clientY });
  }

  function handleServerContextMenu(e: React.MouseEvent) {
    if (!canManageChannels) return;
    e.preventDefault();
    setContextMenu(null);
    setCategoryContextMenu(null);
    setServerContextMenu({ x: e.clientX, y: e.clientY });
  }

  // Close context menus on outside click
  useEffect(() => {
    if (!contextMenu && !categoryContextMenu && !serverContextMenu) return;
    const handler = () => { setContextMenu(null); setCategoryContextMenu(null); setServerContextMenu(null); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu, categoryContextMenu, serverContextMenu]);

  // ─── Drag & Drop ────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Find which container a channel belongs to
  function findContainer(channelId: string): string | null {
    // Check local order first
    if (localOrder) {
      for (const [containerId, ids] of Object.entries(localOrder)) {
        if (ids.includes(channelId)) return containerId;
      }
    }
    // Fallback to store data
    const ch = serverChannels.find((c) => c.id === channelId);
    if (!ch) return null;
    return ch.category_id ?? "uncategorized";
  }

  // Build initial order from store data
  function buildOrderMap(): Record<string, string[]> {
    const order: Record<string, string[]> = {};
    order.uncategorized = uncategorized.map((ch) => ch.id);
    for (const cat of serverCategories) {
      order[cat.id] = (categorized[cat.id] ?? []).map((ch) => ch.id);
    }
    return order;
  }

  // Custom collision detection: when dragging a category, only collide with other categories
  // using pointer Y position instead of closestCenter (which fails for tall containers)
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const activeData = args.active.data.current;
    if (activeData?.type === "category") {
      const catContainers = args.droppableContainers.filter(
        (c) => c.id.toString().startsWith("cat-")
      );
      // Use pointer Y coordinate to find the nearest category
      const pointerY = args.pointerCoordinates?.y;
      if (pointerY != null) {
        let closest: { id: string | number; distance: number } | null = null;
        for (const container of catContainers) {
          const rect = args.droppableRects.get(container.id);
          if (!rect) continue;
          // Distance from pointer to top of container (header area)
          const dist = Math.abs(pointerY - rect.top);
          if (!closest || dist < closest.distance) {
            closest = { id: container.id, distance: dist };
          }
        }
        if (closest) {
          return [{ id: closest.id }];
        }
      }
      return closestCenter({ ...args, droppableContainers: catContainers });
    }
    return closestCenter(args);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    setActiveDragId(id);
    // Initialize local order on drag start
    setLocalOrder(buildOrderMap());
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Only handle channel drags (not category drags)
    const activeData = active.data.current;
    if (activeData?.type === "category") return;

    const activeContainer = findContainer(activeId);
    let overContainer: string | null = null;

    // Determine what we're over
    const overData = over.data.current;
    if (overData?.type === "category-drop") {
      overContainer = overData.categoryId;
    } else {
      overContainer = findContainer(overId);
    }

    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    // Move channel between containers
    setLocalOrder((prev) => {
      const order = prev ? { ...prev } : buildOrderMap();
      const sourceIds = [...(order[activeContainer] ?? [])];
      const destIds = [...(order[overContainer!] ?? [])];

      const sourceIdx = sourceIds.indexOf(activeId);
      if (sourceIdx < 0) return prev;

      // Remove from source
      sourceIds.splice(sourceIdx, 1);

      // Find insert position in dest
      const overIdx = destIds.indexOf(overId);
      if (overIdx >= 0) {
        destIds.splice(overIdx, 0, activeId);
      } else {
        destIds.push(activeId);
      }

      return {
        ...order,
        [activeContainer]: sourceIds,
        [overContainer!]: destIds,
      };
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over) {
      setLocalOrder(null);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;
    const activeData = active.data.current;

    // Handle category reorder
    if (activeData?.type === "category") {
      const catIds = serverCategories.map((c) => `cat-${c.id}`);
      const oldIdx = catIds.indexOf(activeId);
      const newIdx = catIds.indexOf(overId);
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        const newOrder = arrayMove(catIds, oldIdx, newIdx);
        try {
          await api.reorderCategories(serverId, {
            order: newOrder.map((cid, i) => ({
              id: cid.replace("cat-", ""),
              position: i,
            })),
          });
          await loadChannels();
        } catch {
          await loadChannels(); // reset to server state on permission error
        }
      }
      setLocalOrder(null);
      return;
    }

    // Handle channel reorder/move
    const currentOrder = localOrder ?? buildOrderMap();
    const container = findContainer(activeId);

    if (container) {
      const containerIds = [...(currentOrder[container] ?? [])];
      const oldIdx = containerIds.indexOf(activeId);
      const newIdx = containerIds.indexOf(overId);

      // Same container reorder
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        currentOrder[container] = arrayMove(containerIds, oldIdx, newIdx);
      }
    }

    // Persist all channel positions + category assignments
    const allPositions: Array<{ id: string; position: number; category_id: string | null }> = [];
    for (const [containerId, ids] of Object.entries(currentOrder)) {
      ids.forEach((chId, idx) => {
        allPositions.push({
          id: chId,
          position: idx,
          category_id: containerId === "uncategorized" ? null : containerId,
        });
      });
    }

    if (allPositions.length > 0) {
      try {
        await api.reorderChannels(serverId, { order: allPositions });
        await loadChannels();
      } catch {
        await loadChannels(); // reset to server state on permission error
      }
    }

    setLocalOrder(null);
  }

  // ─── Render ─────────────────────────────────────────

  const categoryIds = serverCategories.map((c) => `cat-${c.id}`);
  const uncatChannelIds = getChannelIds("uncategorized");
  const draggedChannel = activeDragId
    ? serverChannels.find((ch) => ch.id === activeDragId)
    : null;
  const draggedCategory = activeDragId?.startsWith("cat-")
    ? serverCategories.find((c) => `cat-${c.id}` === activeDragId)
    : null;

  return (
    <>
      <div className="channel-sidebar-header" onContextMenu={handleServerContextMenu}>
        <button
          ref={headerBtnRef}
          className="server-name-header"
          onClick={() => setShowServerDropdown((v) => !v)}
          title="Server options"
        >
          <span>{serverName}</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={`server-name-chevron${showServerDropdown ? " server-name-chevron-open" : ""}`}>
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
          </svg>
        </button>
        {showServerDropdown && headerBtnRef.current && (
          <ServerDropdownMenu
            anchorRect={headerBtnRef.current.getBoundingClientRect()}
            onInvite={() => setShowInviteModal(true)}
            onSettings={() => setShowSettings(true)}
            onCreateChannel={() => setCreateModal({ categoryId: null })}
            onCreateCategory={() => setShowCreateCategory(true)}
            onLeave={() => setConfirmLeaveServer(true)}
            canCreateInvites={canCreateInvites}
            canManageServer={canManageServer}
            canManageChannels={canManageChannels}
            isOwner={isOwner}
            onClose={() => setShowServerDropdown(false)}
          />
        )}
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {chUnreadAbove && (
          <button
            className="channel-scroll-unread-indicator channel-scroll-unread-above"
            onClick={() => {
              const first = channelListRef.current?.querySelector(".channel-item.unread");
              first?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            aria-label="Unread channels above"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
            New
          </button>
        )}
        {chUnreadBelow && (
          <button
            className="channel-scroll-unread-indicator channel-scroll-unread-below"
            onClick={() => {
              const items = channelListRef.current?.querySelectorAll(".channel-item.unread");
              items?.[items.length - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            aria-label="Unread channels below"
          >
            New
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
          </button>
        )}
      <div className="channel-sidebar-content" ref={channelListRef} onKeyDown={handleChannelRovingKeyDown} onContextMenu={(e) => {
        // Only fire for empty space (not on channels/categories which have their own handlers)
        if (e.defaultPrevented) return;
        handleServerContextMenu(e);
      }}>
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Uncategorized channels */}
          {(uncategorized.length > 0 || serverCategories.length === 0) && (
            <DroppableZone id="uncategorized">
              <div className="channel-category-header">
                <span>Text Channels</span>
                {canManageChannels && (
                  <button
                    className="btn-icon"
                    onClick={() => setCreateModal({ categoryId: null })}
                    title="Create Channel"
                    aria-label="Create Channel"
                  >
                    +
                  </button>
                )}
              </div>

              <SortableContext items={uncatChannelIds} strategy={verticalListSortingStrategy}>
                <ul className="channel-list">
                  {getOrderedChannels("uncategorized").map((ch) => {
                    if (renamingId === ch.id) {
                      return (
                        <li key={ch.id}>
                          <div className="dm-input-row">
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRename(ch.id);
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              autoFocus
                            />
                            <button className="btn-small" onClick={() => handleRename(ch.id)}>Save</button>
                          </div>
                        </li>
                      );
                    }
                    return (
                      <SortableChannelItem key={ch.id} ch={ch} onContextMenu={handleContextMenu} />
                    );
                  })}
                  {uncategorized.length === 0 && serverCategories.length === 0 && (
                    <li className="channel-empty">No channels yet</li>
                  )}
                </ul>
              </SortableContext>
            </DroppableZone>
          )}

          {/* Categories (sortable) */}
          <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
            {serverCategories.map((cat) => {
              const isCollapsed = collapsedCategories.has(cat.id);
              const catChannels = getOrderedChannels(cat.id);
              return (
                <SortableCategorySection
                  key={cat.id}
                  cat={cat}
                  channels={catChannels}
                  canManageChannels={canManageChannels}
                  isCollapsed={isCollapsed}
                  onToggleCollapse={toggleCollapse}
                  onCreateChannel={(catId, catName) => setCreateModal({ categoryId: catId, categoryName: catName })}
                  onCategoryContextMenu={handleCategoryContextMenu}
                  renamingCatId={renamingCatId}
                  renameCatValue={renameCatValue}
                  setRenameCatValue={setRenameCatValue}
                  onRenameCategory={handleRenameCategory}
                  setRenamingCatId={setRenamingCatId}
                  renamingId={renamingId}
                  renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  onRenameChannel={handleRename}
                  setRenamingId={setRenamingId}
                  onChannelContextMenu={handleContextMenu}
                  activeChannelId={currentChannelId}
                />
              );
            })}
          </SortableContext>

          {/* Drag overlay */}
          <DragOverlay>
            {draggedChannel ? (
              <div className="channel-drag-overlay">
                <ChannelItemContent ch={draggedChannel} isOverlay />
              </div>
            ) : draggedCategory ? (
              <div className="channel-drag-overlay category-drag-overlay">
                <span className="category-drag-label">{draggedCategory.name.toUpperCase()}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
      </div>

      {/* Right-click context menu for channels */}
      {contextMenu && (
        <ChannelContextMenu
          channelId={contextMenu.channelId}
          x={contextMenu.x}
          y={contextMenu.y}
          submenu={contextMenu.submenu}
          canManageChannels={canManageChannels}
          onPermissions={() => {
            setEditingChannelId(contextMenu.channelId);
            setContextMenu(null);
          }}
          onDelete={() => {
            setConfirmDeleteChannel(contextMenu.channelId);
            setContextMenu(null);
          }}
          onShowSubmenu={(sub) => setContextMenu({ ...contextMenu, submenu: sub })}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Right-click context menu for categories */}
      {categoryContextMenu && (
        <CategoryContextMenuPopup
          x={categoryContextMenu.x}
          y={categoryContextMenu.y}
          onCreateChannel={() => {
            setCreateModal({ categoryId: categoryContextMenu.categoryId, categoryName: serverCategories.find((c) => c.id === categoryContextMenu.categoryId)?.name });
            setCategoryContextMenu(null);
          }}
          onRenameCategory={() => {
            const cat = serverCategories.find((c) => c.id === categoryContextMenu.categoryId);
            setRenameCatValue(cat?.name ?? "");
            setRenamingCatId(categoryContextMenu.categoryId);
            setCategoryContextMenu(null);
          }}
          onCreateCategory={() => {
            setShowCreateCategory(true);
            setCategoryContextMenu(null);
          }}
          onDeleteCategory={() => {
            setConfirmDeleteCategory(categoryContextMenu.categoryId);
            setCategoryContextMenu(null);
          }}
        />
      )}

      {/* Right-click context menu for server header / empty space */}
      {serverContextMenu && (
        <ServerHeaderContextMenu
          x={serverContextMenu.x}
          y={serverContextMenu.y}
          onCreateChannel={() => {
            setCreateModal({ categoryId: null });
            setServerContextMenu(null);
          }}
          onCreateCategory={() => {
            setShowCreateCategory(true);
            setServerContextMenu(null);
          }}
        />
      )}

      {/* Inline Create Category */}
      {showCreateCategory && (
        <div className="modal-overlay" onClick={() => setShowCreateCategory(false)}>
          <div className="modal-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Create Category</h3>
            <input
              type="text"
              className="modal-input"
              placeholder="Category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateCategory();
                if (e.key === "Escape") setShowCreateCategory(false);
              }}
              autoFocus
            />
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowCreateCategory(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Channel Modal */}
      {createModal && (
        <CreateChannelModal
          serverId={serverId}
          categoryId={createModal.categoryId}
          categoryName={createModal.categoryName}
          onClose={() => setCreateModal(null)}
        />
      )}

      {/* Delete Channel Confirmation */}
      {confirmDeleteChannel && (
        <ConfirmDialog
          title="Delete Channel"
          message="Are you sure you want to delete this channel? All messages will be lost."
          confirmLabel="Delete Channel"
          danger
          onConfirm={() => {
            handleDelete(confirmDeleteChannel);
            setConfirmDeleteChannel(null);
          }}
          onCancel={() => setConfirmDeleteChannel(null)}
        />
      )}

      {/* Delete Category Confirmation */}
      {confirmDeleteCategory && (
        <ConfirmDialog
          title="Delete Category"
          message="Are you sure you want to delete this category? Channels in it will become uncategorized."
          confirmLabel="Delete Category"
          danger
          onConfirm={() => {
            handleDeleteCategory(confirmDeleteCategory);
            setConfirmDeleteCategory(null);
          }}
          onCancel={() => setConfirmDeleteCategory(null)}
        />
      )}

      {showSettings && server && (
        <Suspense fallback={null}>
          <ServerSettings
            serverId={serverId}
            onClose={() => setShowSettings(false)}
          />
        </Suspense>
      )}

      {editingChannelId && (
        <ChannelSettings
          channelId={editingChannelId}
          serverId={serverId}
          onClose={() => setEditingChannelId(null)}
        />
      )}

      {showInviteModal && (
        <InviteToServerModal
          serverId={serverId}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {confirmLeaveServer && (
        <ConfirmDialog
          title="Leave Server"
          message={`Are you sure you want to leave ${serverName}? You won't be able to rejoin unless you receive a new invite.`}
          confirmLabel="Leave Server"
          danger
          onConfirm={() => {
            handleLeaveServer();
            setConfirmLeaveServer(false);
          }}
          onCancel={() => setConfirmLeaveServer(false)}
        />
      )}
    </>
  );
}
