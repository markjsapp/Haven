import { useState } from "react";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";

function parseChannelName(encryptedMeta: string): string {
  try {
    const json = JSON.parse(atob(encryptedMeta));
    return json.name || json.type || "unnamed";
  } catch {
    return "unnamed";
  }
}

function parseDmDisplayName(encryptedMeta: string, myUserId: string): string {
  try {
    const json = JSON.parse(atob(encryptedMeta));
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

export default function Sidebar() {
  const channels = useChatStore((s) => s.channels);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const startDm = useChatStore((s) => s.startDm);
  const user = useAuthStore((s) => s.user);

  const [dmTarget, setDmTarget] = useState("");
  const [showDmInput, setShowDmInput] = useState(false);
  const [dmError, setDmError] = useState("");

  const serverChannels = channels.filter((ch) => ch.channel_type !== "dm");
  const dmChannels = channels.filter((ch) => ch.channel_type === "dm");

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

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Haven</h1>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Channels</span>
        </div>
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
            <li className="channel-empty">No channels yet</li>
          )}
        </ul>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Direct Messages</span>
          <button
            className="btn-icon"
            onClick={() => setShowDmInput(!showDmInput)}
            title="New DM"
          >
            +
          </button>
        </div>

        {showDmInput && (
          <div className="dm-input-row">
            <input
              type="text"
              placeholder="Username..."
              value={dmTarget}
              onChange={(e) => setDmTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStartDm()}
            />
            <button className="btn-small" onClick={handleStartDm}>
              Go
            </button>
            {dmError && <div className="error-small">{dmError}</div>}
          </div>
        )}

        <ul className="channel-list">
          {dmChannels.map((ch) => (
            <li key={ch.id}>
              <button
                className={`channel-item ${ch.id === currentChannelId ? "active" : ""}`}
                onClick={() => selectChannel(ch.id)}
              >
                {parseDmDisplayName(ch.encrypted_meta, user?.id ?? "")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
