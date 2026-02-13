import { useState, useMemo, useEffect } from "react";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { useUiStore } from "../store/ui.js";
import { parseServerName } from "../lib/channel-utils.js";

export default function ServerBar() {
  const servers = useChatStore((s) => s.servers);
  const channels = useChatStore((s) => s.channels);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const selectedServerId = useUiStore((s) => s.selectedServerId);
  const selectServer = useUiStore((s) => s.selectServer);
  const api = useAuthStore((s) => s.api);
  const user = useAuthStore((s) => s.user);

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

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [serverName, setServerName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");

  // ─── Server Context Menu ────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; serverId: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "leave" | "delete"; serverId: string; serverName: string } | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [ctxMenu]);

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
      const newServer = await api.createServer({ encrypted_meta: btoa(meta) });
      await loadChannels();
      selectServer(newServer.id);
      setServerName("");
      setShowCreate(false);
    } catch (err: any) {
      setError(err.message || "Failed");
    }
  }

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
      <div className="server-bar-inner">
        {/* Home / DM button */}
        <div className={`server-icon-wrapper ${selectedServerId === null ? "active" : ""}`}>
          <span className="server-pill" />
          <button
            className={`server-icon home-icon ${selectedServerId === null ? "active" : ""}`}
            onClick={() => selectServer(null)}
            title="Direct Messages"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
              <path d="M7 9h10v2H7zm0-3h10v2H7z" />
            </svg>
            {dmUnread > 0 && <span className="server-unread-dot" />}
          </button>
        </div>

        <div className="server-bar-divider" />

        {/* Server list */}
        {servers.map((srv) => {
          const name = parseServerName(srv.encrypted_meta);
          const isActive = selectedServerId === srv.id;
          const srvUnread = serverUnreads[srv.id] ?? 0;
          return (
            <div
              key={srv.id}
              className={`server-icon-wrapper ${isActive ? "active" : ""}`}
            >
              <span className="server-pill" />
              <button
                className={`server-icon ${isActive ? "active" : ""}`}
                onClick={() => selectServer(srv.id)}
                onContextMenu={(e) => handleServerContextMenu(e, srv.id)}
                title={name}
              >
                {name.charAt(0).toUpperCase()}
                {srvUnread > 0 && <span className="server-unread-dot" />}
              </button>
            </div>
          );
        })}

        <div className="server-bar-divider" />

        {/* Add server */}
        <div className="server-icon-wrapper">
          <button
            className={`server-icon add-server-icon ${showCreate ? "active" : ""}`}
            onClick={() => { setShowCreate(!showCreate); setShowJoin(false); setError(""); }}
            title="Add a Server"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 5h-2v6H5v2h6v6h2v-6h6v-2h-6V5z" />
            </svg>
          </button>
        </div>

        {/* Join server */}
        <div className="server-icon-wrapper">
          <button
            className={`server-icon join-server-icon ${showJoin ? "active" : ""}`}
            onClick={() => { setShowJoin(!showJoin); setShowCreate(false); setError(""); }}
            title="Join a Server"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6-6-6z" />
            </svg>
          </button>
        </div>
      </div>

    </nav>

      {/* Server context menu */}
      {ctxMenu && (() => {
        const srv = servers.find((s) => s.id === ctxMenu.serverId);
        if (!srv) return null;
        const name = parseServerName(srv.encrypted_meta);
        const isOwner = user?.id === srv.owner_id;
        return (
          <div
            className="channel-context-menu"
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
          >
            {isOwner ? (
              <button
                className="context-menu-item-danger"
                onClick={() => {
                  setCtxMenu(null);
                  setConfirmAction({ type: "delete", serverId: srv.id, serverName: name });
                }}
              >
                Delete Server
              </button>
            ) : (
              <button
                className="context-menu-item-danger"
                onClick={() => {
                  setCtxMenu(null);
                  setConfirmAction({ type: "leave", serverId: srv.id, serverName: name });
                }}
              >
                Leave Server
              </button>
            )}
          </div>
        );
      })()}

      {/* Confirm leave/delete dialog */}
      {confirmAction && (
        <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">
              {confirmAction.type === "delete" ? "Delete Server" : "Leave Server"}
            </h2>
            <p className="modal-subtitle">
              {confirmAction.type === "delete"
                ? `Are you sure you want to delete "${confirmAction.serverName}"? This action cannot be undone and all channels, messages, and roles will be permanently deleted.`
                : `Are you sure you want to leave "${confirmAction.serverName}"? You will need a new invite to rejoin.`}
            </p>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={() =>
                  confirmAction.type === "delete"
                    ? handleDeleteServer(confirmAction.serverId)
                    : handleLeaveServer(confirmAction.serverId)
                }
              >
                {confirmAction.type === "delete" ? "Delete Server" : "Leave Server"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create server modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Create a Server</h2>
            <p className="modal-subtitle">Give your new server a name to get started.</p>
            <label className="modal-label">SERVER NAME</label>
            <input
              className="modal-input"
              type="text"
              placeholder="My Awesome Server"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            {error && <span className="modal-error">{error}</span>}
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn-primary modal-submit" onClick={handleCreate}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Join server modal */}
      {showJoin && (
        <div className="modal-overlay" onClick={() => setShowJoin(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Join a Server</h2>
            <p className="modal-subtitle">Enter an invite code to join an existing server.</p>
            <label className="modal-label">INVITE CODE</label>
            <input
              className="modal-input"
              type="text"
              placeholder="AbC123"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              autoFocus
            />
            {error && <span className="modal-error">{error}</span>}
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setShowJoin(false)}>Cancel</button>
              <button className="btn-primary modal-submit" onClick={handleJoin}>Join</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
