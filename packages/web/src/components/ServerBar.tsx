import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { useUiStore } from "../store/ui.js";
import { useFriendsStore } from "../store/friends.js";
import { parseServerName } from "../lib/channel-utils.js";
import { unicodeBtoa } from "../lib/base64.js";
import { useMenuKeyboard } from "../hooks/useMenuKeyboard.js";
import { useRovingTabindex } from "../hooks/useRovingTabindex.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
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
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** Small wrapper that calls useFocusTrap on its child div */
function FocusTrapDiv({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return <div ref={ref} {...props}>{children}</div>;
}

const SERVER_ORDER_KEY = "haven:server-order";
const SERVER_FOLDERS_KEY = "haven:server-folders";

interface ServerFolder {
  id: string;
  name: string;
  color: string;
  serverIds: string[];
}

function loadServerOrder(): string[] {
  try {
    const raw = localStorage.getItem(SERVER_ORDER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveServerOrder(order: string[]) {
  localStorage.setItem(SERVER_ORDER_KEY, JSON.stringify(order));
}

function loadFolders(): ServerFolder[] {
  try {
    const raw = localStorage.getItem(SERVER_FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFolders(folders: ServerFolder[]) {
  localStorage.setItem(SERVER_FOLDERS_KEY, JSON.stringify(folders));
}

const FOLDER_COLORS = [
  "#5865F2", "#57F287", "#FEE75C", "#EB459E", "#ED4245",
  "#FF8C00", "#9B59B6", "#1ABC9C", "#E91E63", "#607D8B",
];

const COLOR_NAMES: Record<string, string> = {
  "#5865F2": "Blurple", "#57F287": "Green", "#FEE75C": "Yellow",
  "#EB459E": "Pink", "#ED4245": "Red", "#FF8C00": "Orange",
  "#9B59B6": "Purple", "#1ABC9C": "Teal", "#E91E63": "Rose",
  "#607D8B": "Grey",
};

export default function ServerBar() {
  const { t } = useTranslation();
  const servers = useChatStore((s) => s.servers);
  const channels = useChatStore((s) => s.channels);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const selectedServerId = useUiStore((s) => s.selectedServerId);
  const selectServer = useUiStore((s) => s.selectServer);
  const api = useAuthStore((s) => s.api);
  const user = useAuthStore((s) => s.user);

  // ─── Server ordering (localStorage) ──────────────
  const [serverOrder, setServerOrder] = useState<string[]>(loadServerOrder);
  const [folders, setFolders] = useState<ServerFolder[]>(loadFolders);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [editingFolder, setEditingFolder] = useState<{ id: string; name: string; color: string } | null>(null);
  const [folderCtxMenu, setFolderCtxMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);

  // Sorted servers: respect custom order, append any new servers at the end
  const sortedServers = useMemo(() => {
    const orderMap = new Map(serverOrder.map((id, i) => [id, i]));
    const sorted = [...servers].sort((a, b) => {
      const ai = orderMap.get(a.id);
      const bi = orderMap.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return 0;
    });
    return sorted;
  }, [servers, serverOrder]);

  // Sync order when servers change (remove stale, keep order for existing)
  useEffect(() => {
    const serverIds = new Set(servers.map((s) => s.id));
    const cleaned = serverOrder.filter((id) => serverIds.has(id));
    // Add new servers not yet in order
    for (const s of servers) {
      if (!cleaned.includes(s.id)) cleaned.push(s.id);
    }
    if (JSON.stringify(cleaned) !== JSON.stringify(serverOrder)) {
      setServerOrder(cleaned);
      saveServerOrder(cleaned);
    }
    // Clean stale server IDs from folders
    let foldersChanged = false;
    const cleanedFolders = folders.map((f) => {
      const validIds = f.serverIds.filter((id) => serverIds.has(id));
      if (validIds.length !== f.serverIds.length) { foldersChanged = true; return { ...f, serverIds: validIds }; }
      return f;
    }).filter((f) => f.serverIds.length > 0);
    if (foldersChanged || cleanedFolders.length !== folders.length) {
      setFolders(cleanedFolders);
      saveFolders(cleanedFolders);
    }
  }, [servers]);

  // Which servers are in folders (for filtering the top-level list)
  const folderedServerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of folders) for (const id of f.serverIds) ids.add(id);
    return ids;
  }, [folders]);

  // Servers NOT in any folder
  const topLevelServers = useMemo(
    () => sortedServers.filter((s) => !folderedServerIds.has(s.id)),
    [sortedServers, folderedServerIds]
  );

  // Interleaved display order: folders appear at the position of their first server
  const displayItems = useMemo(() => {
    const items: string[] = [];
    const seenFolders = new Set<string>();
    for (const serverId of serverOrder) {
      const folder = folders.find((f) => f.serverIds.includes(serverId));
      if (folder) {
        if (!seenFolders.has(folder.id)) {
          seenFolders.add(folder.id);
          items.push(`folder:${folder.id}`);
        }
      } else {
        items.push(serverId);
      }
    }
    for (const f of folders) {
      if (!seenFolders.has(f.id)) items.push(`folder:${f.id}`);
    }
    return items;
  }, [serverOrder, folders]);

  function createFolder(serverId: string) {
    const srv = servers.find((s) => s.id === serverId);
    const name = srv ? parseServerName(srv.encrypted_meta) : "Folder";
    const newFolder: ServerFolder = {
      id: crypto.randomUUID(),
      name,
      color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length],
      serverIds: [serverId],
    };
    const updated = [...folders, newFolder];
    setFolders(updated);
    saveFolders(updated);
    setExpandedFolders((prev) => new Set(prev).add(newFolder.id));
  }

  function addToFolder(folderId: string, serverId: string) {
    const updated = folders.map((f) =>
      f.id === folderId && !f.serverIds.includes(serverId)
        ? { ...f, serverIds: [...f.serverIds, serverId] }
        : f
    );
    setFolders(updated);
    saveFolders(updated);
  }

  function removeFromFolder(folderId: string, serverId: string) {
    const updated = folders
      .map((f) => f.id === folderId ? { ...f, serverIds: f.serverIds.filter((id) => id !== serverId) } : f)
      .filter((f) => f.serverIds.length > 0);
    setFolders(updated);
    saveFolders(updated);
  }

  function deleteFolder(folderId: string) {
    const updated = folders.filter((f) => f.id !== folderId);
    setFolders(updated);
    saveFolders(updated);
  }

  function updateFolder(folderId: string, patch: Partial<Pick<ServerFolder, "name" | "color">>) {
    const updated = folders.map((f) => f.id === folderId ? { ...f, ...patch } : f);
    setFolders(updated);
    saveFolders(updated);
  }

  function toggleFolder(folderId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);

  function handleServerDragStart(event: DragStartEvent) {
    setDragActiveId(event.active.id as string);
  }

  function findServerFolder(serverId: string): ServerFolder | undefined {
    return folders.find((f) => f.serverIds.includes(serverId));
  }

  function rebuildServerOrderFromDisplay(newDisplay: string[]) {
    const newOrder: string[] = [];
    for (const item of newDisplay) {
      if (item.startsWith("folder:")) {
        const fId = item.replace("folder:", "");
        const f = folders.find((ff) => ff.id === fId);
        if (f) newOrder.push(...f.serverIds);
      } else {
        newOrder.push(item);
      }
    }
    setServerOrder(newOrder);
    saveServerOrder(newOrder);
  }

  function handleServerDragEnd(event: DragEndEvent) {
    setDragActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    let overId = over.id as string;
    const isActiveFolder = activeId.startsWith("folder:");

    // Normalize folder-drop zone IDs → folder:xxx
    if (overId.startsWith("folder-drop-")) {
      overId = `folder:${overId.replace("folder-drop-", "")}`;
    }
    const isOverFolder = overId.startsWith("folder:");

    // CASE A: Dragging a folder → reorder in display list
    if (isActiveFolder) {
      const oldIdx = displayItems.indexOf(activeId);
      const newIdx = displayItems.indexOf(overId);
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        rebuildServerOrderFromDisplay(arrayMove(displayItems, oldIdx, newIdx));
      }
      return;
    }

    // CASE B: Dragging a server onto a folder → add to folder
    if (isOverFolder) {
      const folderId = overId.replace("folder:", "");
      const folder = folders.find((f) => f.id === folderId);
      if (folder && !folder.serverIds.includes(activeId)) {
        const sourceFolder = findServerFolder(activeId);
        if (sourceFolder) removeFromFolder(sourceFolder.id, activeId);
        addToFolder(folderId, activeId);
      }
      return;
    }

    // CASE C: Both are servers
    const activeFolder = findServerFolder(activeId);
    const overFolder = findServerFolder(overId);

    // C1: Same folder → reorder within
    if (activeFolder && overFolder && activeFolder.id === overFolder.id) {
      const ids = activeFolder.serverIds;
      const oldIdx = ids.indexOf(activeId);
      const newIdx = ids.indexOf(overId);
      if (oldIdx !== -1 && newIdx !== -1) {
        const updated = folders.map((f) =>
          f.id === activeFolder.id ? { ...f, serverIds: arrayMove(ids, oldIdx, newIdx) } : f
        );
        setFolders(updated);
        saveFolders(updated);
      }
      return;
    }

    // C2: From folder to top-level
    if (activeFolder && !overFolder) {
      removeFromFolder(activeFolder.id, activeId);
      const newOrder = serverOrder.filter((id) => id !== activeId);
      const overIdx = newOrder.indexOf(overId);
      if (overIdx !== -1) newOrder.splice(overIdx, 0, activeId);
      else newOrder.push(activeId);
      setServerOrder(newOrder);
      saveServerOrder(newOrder);
      return;
    }

    // C3: Top-level onto server inside a folder → add to that folder
    if (!activeFolder && overFolder) {
      addToFolder(overFolder.id, activeId);
      return;
    }

    // C4: Both top-level → reorder in display list
    const oldIdx = displayItems.indexOf(activeId);
    const newIdx = displayItems.indexOf(overId);
    if (oldIdx !== -1 && newIdx !== -1) {
      rebuildServerOrderFromDisplay(arrayMove(displayItems, oldIdx, newIdx));
    }
  }

  // Compute per-server unread totals
  const serverUnreads = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const ch of channels) {
      if (ch.server_id && unreadCounts[ch.id]) {
        totals[ch.server_id] = (totals[ch.server_id] ?? 0) + unreadCounts[ch.id];
      }
    }
    return totals;
  }, [channels, unreadCounts]);

  // Compute DM unread total (channels with no server_id)
  const dmUnread = useMemo(() => {
    let total = 0;
    for (const ch of channels) {
      if (!ch.server_id && unreadCounts[ch.id]) {
        total += unreadCounts[ch.id];
      }
    }
    return total;
  }, [channels, unreadCounts]);

  // Count incoming friend requests for notification badge
  const friends = useFriendsStore((s) => s.friends);
  const incomingFriendRequests = useMemo(
    () => friends.filter((f) => f.status === "pending" && f.is_incoming).length,
    [friends],
  );

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [serverName, setServerName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const serverListRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown: handleRovingKeyDown } = useRovingTabindex(serverListRef);
  const serverItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [unreadAbove, setUnreadAbove] = useState(false);
  const [unreadBelow, setUnreadBelow] = useState(false);

  const checkScrollIndicators = useCallback(() => {
    const container = serverListRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    let above = false;
    let below = false;
    for (const [srvId, el] of serverItemRefs.current) {
      if ((serverUnreads[srvId] ?? 0) === 0) continue;
      const elRect = el.getBoundingClientRect();
      if (elRect.bottom < rect.top + 4) above = true;
      if (elRect.top > rect.bottom - 4) below = true;
    }
    // Also check DM unread (home button is the first child)
    setUnreadAbove(above);
    setUnreadBelow(below);
  }, [serverUnreads]);

  useEffect(() => {
    checkScrollIndicators();
  }, [serverUnreads, servers, checkScrollIndicators]);

  useEffect(() => {
    const container = serverListRef.current;
    if (!container) return;
    container.addEventListener("scroll", checkScrollIndicators, { passive: true });
    return () => container.removeEventListener("scroll", checkScrollIndicators);
  }, [checkScrollIndicators]);

  // ─── Server Context Menu ────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; serverId: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "leave" | "delete"; serverId: string; serverName: string; isOwnerSoleMember?: boolean } | null>(null);

  useEffect(() => {
    if (!ctxMenu && !folderCtxMenu) return;
    const handler = () => { setCtxMenu(null); setFolderCtxMenu(null); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [ctxMenu, folderCtxMenu]);

  function handleServerContextMenu(e: React.MouseEvent, serverId: string) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, serverId });
  }

  async function handleLeaveServer(serverId: string) {
    try {
      await api.leaveServer(serverId);
      selectServer(null);
      await loadChannels();
    } catch (err: any) {
      console.error("Failed to leave server:", err);
    }
    setConfirmAction(null);
  }

  async function handleDeleteServer(serverId: string) {
    try {
      await api.deleteServer(serverId);
      selectServer(null);
      await loadChannels();
    } catch (err: any) {
      console.error("Failed to delete server:", err);
    }
    setConfirmAction(null);
  }

  async function handleCreate() {
    if (!serverName.trim()) return;
    setError("");
    try {
      const meta = JSON.stringify({ name: serverName.trim() });
      const newServer = await api.createServer({ encrypted_meta: unicodeBtoa(meta) });
      // Upload icon if one was selected
      if (iconFile) {
        try {
          const buf = await iconFile.arrayBuffer();
          await api.uploadServerIcon(newServer.id, buf);
        } catch {
          // Icon upload failure is non-fatal — server was created
        }
      }
      await loadChannels();
      selectServer(newServer.id);
      setServerName("");
      if (iconPreview) URL.revokeObjectURL(iconPreview);
      setIconFile(null);
      setIconPreview(null);
      setShowCreate(false);
    } catch (err: any) {
      setError(err.message || "Failed");
    }
  }

  // Escape key handler for all inline modals
  useEffect(() => {
    function handleEscapeKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (editingFolder) { setEditingFolder(null); e.stopPropagation(); }
      else if (confirmAction) { setConfirmAction(null); e.stopPropagation(); }
      else if (showCreate) { setShowCreate(false); if (iconPreview) URL.revokeObjectURL(iconPreview); setIconFile(null); setIconPreview(null); e.stopPropagation(); }
      else if (showJoin) { setShowJoin(false); e.stopPropagation(); }
    }
    const anyOpen = !!editingFolder || !!confirmAction || showCreate || showJoin;
    if (!anyOpen) return;
    document.addEventListener("keydown", handleEscapeKey);
    return () => document.removeEventListener("keydown", handleEscapeKey);
  }, [editingFolder, confirmAction, showCreate, showJoin, iconPreview]);

  async function handleJoin() {
    if (!inviteCode.trim()) return;
    setError("");
    try {
      await api.joinByInvite(inviteCode.trim());
      await loadChannels();
      setInviteCode("");
      setShowJoin(false);
    } catch (err: any) {
      setError(err.message || "Invalid code");
    }
  }

  return (
    <>
    <nav className="server-bar">
      <div className="server-bar-inner" ref={serverListRef} onKeyDown={handleRovingKeyDown}>
        {/* Home / DM button */}
        <div className={`server-icon-wrapper ${selectedServerId === null ? "active" : ""}`}>
          <span className="server-pill" />
          <button
            className={`server-icon home-icon ${selectedServerId === null ? "active" : ""}`}
            onClick={() => selectServer(null)}
            title={t("serverBar.directMessages")}
            aria-label={t("serverBar.directMessages")}
            data-roving-item
            tabIndex={selectedServerId === null ? 0 : -1}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
              <path d="M7 9h10v2H7zm0-3h10v2H7z" />
            </svg>
            {(dmUnread > 0 || incomingFriendRequests > 0) && <span className="server-unread-dot" />}
          </button>
        </div>

        <div className="server-bar-divider" />

        {/* Server list (sortable) — includes folders */}
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragStart={handleServerDragStart}
          onDragEnd={handleServerDragEnd}
        >
          <SortableContext items={displayItems} strategy={verticalListSortingStrategy}>
            {displayItems.map((item) => {
              if (item.startsWith("folder:")) {
                const folderId = item.replace("folder:", "");
                const folder = folders.find((f) => f.id === folderId);
                if (!folder) return null;
                const isExpanded = expandedFolders.has(folder.id);
                const folderServers = folder.serverIds
                  .map((id) => servers.find((s) => s.id === id))
                  .filter(Boolean) as typeof servers;
                const folderUnread = folderServers.reduce((sum, s) => sum + (serverUnreads[s.id] ?? 0), 0);
                const hasActive = folderServers.some((s) => s.id === selectedServerId);
                return (
                  <SortableFolderIcon
                    key={item}
                    id={item}
                    folderId={folder.id}
                    folder={folder}
                    isExpanded={isExpanded}
                    hasActive={hasActive}
                    folderUnread={folderUnread}
                    onToggle={() => toggleFolder(folder.id)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setFolderCtxMenu({ x: e.clientX, y: e.clientY, folderId: folder.id }); }}
                  >
                    {isExpanded && (
                      <SortableContext items={folder.serverIds} strategy={verticalListSortingStrategy}>
                        {folderServers.map((srv) => {
                          const name = parseServerName(srv.encrypted_meta);
                          const isActive = selectedServerId === srv.id;
                          const srvUnread = serverUnreads[srv.id] ?? 0;
                          return (
                            <SortableServerIcon
                              key={srv.id}
                              id={srv.id}
                              name={name}
                              iconUrl={srv.icon_url}
                              isActive={isActive}
                              unread={srvUnread}
                              onSelect={() => selectServer(srv.id)}
                              onContextMenu={(e) => handleServerContextMenu(e, srv.id)}
                              innerRef={(el) => { if (el) serverItemRefs.current.set(srv.id, el); else serverItemRefs.current.delete(srv.id); }}
                            />
                          );
                        })}
                      </SortableContext>
                    )}
                  </SortableFolderIcon>
                );
              }
              const srv = servers.find((s) => s.id === item);
              if (!srv) return null;
              const name = parseServerName(srv.encrypted_meta);
              const isActive = selectedServerId === srv.id;
              const srvUnread = serverUnreads[srv.id] ?? 0;
              return (
                <SortableServerIcon
                  key={srv.id}
                  id={srv.id}
                  name={name}
                  iconUrl={srv.icon_url}
                  isActive={isActive}
                  unread={srvUnread}
                  onSelect={() => selectServer(srv.id)}
                  onContextMenu={(e) => handleServerContextMenu(e, srv.id)}
                  innerRef={(el) => { if (el) serverItemRefs.current.set(srv.id, el); else serverItemRefs.current.delete(srv.id); }}
                />
              );
            })}
          </SortableContext>

          <DragOverlay>
            {dragActiveId ? (() => {
              if (dragActiveId.startsWith("folder:")) {
                const folderId = dragActiveId.replace("folder:", "");
                const folder = folders.find((f) => f.id === folderId);
                if (!folder) return null;
                return (
                  <div className="server-icon-wrapper server-drag-overlay">
                    <div className="server-folder-icon" style={{ borderColor: folder.color }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill={folder.color} aria-hidden="true">
                        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                      </svg>
                    </div>
                  </div>
                );
              }
              const srv = servers.find((s) => s.id === dragActiveId);
              if (!srv) return null;
              const name = parseServerName(srv.encrypted_meta);
              return (
                <div className="server-icon-wrapper server-drag-overlay">
                  <div className="server-icon">
                    {srv.icon_url ? (
                      <img src={srv.icon_url} alt={name} className="server-icon-img" />
                    ) : (
                      name.charAt(0).toUpperCase()
                    )}
                  </div>
                </div>
              );
            })() : null}
          </DragOverlay>
        </DndContext>

        <div className="server-bar-divider" />

        {/* Add server */}
        <div className="server-icon-wrapper">
          <button
            className={`server-icon add-server-icon ${showCreate ? "active" : ""}`}
            onClick={() => { setShowCreate(!showCreate); setShowJoin(false); setError(""); }}
            title={t("serverBar.addServer")}
            aria-label={t("serverBar.addServer")}
            data-roving-item
            tabIndex={-1}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M13 5h-2v6H5v2h6v6h2v-6h6v-2h-6V5z" />
            </svg>
          </button>
        </div>

        {/* Join server */}
        <div className="server-icon-wrapper">
          <button
            className={`server-icon join-server-icon ${showJoin ? "active" : ""}`}
            onClick={() => { setShowJoin(!showJoin); setShowCreate(false); setError(""); }}
            title={t("serverBar.joinServer")}
            aria-label={t("serverBar.joinServer")}
            data-roving-item
            tabIndex={-1}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6-6-6z" />
            </svg>
          </button>
        </div>
      </div>

      {unreadAbove && (
        <button
          className="scroll-unread-indicator scroll-unread-above"
          onClick={() => {
            for (const srv of servers) {
              if ((serverUnreads[srv.id] ?? 0) > 0) {
                serverItemRefs.current.get(srv.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
                break;
              }
            }
          }}
          aria-label={t("serverBar.unreadAboveAriaLabel")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
        </button>
      )}
      {unreadBelow && (
        <button
          className="scroll-unread-indicator scroll-unread-below"
          onClick={() => {
            for (let i = servers.length - 1; i >= 0; i--) {
              if ((serverUnreads[servers[i].id] ?? 0) > 0) {
                serverItemRefs.current.get(servers[i].id)?.scrollIntoView({ behavior: "smooth", block: "center" });
                break;
              }
            }
          }}
          aria-label={t("serverBar.unreadBelowAriaLabel")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
        </button>
      )}
    </nav>

      {/* Server context menu */}
      {ctxMenu && (() => {
        const srv = servers.find((s) => s.id === ctxMenu.serverId);
        if (!srv) return null;
        const name = parseServerName(srv.encrypted_meta);
        const isOwner = user?.id === srv.owner_id;
        const currentFolder = folders.find((f) => f.serverIds.includes(srv.id));
        return (
          <ServerBarContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            serverId={srv.id}
            isOwner={isOwner}
            folders={folders}
            currentFolderId={currentFolder?.id ?? null}
            onClose={() => setCtxMenu(null)}
            onLeave={() => {
              setCtxMenu(null);
              setConfirmAction({
                type: "leave",
                serverId: srv.id,
                serverName: name,
              });
            }}
            onDelete={() => {
              setCtxMenu(null);
              setConfirmAction({
                type: "delete",
                serverId: srv.id,
                serverName: name,
              });
            }}
            onCreateFolder={() => { setCtxMenu(null); createFolder(srv.id); }}
            onAddToFolder={(folderId) => { setCtxMenu(null); addToFolder(folderId, srv.id); }}
            onRemoveFromFolder={() => { if (currentFolder) { setCtxMenu(null); removeFromFolder(currentFolder.id, srv.id); } }}
          />
        );
      })()}

      {/* Folder context menu */}
      {folderCtxMenu && (() => {
        const folder = folders.find((f) => f.id === folderCtxMenu.folderId);
        if (!folder) return null;
        return (
          <FolderContextMenu
            x={folderCtxMenu.x}
            y={folderCtxMenu.y}
            folder={folder}
            onEdit={() => { setFolderCtxMenu(null); setEditingFolder({ id: folder.id, name: folder.name, color: folder.color }); }}
            onDelete={() => { setFolderCtxMenu(null); deleteFolder(folder.id); }}
          />
        );
      })()}

      {/* Edit folder modal */}
      {editingFolder && (
        <div className="modal-overlay" onClick={() => setEditingFolder(null)} role="presentation">
          <FocusTrapDiv className="modal-dialog" onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="edit-folder-title">
            <h2 className="modal-title" id="edit-folder-title">{t("serverBar.editFolder.title")}</h2>
            <label className="modal-label" htmlFor="folder-name-input">{t("serverBar.editFolder.folderNameLabel")}</label>
            <input
              id="folder-name-input"
              className="modal-input"
              type="text"
              value={editingFolder.name}
              onChange={(e) => setEditingFolder({ ...editingFolder, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  updateFolder(editingFolder.id, { name: editingFolder.name.trim() || "Folder", color: editingFolder.color });
                  setEditingFolder(null);
                }
              }}
              autoFocus
              maxLength={32}
            />
            <fieldset className="modal-fieldset" style={{ marginTop: 12 }}>
            <legend className="modal-label">{t("serverBar.editFolder.colorLabel")}</legend>
            <div className="folder-color-picker">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  className={`folder-color-swatch ${editingFolder.color === c ? "active" : ""}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setEditingFolder({ ...editingFolder, color: c })}
                  aria-label={COLOR_NAMES[c] ?? c}
                  aria-pressed={editingFolder.color === c}
                />
              ))}
            </div>
            </fieldset>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setEditingFolder(null)}>{t("serverBar.editFolder.cancel")}</button>
              <button
                className="btn-primary modal-submit"
                onClick={() => {
                  updateFolder(editingFolder.id, { name: editingFolder.name.trim() || "Folder", color: editingFolder.color });
                  setEditingFolder(null);
                }}
              >
                {t("serverBar.editFolder.save")}
              </button>
            </div>
          </FocusTrapDiv>
        </div>
      )}

      {/* Confirm leave/delete dialog */}
      {confirmAction && (
        <div className="modal-overlay" onClick={() => setConfirmAction(null)} role="presentation">
          <FocusTrapDiv className="modal-dialog" onClick={(e: React.MouseEvent) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="server-confirm-title">
            <h2 className="modal-title" id="server-confirm-title">
              {confirmAction.type === "delete" ? t("serverBar.confirmDelete.title") : t("serverBar.confirmLeave.title")}
            </h2>
            <p className="modal-subtitle">
              {confirmAction.type === "delete"
                ? t("serverBar.confirmDelete.message", { serverName: confirmAction.serverName })
                : t("serverBar.confirmLeave.message", { serverName: confirmAction.serverName })}
            </p>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setConfirmAction(null)}>
                {t("serverBar.confirmLeave.cancel")}
              </button>
              <button
                className="btn-danger"
                onClick={() =>
                  confirmAction.type === "delete"
                    ? handleDeleteServer(confirmAction.serverId)
                    : handleLeaveServer(confirmAction.serverId)
                }
              >
                {confirmAction.type === "delete" ? t("serverBar.confirmDelete.deleteServerBtn") : t("serverBar.confirmLeave.leaveServerBtn")}
              </button>
            </div>
          </FocusTrapDiv>
        </div>
      )}

      {/* Create server modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => { setShowCreate(false); if (iconPreview) URL.revokeObjectURL(iconPreview); setIconFile(null); setIconPreview(null); }} role="presentation">
          <FocusTrapDiv className="modal-dialog" onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="create-server-title">
            <h2 className="modal-title" id="create-server-title">{t("serverBar.createServer.title")}</h2>
            <p className="modal-subtitle">{t("serverBar.createServer.subtitle")}</p>
            <input
              ref={iconInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (iconInputRef.current) iconInputRef.current.value = "";
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) { setError(t("serverBar.createServer.iconTooLarge")); return; }
                if (iconPreview) URL.revokeObjectURL(iconPreview);
                setIconFile(file);
                setIconPreview(URL.createObjectURL(file));
                setError("");
              }}
            />
            <div className="create-server-icon-wrap" onClick={() => iconInputRef.current?.click()} role="button" tabIndex={0} aria-label={t("serverBar.createServer.uploadAriaLabel")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); iconInputRef.current?.click(); } }}>
              {iconPreview ? (
                <img src={iconPreview} alt={t("serverBar.createServer.serverIconPreviewAlt")} className="create-server-icon-preview" />
              ) : (
                <div className="create-server-icon-placeholder">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
                  <span>{t("serverBar.createServer.upload")}</span>
                </div>
              )}
            </div>
            <label className="modal-label" htmlFor="server-name-input">{t("serverBar.createServer.serverNameLabel")}</label>
            <input
              id="server-name-input"
              className="modal-input"
              type="text"
              placeholder={t("serverBar.createServer.serverNamePlaceholder")}
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            {error && <span className="modal-error" role="alert">{error}</span>}
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => { setShowCreate(false); if (iconPreview) URL.revokeObjectURL(iconPreview); setIconFile(null); setIconPreview(null); }}>{t("serverBar.createServer.cancel")}</button>
              <button className="btn-primary modal-submit" onClick={handleCreate}>{t("serverBar.createServer.create")}</button>
            </div>
          </FocusTrapDiv>
        </div>
      )}

      {/* Join server modal */}
      {showJoin && (
        <div className="modal-overlay" onClick={() => setShowJoin(false)} role="presentation">
          <FocusTrapDiv className="modal-dialog" onClick={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="join-server-title">
            <h2 className="modal-title" id="join-server-title">{t("serverBar.joinServer.title")}</h2>
            <p className="modal-subtitle">{t("serverBar.joinServer.subtitle")}</p>
            <label className="modal-label" htmlFor="invite-code-input">{t("serverBar.joinServer.inviteCodeLabel")}</label>
            <input
              id="invite-code-input"
              className="modal-input"
              type="text"
              placeholder={t("serverBar.joinServer.inviteCodePlaceholder")}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              autoFocus
            />
            {error && <span className="modal-error" role="alert">{error}</span>}
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setShowJoin(false)}>{t("serverBar.joinServer.cancel")}</button>
              <button className="btn-primary modal-submit" onClick={handleJoin}>{t("serverBar.joinServer.join")}</button>
            </div>
          </FocusTrapDiv>
        </div>
      )}
    </>
  );
}

function SortableServerIcon({
  id,
  name,
  iconUrl,
  isActive,
  unread,
  onSelect,
  onContextMenu,
  innerRef,
}: {
  id: string;
  name: string;
  iconUrl?: string | null;
  isActive: boolean;
  unread: number;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  innerRef: (el: HTMLDivElement | null) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <div
      ref={(el) => { setNodeRef(el); innerRef(el); }}
      style={style}
      className={`server-icon-wrapper ${isActive ? "active" : ""}`}
      {...attributes}
      {...listeners}
    >
      <span className="server-pill" />
      <button
        className={`server-icon ${isActive ? "active" : ""}`}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        title={name}
        aria-label={name}
        data-roving-item
        tabIndex={isActive ? 0 : -1}
      >
        {iconUrl ? (
          <img src={iconUrl} alt={name} className="server-icon-img" />
        ) : (
          name.charAt(0).toUpperCase()
        )}
        {unread > 0 && <span className="server-unread-badge">{unread}</span>}
      </button>
    </div>
  );
}

const SERVER_NOTIFICATION_OPTIONS: { key: string; value: "default" | "all" | "mentions" | "nothing"; descKey?: string }[] = [
  { key: "useDefault", value: "default", descKey: "onlyMentions" },
  { key: "allMessages", value: "all" },
  { key: "onlyMentions", value: "mentions" },
  { key: "nothing", value: "nothing" },
];

function ServerBarContextMenu({
  x,
  y,
  serverId,
  isOwner,
  folders,
  currentFolderId,
  onLeave,
  onDelete,
  onCreateFolder,
  onAddToFolder,
  onRemoveFromFolder,
  onClose,
}: {
  x: number;
  y: number;
  serverId: string;
  isOwner: boolean;
  folders: ServerFolder[];
  currentFolderId: string | null;
  onLeave: () => void;
  onDelete: () => void;
  onCreateFolder: () => void;
  onAddToFolder: (folderId: string) => void;
  onRemoveFromFolder: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useMenuKeyboard(menuRef);
  const [submenu, setSubmenu] = useState<"notify" | undefined>(undefined);
  const serverNotifications = useUiStore((s) => s.serverNotifications);
  const setServerNotification = useUiStore((s) => s.setServerNotification);
  const currentNotify = serverNotifications[serverId] ?? "default";
  const notifyLabel = t(`serverBar.contextMenu.notification.${SERVER_NOTIFICATION_OPTIONS.find((o) => o.value === currentNotify)?.key ?? "useDefault"}`);

  return (
    <div
      ref={menuRef}
      className="channel-context-menu"
      style={{ top: y, left: x }}
      role="menu"
      aria-label={t("serverBar.contextMenu.ariaLabel")}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Notification Settings */}
      <div
        className="context-submenu-trigger"
        onMouseEnter={() => setSubmenu("notify")}
      >
        <button role="menuitem" tabIndex={-1} onClick={(e) => {
          e.stopPropagation();
          setSubmenu(submenu === "notify" ? undefined : "notify");
        }}>
          <span className="context-btn-with-sub">
            <span>{t("serverBar.contextMenu.notificationSettings")}</span>
            <span className="context-sub-label">{notifyLabel}</span>
          </span>
          <span className="context-submenu-arrow">&rsaquo;</span>
        </button>
        {submenu === "notify" && (
          <div className="context-submenu" onMouseLeave={() => setSubmenu(undefined)}>
            {SERVER_NOTIFICATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={currentNotify === opt.value ? "active" : ""}
                onClick={() => {
                  setServerNotification(serverId, opt.value);
                  onClose();
                }}
              >
                <span className="context-btn-with-sub">
                  <span>{t(`serverBar.contextMenu.notification.${opt.key}`)}</span>
                  {opt.descKey && <span className="context-sub-label">{t(`serverBar.contextMenu.notification.${opt.descKey}`)}</span>}
                </span>
                <span className={`context-radio ${currentNotify === opt.value ? "context-radio-active" : ""}`} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="context-menu-separator" />

      {currentFolderId ? (
        <button role="menuitem" tabIndex={-1} className="context-menu-item" onClick={onRemoveFromFolder}>
          {t("serverBar.contextMenu.removeFromFolder")}
        </button>
      ) : (
        <>
          <button role="menuitem" tabIndex={-1} className="context-menu-item" onClick={onCreateFolder}>
            {t("serverBar.contextMenu.createFolder")}
          </button>
          {folders.length > 0 && (
            <>
              <div className="context-menu-separator" />
              {folders.map((f) => (
                <button key={f.id} role="menuitem" tabIndex={-1} className="context-menu-item" onClick={() => onAddToFolder(f.id)}>
                  <span className="folder-menu-dot" style={{ backgroundColor: f.color }} />
                  {t("serverBar.contextMenu.addTo", { folderName: f.name })}
                </button>
              ))}
            </>
          )}
        </>
      )}
      <div className="context-menu-separator" />
      <button
        role="menuitem"
        tabIndex={-1}
        className="context-menu-item-danger"
        onClick={onLeave}
      >
        {t("serverBar.contextMenu.leaveServer")}
      </button>
      {isOwner && (
        <button
          role="menuitem"
          tabIndex={-1}
          className="context-menu-item-danger"
          onClick={onDelete}
        >
          {t("serverBar.contextMenu.deleteServer")}
        </button>
      )}
    </div>
  );
}

function SortableFolderIcon({
  id,
  folderId,
  folder,
  isExpanded,
  hasActive,
  folderUnread,
  onToggle,
  onContextMenu,
  children,
}: {
  id: string;
  folderId: string;
  folder: ServerFolder;
  isExpanded: boolean;
  hasActive: boolean;
  folderUnread: number;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `folder-drop-${folderId}` });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };

  const folderButton = (
    <button
      className={`server-folder-icon ${hasActive ? "active" : ""}`}
      style={{ borderColor: folder.color }}
      onClick={onToggle}
      title={folder.name}
      aria-label={`${folder.name} folder${isExpanded ? " (expanded)" : ""}`}
      aria-expanded={isExpanded}
      data-roving-item
      {...listeners}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill={folder.color} aria-hidden="true">
        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>
      {folderUnread > 0 && <span className="server-unread-dot" />}
    </button>
  );

  return (
    <div
      ref={(el) => { setSortableRef(el); setDropRef(el); }}
      style={style}
      className={`server-folder-wrapper ${isOver ? "folder-drop-hover" : ""}`}
      onContextMenu={onContextMenu}
      {...attributes}
    >
      {isExpanded ? (
        <div className="server-folder-expanded" style={{ "--folder-bg": `${folder.color}18` } as React.CSSProperties}>
          {folderButton}
          {children}
          <div className="server-folder-end-line" style={{ borderColor: folder.color }} />
        </div>
      ) : (
        folderButton
      )}
    </div>
  );
}

function FolderContextMenu({
  x,
  y,
  folder,
  onEdit,
  onDelete,
}: {
  x: number;
  y: number;
  folder: ServerFolder;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useMenuKeyboard(menuRef);

  return (
    <div
      ref={menuRef}
      className="channel-context-menu"
      style={{ top: y, left: x }}
      role="menu"
      aria-label={t("serverBar.folderContextMenu.ariaLabel")}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <button role="menuitem" tabIndex={-1} className="context-menu-item" onClick={onEdit}>
        {t("serverBar.folderContextMenu.editFolder")}
      </button>
      <button role="menuitem" tabIndex={-1} className="context-menu-item-danger" onClick={onDelete}>
        {t("serverBar.folderContextMenu.deleteFolder")}
      </button>
    </div>
  );
}
