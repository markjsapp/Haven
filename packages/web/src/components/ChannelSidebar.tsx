import { useState, useEffect, useMemo } from "react";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { useUiStore } from "../store/ui.js";
import { usePresenceStore } from "../store/presence.js";
import { useFriendsStore } from "../store/friends.js";
import type { ChannelResponse, CategoryResponse } from "@haven/core";
import {
  parseChannelName,
  parseDmPeerId,
  parseDmDisplayName,
  parseGroupName,
  parseGroupMemberCount,
  parseServerName,
} from "../lib/channel-utils.js";
import CreateGroupDm from "./CreateGroupDm.js";
import CreateChannelModal from "./CreateChannelModal.js";
import ConfirmDialog from "./ConfirmDialog.js";
import UserPanel from "./UserPanel.js";
import ServerSettings from "./ServerSettings.js";
import {
  DndContext,
  useDraggable,
  useDroppable,
  useSensors,
  useSensor,
  PointerSensor,
  type DragEndEvent,
} from "@dnd-kit/core";

export default function ChannelSidebar() {
  const selectedServerId = useUiStore((s) => s.selectedServerId);

  return (
    <aside className="channel-sidebar">
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

  const [showCreateDm, setShowCreateDm] = useState(false);
  const [error, setError] = useState("");
  const [headerSearch, setHeaderSearch] = useState(false);
  const [headerSearchValue, setHeaderSearchValue] = useState("");

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
      <div className="channel-sidebar-content">
        {/* Friends Button */}
        <button
          className={`friends-nav-btn ${showFriends ? "active" : ""}`}
          onClick={() => setShowFriends(true)}
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
          >
            +
          </button>
        </div>

        <ul className="channel-list">
          {dmChannels.map((ch) => {
            if (ch.channel_type === "group") {
              const gName = parseGroupName(ch.encrypted_meta, user?.id ?? "");
              const memberCount = parseGroupMemberCount(ch.encrypted_meta);
              return (
                <li key={ch.id}>
                  <button
                    className={`channel-item dm-item ${ch.id === currentChannelId ? "active" : ""}`}
                    onClick={() => { selectChannel(ch.id); setShowFriends(false); setHeaderSearch(false); setHeaderSearchValue(""); }}
                  >
                    <div className="dm-avatar group-dm-avatar">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                      </svg>
                    </div>
                    <div className="dm-item-text">
                      <span className="dm-item-name">{gName}</span>
                      {memberCount > 0 && (
                        <span className="dm-item-members">{memberCount} Members</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            }
            const peerId = parseDmPeerId(ch.encrypted_meta, user?.id ?? "");
            const peerStatus = peerId ? (presenceStatuses[peerId] ?? "offline") : "offline";
            const isActive = peerStatus !== "offline" && peerStatus !== "invisible";
            return (
              <li key={ch.id}>
                <button
                  className={`channel-item dm-item ${ch.id === currentChannelId ? "active" : ""}`}
                  onClick={() => { selectChannel(ch.id); setShowFriends(false); setHeaderSearch(false); setHeaderSearchValue(""); }}
                >
                  <div className="dm-avatar">
                    {parseDmDisplayName(ch.encrypted_meta, user?.id ?? "").charAt(0).toUpperCase()}
                    <span className={`dm-avatar-status ${isActive ? "online" : "offline"}`} />
                  </div>
                  <span className="dm-item-name">
                    {parseDmDisplayName(ch.encrypted_meta, user?.id ?? "")}
                  </span>
                </button>
              </li>
            );
          })}
          {headerSearchValue && dmChannels.length === 0 && (
            <li>
              <button
                className="channel-item dm-item start-dm-item"
                onClick={() => handleStartDm(headerSearchValue.trim())}
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

// ─── DnD Helpers ─────────────────────────────────────

function DraggableChannel({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} data-dragging={isDragging || undefined}>
      {children}
    </div>
  );
}

function DroppableCategory({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
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
  const serverCategories = useChatStore((s) => s.categories[serverId] ?? []);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const api = useAuthStore((s) => s.api);
  const user = useAuthStore((s) => s.user);

  const [showSettings, setShowSettings] = useState(false);
  const [createModal, setCreateModal] = useState<{ categoryId?: string | null; categoryName?: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);
  const [categoryContextMenu, setCategoryContextMenu] = useState<{ categoryId: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingCatId, setRenamingCatId] = useState<string | null>(null);
  const [renameCatValue, setRenameCatValue] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [confirmDeleteChannel, setConfirmDeleteChannel] = useState<string | null>(null);
  const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<string | null>(null);

  const server = servers.find((s) => s.id === serverId);
  const serverName = server ? parseServerName(server.encrypted_meta) : "Server";
  const serverChannels = channels.filter((ch) => ch.server_id === serverId);
  const isOwner = server?.owner_id === user?.id;

  // Group channels by category
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

    return { uncategorized, categorized };
  }, [serverChannels, serverCategories]);

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
      await api.updateChannel(channelId, { encrypted_meta: btoa(meta) });
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

  function handleContextMenu(e: React.MouseEvent, channelId: string) {
    if (!isOwner) return;
    e.preventDefault();
    setCategoryContextMenu(null);
    setContextMenu({ channelId, x: e.clientX, y: e.clientY });
  }

  function handleCategoryContextMenu(e: React.MouseEvent, categoryId: string) {
    if (!isOwner) return;
    e.preventDefault();
    setContextMenu(null);
    setCategoryContextMenu({ categoryId, x: e.clientX, y: e.clientY });
  }

  // Close context menus on outside click
  useEffect(() => {
    if (!contextMenu && !categoryContextMenu) return;
    const handler = () => { setContextMenu(null); setCategoryContextMenu(null); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu, categoryContextMenu]);

  // Drag & drop sensors and handler
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !isOwner) return;

    const channelId = active.id as string;
    const targetCategoryId = over.id === "uncategorized" ? null : (over.id as string);
    const channel = serverChannels.find((ch) => ch.id === channelId);
    if (!channel) return;

    // Skip if already in that category
    const currentCatId = channel.category_id ?? null;
    if (currentCatId === targetCategoryId) return;

    try {
      await api.setChannelCategory(channelId, { category_id: targetCategoryId });
      await loadChannels();
    } catch { /* non-fatal */ }
  }

  function renderChannelItem(ch: ChannelResponse) {
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
    const isVoice = ch.channel_type === "voice";
    const channelBtn = (
      <button
        className={`channel-item ${ch.id === currentChannelId ? "active" : ""}`}
        onClick={() => selectChannel(ch.id)}
        onContextMenu={(e) => handleContextMenu(e, ch.id)}
      >
        {isVoice ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="channel-type-icon">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        ) : (
          <span className="channel-hash">#</span>
        )}
        {parseChannelName(ch.encrypted_meta)}
      </button>
    );
    return (
      <li key={ch.id}>
        {isOwner ? (
          <DraggableChannel id={ch.id}>{channelBtn}</DraggableChannel>
        ) : (
          channelBtn
        )}
      </li>
    );
  }

  return (
    <>
      <div className="channel-sidebar-header">
        <button
          className="server-name-header"
          onClick={() => setShowSettings(true)}
          title="Server Settings"
        >
          <span>{serverName}</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="server-name-chevron">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
          </svg>
        </button>
      </div>
      <div className="channel-sidebar-content">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {/* Uncategorized channels */}
        {(uncategorized.length > 0 || serverCategories.length === 0) && (
          <DroppableCategory id="uncategorized">
            <div className="channel-category-header">
              <span>Text Channels</span>
              {isOwner && (
                <button
                  className="btn-icon"
                  onClick={() => setCreateModal({ categoryId: null })}
                  title="Create Channel"
                >
                  +
                </button>
              )}
            </div>

            <ul className="channel-list">
              {uncategorized.map(renderChannelItem)}
              {uncategorized.length === 0 && serverCategories.length === 0 && (
                <li className="channel-empty">No channels yet</li>
              )}
            </ul>
          </DroppableCategory>
        )}

        {/* Categorized channels */}
        {serverCategories.map((cat) => {
          const isCollapsed = collapsedCategories.has(cat.id);
          const catChannels = categorized[cat.id] ?? [];
          return (
            <DroppableCategory key={cat.id} id={cat.id}>
              <div
                className="channel-category-header"
                onContextMenu={(e) => handleCategoryContextMenu(e, cat.id)}
              >
                {renamingCatId === cat.id ? (
                  <div className="dm-input-row" style={{ flex: 1 }}>
                    <input
                      type="text"
                      value={renameCatValue}
                      onChange={(e) => setRenameCatValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameCategory(cat.id);
                        if (e.key === "Escape") setRenamingCatId(null);
                      }}
                      autoFocus
                    />
                    <button className="btn-small" onClick={() => handleRenameCategory(cat.id)}>Save</button>
                  </div>
                ) : (
                  <>
                    <button
                      className="category-collapse-btn"
                      onClick={() => toggleCollapse(cat.id)}
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
                    {isOwner && (
                      <button
                        className="btn-icon"
                        onClick={() => setCreateModal({ categoryId: cat.id, categoryName: cat.name })}
                        title={`Create Channel in ${cat.name}`}
                      >
                        +
                      </button>
                    )}
                  </>
                )}
              </div>

              {!isCollapsed && (
                <ul className="channel-list">
                  {catChannels.map(renderChannelItem)}
                </ul>
              )}
            </DroppableCategory>
          );
        })}
        </DndContext>
      </div>

      {/* Right-click context menu for channels */}
      {contextMenu && (
        <div
          className="channel-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={() => {
              const ch = channels.find((c) => c.id === contextMenu.channelId);
              setRenameValue(ch ? parseChannelName(ch.encrypted_meta) : "");
              setRenamingId(contextMenu.channelId);
              setContextMenu(null);
            }}
          >
            Rename Channel
          </button>
          <button
            className="danger"
            onClick={() => {
              setConfirmDeleteChannel(contextMenu.channelId);
              setContextMenu(null);
            }}
          >
            Delete Channel
          </button>
        </div>
      )}

      {/* Right-click context menu for categories */}
      {categoryContextMenu && (
        <div
          className="channel-context-menu"
          style={{ top: categoryContextMenu.y, left: categoryContextMenu.x }}
        >
          <button
            onClick={() => {
              const cat = serverCategories.find((c) => c.id === categoryContextMenu.categoryId);
              setRenameCatValue(cat?.name ?? "");
              setRenamingCatId(categoryContextMenu.categoryId);
              setCategoryContextMenu(null);
            }}
          >
            Rename Category
          </button>
          <button
            className="danger"
            onClick={() => {
              setConfirmDeleteCategory(categoryContextMenu.categoryId);
              setCategoryContextMenu(null);
            }}
          >
            Delete Category
          </button>
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
        <ServerSettings
          serverId={serverId}
          isOwner={isOwner}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
