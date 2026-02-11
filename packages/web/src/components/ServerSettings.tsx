import { useEffect, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import type { InviteResponse, ServerMemberResponse } from "@haven/core";

interface Props {
  serverId: string;
  isOwner: boolean;
  onClose: () => void;
}

export default function ServerSettings({ serverId, isOwner, onClose }: Props) {
  const api = useAuthStore((s) => s.api);

  const [invites, setInvites] = useState<InviteResponse[]>([]);
  const [members, setMembers] = useState<ServerMemberResponse[]>([]);
  const [tab, setTab] = useState<"members" | "invites">("members");
  const [error, setError] = useState("");
  const [createdCode, setCreatedCode] = useState("");

  useEffect(() => {
    loadData();
  }, [serverId]);

  async function loadData() {
    try {
      const m = await api.listServerMembers(serverId);
      setMembers(m);
      if (isOwner) {
        const inv = await api.listInvites(serverId);
        setInvites(inv);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load server data");
    }
  }

  async function handleCreateInvite() {
    setError("");
    setCreatedCode("");
    try {
      const invite = await api.createInvite(serverId, { expires_in_hours: 24 });
      setCreatedCode(invite.code);
      setInvites((prev) => [invite, ...prev]);
    } catch (err: any) {
      setError(err.message || "Failed to create invite");
    }
  }

  async function handleDeleteInvite(inviteId: string) {
    try {
      await api.deleteInvite(serverId, inviteId);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch (err: any) {
      setError(err.message || "Failed to revoke invite");
    }
  }

  async function handleKick(userId: string) {
    try {
      await api.kickMember(serverId, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch (err: any) {
      setError(err.message || "Failed to kick member");
    }
  }

  const user = useAuthStore.getState().user;

  return (
    <div className="server-settings-overlay" onClick={onClose}>
      <div className="server-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="server-settings-header">
          <h3>Server Settings</h3>
          <button className="btn-ghost" onClick={onClose}>&times;</button>
        </div>

        <div className="server-settings-tabs">
          <button
            className={`server-settings-tab ${tab === "members" ? "active" : ""}`}
            onClick={() => setTab("members")}
          >
            Members ({members.length})
          </button>
          {isOwner && (
            <button
              className={`server-settings-tab ${tab === "invites" ? "active" : ""}`}
              onClick={() => setTab("invites")}
            >
              Invites
            </button>
          )}
        </div>

        {error && <div className="error-small" style={{ padding: "8px 16px" }}>{error}</div>}

        {tab === "members" && (
          <div className="server-settings-list">
            {members.map((m) => (
              <div key={m.user_id} className="server-member-row">
                <div className="server-member-avatar">
                  {(m.display_name || m.username).charAt(0).toUpperCase()}
                </div>
                <div className="server-member-info">
                  <span className="server-member-name">
                    {m.display_name || m.username}
                  </span>
                  <span className="server-member-username">@{m.username}</span>
                </div>
                {isOwner && m.user_id !== user?.id && (
                  <button
                    className="btn-ghost server-kick-btn"
                    onClick={() => handleKick(m.user_id)}
                  >
                    Kick
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "invites" && isOwner && (
          <div className="server-settings-list">
            <div style={{ padding: "8px 16px" }}>
              <button className="btn-small" onClick={handleCreateInvite}>
                Create Invite (24h)
              </button>
              {createdCode && (
                <div className="invite-created">
                  Code: <strong>{createdCode}</strong>
                  <button
                    className="btn-ghost"
                    onClick={() => navigator.clipboard.writeText(createdCode)}
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>

            {invites.map((inv) => (
              <div key={inv.id} className="invite-row">
                <div className="invite-code">{inv.code}</div>
                <div className="invite-meta">
                  Uses: {inv.use_count}{inv.max_uses ? `/${inv.max_uses}` : ""}
                  {inv.expires_at && (
                    <span> | Expires: {new Date(inv.expires_at).toLocaleString()}</span>
                  )}
                </div>
                <button
                  className="btn-ghost"
                  onClick={() => handleDeleteInvite(inv.id)}
                >
                  Revoke
                </button>
              </div>
            ))}
            {invites.length === 0 && (
              <div style={{ padding: "8px 16px", color: "var(--text-muted)", fontSize: 13 }}>
                No invites yet. Create one to share with others.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
