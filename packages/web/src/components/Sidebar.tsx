import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { usePresenceStore } from "../store/presence.js";
import { unicodeBtoa, unicodeAtob } from "../lib/base64.js";

function parseChannelName(encryptedMeta: string): string {
  try {
    const json = JSON.parse(unicodeAtob(encryptedMeta));
    return json.name || json.type || "unnamed";
  } catch {
    return "unnamed";
  }
}

function parseDmPeerId(encryptedMeta: string, myUserId: string): string | null {
  try {
    const json = JSON.parse(unicodeAtob(encryptedMeta));
    if (json.participants) {
      return json.participants.find((p: string) => p !== myUserId) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function parseDmDisplayName(encryptedMeta: string, myUserId: string): string {
  try {
    const json = JSON.parse(unicodeAtob(encryptedMeta));
    // New format: { names: { [userId]: username } }
    if (json.names) {
      for (const [id, name] of Object.entries(json.names)) {
        if (id !== myUserId) return name as string;
      }
    }
    // Fallback: show participant ID prefix
    if (json.participants) {
      const other = json.participants.find((p: string) => p !== myUserId);
      if (other) return other.slice(0, 8);
    }
    return "DM";
  } catch {
    return "DM";
  }
}

function parseServerName(encryptedMeta: string): string {
  try {
    const decoded = unicodeAtob(encryptedMeta);
    // Try JSON first
    const json = JSON.parse(decoded);
    return json.name || "unnamed";
  } catch {
    // Fallback: raw string (used in create_server)
    try {
      return unicodeAtob(encryptedMeta) || "unnamed";
    } catch {
      return "unnamed";
    }
  }
}

export default function Sidebar() {
  const { t } = useTranslation();
  const channels = useChatStore((s) => s.channels);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const startDm = useChatStore((s) => s.startDm);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const user = useAuthStore((s) => s.user);
  const api = useAuthStore((s) => s.api);

  const [dmTarget, setDmTarget] = useState("");
  const [showDmInput, setShowDmInput] = useState(false);
  const [dmError, setDmError] = useState("");

  // Server creation
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [serverName, setServerName] = useState("");
  const [createServerError, setCreateServerError] = useState("");

  // Join by invite
  const [showJoinServer, setShowJoinServer] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joinError, setJoinError] = useState("");

  const presenceStatuses = usePresenceStore((s) => s.statuses);
  const fetchPresence = usePresenceStore((s) => s.fetchPresence);

  const serverChannels = channels.filter((ch) => ch.channel_type !== "dm");
  const dmChannels = channels.filter((ch) => ch.channel_type === "dm");

  // Fetch initial presence for all DM peers
  useEffect(() => {
    if (!user || dmChannels.length === 0) return;
    const peerIds = dmChannels
      .map((ch) => parseDmPeerId(ch.encrypted_meta, user.id))
      .filter((id): id is string => id !== null);
    if (peerIds.length > 0) fetchPresence(peerIds);
  }, [dmChannels.length, user?.id]);

  async function handleStartDm() {
    if (!dmTarget.trim()) return;
    setDmError("");
    try {
      await startDm(dmTarget.trim());
      setDmTarget("");
      setShowDmInput(false);
    } catch (err: any) {
      setDmError(err.message || "Failed to start DM");
    }
  }

  async function handleCreateServer() {
    if (!serverName.trim()) return;
    setCreateServerError("");
    try {
      const meta = JSON.stringify({ name: serverName.trim() });
      const metaBase64 = unicodeBtoa(meta);
      await api.createServer({ encrypted_meta: metaBase64 });
      await loadChannels();
      setServerName("");
      setShowCreateServer(false);
    } catch (err: any) {
      setCreateServerError(err.message || "Failed to create server");
    }
  }

  async function handleJoinServer() {
    if (!inviteCode.trim()) return;
    setJoinError("");
    try {
      await api.joinByInvite(inviteCode.trim());
      await loadChannels();
      setInviteCode("");
      setShowJoinServer(false);
    } catch (err: any) {
      setJoinError(err.message || "Invalid invite code");
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>{t("sidebar.appName")}</h1>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>{t("sidebar.servers")}</span>
          <div style={{ display: "flex", gap: 2 }}>
            <button
              className="btn-icon"
              onClick={() => { setShowCreateServer(!showCreateServer); setShowJoinServer(false); }}
              title={t("sidebar.createServer")}
            >
              +
            </button>
            <button
              className="btn-icon"
              onClick={() => { setShowJoinServer(!showJoinServer); setShowCreateServer(false); }}
              title={t("sidebar.joinServer")}
            >
              &rarr;
            </button>
          </div>
        </div>

        {showCreateServer && (
          <div className="dm-input-row">
            <input
              type="text"
              placeholder={t("sidebar.serverNamePlaceholder")}
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateServer()}
            />
            <button className="btn-small" onClick={handleCreateServer}>
              {t("sidebar.create")}
            </button>
            {createServerError && <div className="error-small">{createServerError}</div>}
          </div>
        )}

        {showJoinServer && (
          <div className="dm-input-row">
            <input
              type="text"
              placeholder={t("sidebar.inviteCodePlaceholder")}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoinServer()}
            />
            <button className="btn-small" onClick={handleJoinServer}>
              {t("sidebar.join")}
            </button>
            {joinError && <div className="error-small">{joinError}</div>}
          </div>
        )}

        <ul className="channel-list">
          {serverChannels.map((ch) => (
            <li key={ch.id}>
              <button
                className={`channel-item ${ch.id === currentChannelId ? "active" : ""}`}
                onClick={() => selectChannel(ch.id)}
              >
                # {parseChannelName(ch.encrypted_meta)}
              </button>
            </li>
          ))}
          {serverChannels.length === 0 && (
            <li className="channel-empty">{t("sidebar.noChannels")}</li>
          )}
        </ul>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>{t("sidebar.directMessages")}</span>
          <button
            className="btn-icon"
            onClick={() => setShowDmInput(!showDmInput)}
            title={t("sidebar.newDm")}
          >
            +
          </button>
        </div>

        {showDmInput && (
          <div className="dm-input-row">
            <input
              type="text"
              placeholder={t("sidebar.usernamePlaceholder")}
              value={dmTarget}
              onChange={(e) => setDmTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStartDm()}
            />
            <button className="btn-small" onClick={handleStartDm}>
              {t("sidebar.go")}
            </button>
            {dmError && <div className="error-small">{dmError}</div>}
          </div>
        )}

        <ul className="channel-list">
          {dmChannels.map((ch) => {
            const peerId = parseDmPeerId(ch.encrypted_meta, user?.id ?? "");
            const isOnline = peerId ? presenceStatuses[peerId] === "online" : false;
            return (
              <li key={ch.id}>
                <button
                  className={`channel-item ${ch.id === currentChannelId ? "active" : ""}`}
                  onClick={() => selectChannel(ch.id)}
                >
                  <span className={`presence-dot ${isOnline ? "online" : "offline"}`} />
                  {parseDmDisplayName(ch.encrypted_meta, user?.id ?? "")}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
