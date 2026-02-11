import { useState } from "react";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { useUiStore } from "../store/ui.js";
import { parseServerName } from "../lib/channel-utils.js";

export default function ServerBar() {
  const servers = useChatStore((s) => s.servers);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const selectedServerId = useUiStore((s) => s.selectedServerId);
  const selectServer = useUiStore((s) => s.selectServer);
  const api = useAuthStore((s) => s.api);

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [serverName, setServerName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!serverName.trim()) return;
    setError("");
    try {
      const meta = JSON.stringify({ name: serverName.trim() });
      await api.createServer({ encrypted_meta: btoa(meta) });
      await loadChannels();
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
            <svg width="28" height="20" viewBox="0 0 28 20" fill="currentColor">
              <path d="M23.02 1.56C21.27.72 19.38.12 17.4 0c-.21.38-.46.89-.63 1.29-2.08-.31-4.14-.31-6.16 0C10.44.89 10.13.38 9.92 0 7.94.12 6.05.72 4.3 1.56 .62 7.01-.38 12.32.12 17.56A20.3 20.3 0 0 0 6.29 20c.5-.68.94-1.4 1.33-2.16-.73-.28-1.43-.62-2.1-1.01.18-.13.35-.27.51-.41a14.52 14.52 0 0 0 12.54 0c.17.15.34.28.51.41-.67.4-1.37.74-2.1 1.01.38.76.83 1.48 1.33 2.16a20.23 20.23 0 0 0 6.17-2.44c.59-6.13-.99-11.39-4.18-16.08zM9.68 14.38c-1.39 0-2.53-1.28-2.53-2.84s1.12-2.84 2.53-2.84 2.56 1.28 2.53 2.84c0 1.57-1.12 2.84-2.53 2.84zm9.35 0c-1.39 0-2.53-1.28-2.53-2.84s1.12-2.84 2.53-2.84 2.56 1.28 2.53 2.84c0 1.57-1.11 2.84-2.53 2.84z" />
            </svg>
          </button>
        </div>

        <div className="server-bar-divider" />

        {/* Server list */}
        {servers.map((srv) => {
          const name = parseServerName(srv.encrypted_meta);
          const isActive = selectedServerId === srv.id;
          return (
            <div
              key={srv.id}
              className={`server-icon-wrapper ${isActive ? "active" : ""}`}
            >
              <span className="server-pill" />
              <button
                className={`server-icon ${isActive ? "active" : ""}`}
                onClick={() => selectServer(srv.id)}
                title={name}
              >
                {name.charAt(0).toUpperCase()}
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
