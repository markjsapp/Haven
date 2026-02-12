import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { Permission, type InviteResponse, type ServerMemberResponse, type CategoryResponse, type BanResponse, type ChannelResponse } from "@haven/core";
import { usePermissions } from "../hooks/usePermissions.js";
import RoleSettings from "./RoleSettings.js";
import ConfirmDialog from "./ConfirmDialog.js";
import BanMemberModal from "./BanMemberModal.js";
import EditMemberRolesModal from "./EditMemberRolesModal.js";
import { parseChannelDisplay } from "../lib/channel-utils.js";

interface Props {
  serverId: string;
  onClose: () => void;
}

export default function ServerSettings({ serverId, onClose }: Props) {
  const api = useAuthStore((s) => s.api);
  const { can } = usePermissions(serverId);

  const canManageServer = can(Permission.MANAGE_SERVER);
  const canManageInvites = can(Permission.MANAGE_INVITES);
  const canCreateInvites = can(Permission.CREATE_INVITES);
  const canManageChannels = can(Permission.MANAGE_CHANNELS);
  const canManageRoles = can(Permission.MANAGE_ROLES);
  const canBanMembers = can(Permission.BAN_MEMBERS);
  const canKickMembers = can(Permission.KICK_MEMBERS);

  const server = useChatStore((s) => s.servers.find((sv) => sv.id === serverId));
  const allChannels = useChatStore((s) => s.channels);
  const serverChannels = useMemo(
    () => allChannels.filter((ch) => ch.server_id === serverId && ch.channel_type === "text"),
    [allChannels, serverId],
  );

  const [invites, setInvites] = useState<InviteResponse[]>([]);
  const [members, setMembers] = useState<ServerMemberResponse[]>([]);
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [bans, setBans] = useState<BanResponse[]>([]);
  const [systemChannelId, setSystemChannelId] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "members" | "invites" | "categories" | "roles" | "bans">(
    canManageServer ? "overview" : "members"
  );
  const [error, setError] = useState("");
  const [createdCode, setCreatedCode] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState("");

  // Confirmation modals
  const [kickTarget, setKickTarget] = useState<{ userId: string; username: string } | null>(null);
  const [banTarget, setBanTarget] = useState<{ userId: string; username: string } | null>(null);
  const [deleteCatTarget, setDeleteCatTarget] = useState<{ id: string; name: string } | null>(null);
  const [editRolesTarget, setEditRolesTarget] = useState<{ userId: string; username: string } | null>(null);

  useEffect(() => {
    loadData();
  }, [serverId]);

  useEffect(() => {
    setSystemChannelId(server?.system_channel_id ?? null);
  }, [server?.system_channel_id]);

  async function loadData() {
    try {
      const m = await api.listServerMembers(serverId);
      setMembers(m);

      const [inv, cats, b] = await Promise.all([
        (canManageInvites || canCreateInvites)
          ? api.listInvites(serverId) : Promise.resolve([] as InviteResponse[]),
        canManageChannels
          ? api.listCategories(serverId) : Promise.resolve([] as CategoryResponse[]),
        canBanMembers
          ? api.listBans(serverId) : Promise.resolve([] as BanResponse[]),
      ]);
      setInvites(inv);
      setCategories(cats);
      setBans(b);
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
      setKickTarget(null);
    } catch (err: any) {
      setError(err.message || "Failed to kick member");
    }
  }

  async function handleRevokeBan(userId: string) {
    try {
      await api.revokeBan(serverId, userId);
      setBans((prev) => prev.filter((b) => b.user_id !== userId));
    } catch (err: any) {
      setError(err.message || "Failed to revoke ban");
    }
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;
    setError("");
    try {
      const cat = await api.createCategory(serverId, {
        name: newCategoryName.trim(),
        position: categories.length,
      });
      setCategories((prev) => [...prev, cat]);
      setNewCategoryName("");
      useChatStore.getState().loadChannels();
    } catch (err: any) {
      setError(err.message || "Failed to create category");
    }
  }

  async function handleRenameCategory(catId: string) {
    if (!editingCatName.trim()) return;
    setError("");
    try {
      const updated = await api.updateCategory(serverId, catId, { name: editingCatName.trim() });
      setCategories((prev) => prev.map((c) => (c.id === catId ? updated : c)));
      setEditingCatId(null);
      useChatStore.getState().loadChannels();
    } catch (err: any) {
      setError(err.message || "Failed to rename category");
    }
  }

  async function handleDeleteCategory(catId: string) {
    setError("");
    try {
      await api.deleteCategory(serverId, catId);
      setCategories((prev) => prev.filter((c) => c.id !== catId));
      setDeleteCatTarget(null);
      useChatStore.getState().loadChannels();
    } catch (err: any) {
      setError(err.message || "Failed to delete category");
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
          {canManageServer && (
            <button
              className={`server-settings-tab ${tab === "overview" ? "active" : ""}`}
              onClick={() => setTab("overview")}
            >
              Overview
            </button>
          )}
          <button
            className={`server-settings-tab ${tab === "members" ? "active" : ""}`}
            onClick={() => setTab("members")}
          >
            Members ({members.length})
          </button>
          {(canManageInvites || canCreateInvites) && (
            <button
              className={`server-settings-tab ${tab === "invites" ? "active" : ""}`}
              onClick={() => setTab("invites")}
            >
              Invites
            </button>
          )}
          {canManageChannels && (
            <button
              className={`server-settings-tab ${tab === "categories" ? "active" : ""}`}
              onClick={() => setTab("categories")}
            >
              Categories
            </button>
          )}
          {canManageRoles && (
            <button
              className={`server-settings-tab ${tab === "roles" ? "active" : ""}`}
              onClick={() => setTab("roles")}
            >
              Roles
            </button>
          )}
          {canBanMembers && (
            <button
              className={`server-settings-tab ${tab === "bans" ? "active" : ""}`}
              onClick={() => setTab("bans")}
            >
              Bans ({bans.length})
            </button>
          )}
        </div>

        {error && <div className="error-small" style={{ padding: "8px 16px" }}>{error}</div>}

        {tab === "overview" && canManageServer && (
          <div className="server-settings-list" style={{ padding: 16 }}>
            <label className="profile-edit-label">
              System Messages Channel
              <select
                className="profile-edit-input"
                value={systemChannelId ?? ""}
                onChange={(e) => setSystemChannelId(e.target.value || null)}
              >
                <option value="">None</option>
                {serverChannels.map((ch) => {
                  const display = parseChannelDisplay(ch.encrypted_meta, "");
                  return (
                    <option key={ch.id} value={ch.id}>
                      #{display?.name ?? ch.id.slice(0, 8)}
                    </option>
                  );
                })}
              </select>
            </label>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 12px" }}>
              New member join messages will be posted in this channel.
            </p>
            <button
              className="btn-primary"
              onClick={async () => {
                setError("");
                try {
                  await api.updateServer(serverId, { system_channel_id: systemChannelId });
                  await useChatStore.getState().loadChannels();
                } catch (err: any) {
                  setError(err.message || "Failed to update server");
                }
              }}
            >
              Save Changes
            </button>
          </div>
        )}

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
                {m.user_id !== user?.id && (canManageRoles || canKickMembers || canBanMembers) && (
                  <div className="server-member-actions">
                    {canManageRoles && (
                      <button
                        className="btn-ghost server-roles-btn"
                        onClick={() => setEditRolesTarget({ userId: m.user_id, username: m.display_name || m.username })}
                      >
                        Roles
                      </button>
                    )}
                    {canKickMembers && (
                      <button
                        className="btn-ghost server-kick-btn"
                        onClick={() => setKickTarget({ userId: m.user_id, username: m.display_name || m.username })}
                      >
                        Kick
                      </button>
                    )}
                    {canBanMembers && (
                      <button
                        className="btn-ghost server-ban-btn"
                        onClick={() => setBanTarget({ userId: m.user_id, username: m.display_name || m.username })}
                      >
                        Ban
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "invites" && (canManageInvites || canCreateInvites) && (
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
                {canManageInvites && (
                  <button
                    className="btn-ghost"
                    onClick={() => handleDeleteInvite(inv.id)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
            {invites.length === 0 && (
              <div style={{ padding: "8px 16px", color: "var(--text-muted)", fontSize: 13 }}>
                No invites yet. Create one to share with others.
              </div>
            )}
          </div>
        )}

        {tab === "categories" && canManageChannels && (
          <div className="server-settings-list">
            <div style={{ padding: "8px 16px" }}>
              <div className="dm-input-row">
                <input
                  type="text"
                  placeholder="Category name..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateCategory()}
                />
                <button className="btn-small" onClick={handleCreateCategory}>Create</button>
              </div>
            </div>

            {categories.map((cat) => (
              <div key={cat.id} className="server-member-row">
                {editingCatId === cat.id ? (
                  <div className="dm-input-row" style={{ flex: 1 }}>
                    <input
                      type="text"
                      value={editingCatName}
                      onChange={(e) => setEditingCatName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameCategory(cat.id);
                        if (e.key === "Escape") setEditingCatId(null);
                      }}
                      autoFocus
                    />
                    <button className="btn-small" onClick={() => handleRenameCategory(cat.id)}>Save</button>
                  </div>
                ) : (
                  <>
                    <div className="server-member-info" style={{ flex: 1 }}>
                      <span className="server-member-name">{cat.name}</span>
                    </div>
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        setEditingCatId(cat.id);
                        setEditingCatName(cat.name);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      className="btn-ghost server-kick-btn"
                      onClick={() => setDeleteCatTarget({ id: cat.id, name: cat.name })}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            ))}
            {categories.length === 0 && (
              <div style={{ padding: "8px 16px", color: "var(--text-muted)", fontSize: 13 }}>
                No categories yet. Create one to organize your channels.
              </div>
            )}
          </div>
        )}

        {tab === "bans" && canBanMembers && (
          <div className="server-settings-list">
            {bans.map((ban) => (
              <div key={ban.id} className="server-member-row">
                <div className="server-member-avatar" style={{ background: "var(--red)" }}>
                  {ban.username.charAt(0).toUpperCase()}
                </div>
                <div className="server-member-info">
                  <span className="server-member-name">{ban.username}</span>
                  {ban.reason && (
                    <span className="server-member-username">Reason: {ban.reason}</span>
                  )}
                  <span className="server-member-username">
                    Banned {new Date(ban.created_at).toLocaleDateString()}
                  </span>
                </div>
                <button
                  className="btn-ghost"
                  onClick={() => handleRevokeBan(ban.user_id)}
                >
                  Revoke
                </button>
              </div>
            ))}
            {bans.length === 0 && (
              <div style={{ padding: "8px 16px", color: "var(--text-muted)", fontSize: 13 }}>
                No banned users.
              </div>
            )}
          </div>
        )}

        {tab === "roles" && canManageRoles && (
          <RoleSettings serverId={serverId} />
        )}
      </div>

      {/* Kick confirmation */}
      {kickTarget && (
        <ConfirmDialog
          title="Kick Member"
          message={`Are you sure you want to kick ${kickTarget.username} from this server?`}
          confirmLabel="Kick"
          danger
          onConfirm={() => handleKick(kickTarget.userId)}
          onCancel={() => setKickTarget(null)}
        />
      )}

      {/* Ban modal */}
      {banTarget && (
        <BanMemberModal
          serverId={serverId}
          userId={banTarget.userId}
          username={banTarget.username}
          onBanned={(userId) => {
            setMembers((prev) => prev.filter((m) => m.user_id !== userId));
            loadData(); // Reload bans list
          }}
          onClose={() => setBanTarget(null)}
        />
      )}

      {/* Edit member roles */}
      {editRolesTarget && (
        <EditMemberRolesModal
          serverId={serverId}
          userId={editRolesTarget.userId}
          username={editRolesTarget.username}
          onClose={() => setEditRolesTarget(null)}
        />
      )}

      {/* Delete category confirmation */}
      {deleteCatTarget && (
        <ConfirmDialog
          title="Delete Category"
          message={`Delete "${deleteCatTarget.name}"? Channels in it will become uncategorized.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDeleteCategory(deleteCatTarget.id)}
          onCancel={() => setDeleteCatTarget(null)}
        />
      )}
    </div>
  );
}
