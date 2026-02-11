import { useState, useEffect } from "react";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { useUiStore } from "../store/ui.js";
import { usePresenceStore } from "../store/presence.js";
import {
  parseChannelName,
  parseDmPeerId,
  parseDmDisplayName,
  parseServerName,
} from "../lib/channel-utils.js";
import UserPanel from "./UserPanel.js";
import ServerSettings from "./ServerSettings.js";

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

  const [showInput, setShowInput] = useState(false);
  const [dmTarget, setDmTarget] = useState("");
  const [error, setError] = useState("");

  const dmChannels = channels.filter((ch) => ch.channel_type === "dm");

  // Fetch initial presence for DM peers
  useEffect(() => {
    if (!user || dmChannels.length === 0) return;
    const peerIds = dmChannels
      .map((ch) => parseDmPeerId(ch.encrypted_meta, user.id))
      .filter((id): id is string => id !== null);
    if (peerIds.length > 0) fetchPresence(peerIds);
  }, [dmChannels.length, user?.id]);

  async function handleStartDm() {
    if (!dmTarget.trim()) return;
    setError("");
    try {
      await startDm(dmTarget.trim());
      setDmTarget("");
      setShowInput(false);
    } catch (err: any) {
      setError(err.message || "Failed");
    }
  }

  return (
    <>
      <div className="channel-sidebar-header">
        <button className="channel-sidebar-header-btn">
          Find or start a conversation
        </button>
      </div>
      <div className="channel-sidebar-content">
        <div className="channel-category-header">
          <span>Direct Messages</span>
          <button
            className="btn-icon"
            onClick={() => setShowInput(!showInput)}
            title="New DM"
          >
            +
          </button>
        </div>

        {showInput && (
          <div className="dm-input-row">
            <input
              type="text"
              placeholder="Username..."
              value={dmTarget}
              onChange={(e) => setDmTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStartDm()}
              autoFocus
            />
            <button className="btn-small" onClick={handleStartDm}>Go</button>
            {error && <div className="error-small">{error}</div>}
          </div>
        )}

        <ul className="channel-list">
          {dmChannels.map((ch) => {
            const peerId = parseDmPeerId(ch.encrypted_meta, user?.id ?? "");
            const isOnline = peerId ? presenceStatuses[peerId] === "online" : false;
            return (
              <li key={ch.id}>
                <button
                  className={`channel-item dm-item ${ch.id === currentChannelId ? "active" : ""}`}
                  onClick={() => selectChannel(ch.id)}
                >
                  <div className="dm-avatar">
                    {parseDmDisplayName(ch.encrypted_meta, user?.id ?? "").charAt(0).toUpperCase()}
                    <span className={`dm-avatar-status ${isOnline ? "online" : "offline"}`} />
                  </div>
                  <span className="dm-item-name">
                    {parseDmDisplayName(ch.encrypted_meta, user?.id ?? "")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

// ─── Server View ────────────────────────────────────

function ServerView({ serverId }: { serverId: string }) {
  const channels = useChatStore((s) => s.channels);
  const servers = useChatStore((s) => s.servers);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const api = useAuthStore((s) => s.api);
  const user = useAuthStore((s) => s.user);

  const [showSettings, setShowSettings] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [createError, setCreateError] = useState("");
  const [contextMenu, setContextMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const server = servers.find((s) => s.id === serverId);
  const serverName = server ? parseServerName(server.encrypted_meta) : "Server";
  const serverChannels = channels.filter((ch) => ch.server_id === serverId);
  const isOwner = server?.owner_id === user?.id;

  async function handleCreateChannel() {
    if (!newChannelName.trim()) return;
    setCreateError("");
    try {
      const meta = JSON.stringify({ name: newChannelName.trim() });
      await api.createChannel(serverId, { encrypted_meta: btoa(meta) });
      await loadChannels();
      setNewChannelName("");
      setShowCreateChannel(false);
    } catch (err: any) {
      setCreateError(err.message || "Failed");
    }
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
    if (!confirm("Delete this channel? All messages will be lost.")) return;
    try {
      await api.deleteChannel(channelId);
      await loadChannels();
    } catch { /* non-fatal */ }
  }

  function handleContextMenu(e: React.MouseEvent, channelId: string) {
    if (!isOwner) return;
    e.preventDefault();
    setContextMenu({ channelId, x: e.clientX, y: e.clientY });
  }

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

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
        <div className="channel-category-header">
          <span>Text Channels</span>
          {isOwner && (
            <button
              className="btn-icon"
              onClick={() => setShowCreateChannel(!showCreateChannel)}
              title="Create Channel"
            >
              +
            </button>
          )}
        </div>

        {showCreateChannel && (
          <div className="dm-input-row">
            <input
              type="text"
              placeholder="new-channel"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateChannel()}
              autoFocus
            />
            <button className="btn-small" onClick={handleCreateChannel}>Create</button>
            {createError && <div className="error-small">{createError}</div>}
          </div>
        )}

        <ul className="channel-list">
          {serverChannels.map((ch) => (
            <li key={ch.id}>
              {renamingId === ch.id ? (
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
              ) : (
                <button
                  className={`channel-item ${ch.id === currentChannelId ? "active" : ""}`}
                  onClick={() => selectChannel(ch.id)}
                  onContextMenu={(e) => handleContextMenu(e, ch.id)}
                >
                  <span className="channel-hash">#</span>
                  {parseChannelName(ch.encrypted_meta)}
                </button>
              )}
            </li>
          ))}
          {serverChannels.length === 0 && (
            <li className="channel-empty">No channels yet</li>
          )}
        </ul>
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
              handleDelete(contextMenu.channelId);
              setContextMenu(null);
            }}
          >
            Delete Channel
          </button>
        </div>
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
