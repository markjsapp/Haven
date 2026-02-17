import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { Permission, type InviteResponse, type ServerMemberResponse, type CategoryResponse, type BanResponse, type ChannelResponse, type CustomEmojiResponse, type AuditLogEntry } from "@haven/core";
import { usePermissions } from "../hooks/usePermissions.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import RoleSettings from "./RoleSettings.js";
import ConfirmDialog from "./ConfirmDialog.js";
import BanMemberModal from "./BanMemberModal.js";
import EditMemberRolesModal from "./EditMemberRolesModal.js";
import Avatar from "./Avatar.js";
import { parseChannelDisplay } from "../lib/channel-utils.js";

/** Format snake_case audit action into a readable label. */
function formatAuditAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Props {
  serverId: string;
  onClose: () => void;
}

export default function ServerSettings({ serverId, onClose }: Props) {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const { can } = usePermissions(serverId);

  const canManageServer = can(Permission.MANAGE_SERVER);
  const canManageInvites = can(Permission.MANAGE_INVITES);
  const canCreateInvites = can(Permission.CREATE_INVITES);
  const canManageChannels = can(Permission.MANAGE_CHANNELS);
  const canManageRoles = can(Permission.MANAGE_ROLES);
  const canBanMembers = can(Permission.BAN_MEMBERS);
  const canKickMembers = can(Permission.KICK_MEMBERS);
  const canManageEmojis = can(Permission.MANAGE_EMOJIS);
  const canViewAuditLog = can(Permission.VIEW_AUDIT_LOG);

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
  const [tab, setTab] = useState<"overview" | "members" | "invites" | "categories" | "roles" | "bans" | "emoji" | "audit">(
    canManageServer ? "overview" : "members"
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createdCode, setCreatedCode] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState("");

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditHasMore, setAuditHasMore] = useState(true);

  // Emoji tab state
  const customEmojis = useChatStore((s) => s.customEmojis);
  const userNames = useChatStore((s) => s.userNames);
  const serverEmojis = customEmojis[serverId] ?? [];
  const staticCount = serverEmojis.filter((e) => !e.animated).length;
  const animatedCount = serverEmojis.filter((e) => e.animated).length;

  // Re-fetch emojis from API when emoji tab is opened (ensures persistence)
  useEffect(() => {
    if (tab !== "emoji") return;
    api.listServerEmojis(serverId).then((emojis) => {
      useChatStore.setState((s) => ({
        customEmojis: { ...s.customEmojis, [serverId]: emojis },
      }));
    }).catch(() => {});
  }, [tab, serverId]);
  const [emojiUploading, setEmojiUploading] = useState(false);
  const [pendingEmoji, setPendingEmoji] = useState<{ file: File; preview: string; name: string } | null>(null);
  const [deleteEmojiTarget, setDeleteEmojiTarget] = useState<{ id: string; name: string } | null>(null);
  const emojiFileRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);

  // Confirmation modals
  const [kickTarget, setKickTarget] = useState<{ userId: string; username: string } | null>(null);
  const [banTarget, setBanTarget] = useState<{ userId: string; username: string } | null>(null);
  const [deleteCatTarget, setDeleteCatTarget] = useState<{ id: string; name: string } | null>(null);
  const [editRolesTarget, setEditRolesTarget] = useState<{ userId: string; username: string } | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  useEffect(() => {
    loadData();
  }, [serverId]);

  useEffect(() => {
    setSystemChannelId(server?.system_channel_id ?? null);
  }, [server?.system_channel_id]);

  // Load audit log when tab opens
  useEffect(() => {
    if (tab !== "audit" || !canViewAuditLog) return;
    if (auditEntries.length > 0) return; // already loaded
    setAuditLoading(true);
    api.getAuditLog(serverId, { limit: 50 }).then((entries) => {
      setAuditEntries(entries);
      setAuditHasMore(entries.length >= 50);
    }).catch(() => {
      setError(t("serverSettings.audit.failedLoad"));
    }).finally(() => setAuditLoading(false));
  }, [tab, serverId, canViewAuditLog]);

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
      setError(err.message || t("serverSettings.failedLoadData"));
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
      setError(err.message || t("serverSettings.invites.failedCreate"));
    }
  }

  async function handleDeleteInvite(inviteId: string) {
    try {
      await api.deleteInvite(serverId, inviteId);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch (err: any) {
      setError(err.message || t("serverSettings.invites.failedRevoke"));
    }
  }

  async function handleKick(userId: string) {
    try {
      await api.kickMember(serverId, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      setKickTarget(null);
    } catch (err: any) {
      setError(err.message || t("serverSettings.failedKick"));
    }
  }

  async function handleRevokeBan(userId: string) {
    try {
      await api.revokeBan(serverId, userId);
      setBans((prev) => prev.filter((b) => b.user_id !== userId));
    } catch (err: any) {
      setError(err.message || t("serverSettings.bans.failedRevoke"));
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
      setError(err.message || t("serverSettings.categories.failedCreate"));
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
      setError(err.message || t("serverSettings.categories.failedRename"));
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
      setError(err.message || t("serverSettings.categories.failedDelete"));
    }
  }

  const user = useAuthStore.getState().user;

  return (
    <>
      <div className="user-settings-overlay" role="presentation">
        <div className="user-settings-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("serverSettings.ariaLabel")}>
          <nav className="user-settings-sidebar">
            <div className="user-settings-sidebar-header">{t("serverSettings.sidebarHeader")}</div>
            {canManageServer && (
              <button
                className={`user-settings-nav-item ${tab === "overview" ? "active" : ""}`}
                onClick={() => setTab("overview")}
              >
                {t("serverSettings.tab.overview")}
              </button>
            )}
            <button
              className={`user-settings-nav-item ${tab === "members" ? "active" : ""}`}
              onClick={() => setTab("members")}
            >
              {t("serverSettings.tab.members")}
            </button>
            {(canManageInvites || canCreateInvites) && (
              <button
                className={`user-settings-nav-item ${tab === "invites" ? "active" : ""}`}
                onClick={() => setTab("invites")}
              >
                {t("serverSettings.tab.invites")}
              </button>
            )}
            {canManageChannels && (
              <button
                className={`user-settings-nav-item ${tab === "categories" ? "active" : ""}`}
                onClick={() => setTab("categories")}
              >
                {t("serverSettings.tab.categories")}
              </button>
            )}
            {canManageRoles && (
              <button
                className={`user-settings-nav-item ${tab === "roles" ? "active" : ""}`}
                onClick={() => setTab("roles")}
              >
                {t("serverSettings.tab.roles")}
              </button>
            )}
            {canBanMembers && (
              <button
                className={`user-settings-nav-item ${tab === "bans" ? "active" : ""}`}
                onClick={() => setTab("bans")}
              >
                {t("serverSettings.tab.bans")}
              </button>
            )}
            {canManageEmojis && (
              <button
                className={`user-settings-nav-item ${tab === "emoji" ? "active" : ""}`}
                onClick={() => setTab("emoji")}
              >
                {t("serverSettings.tab.emoji")}
              </button>
            )}
            {canViewAuditLog && (
              <button
                className={`user-settings-nav-item ${tab === "audit" ? "active" : ""}`}
                onClick={() => setTab("audit")}
              >
                {t("serverSettings.tab.auditLog")}
              </button>
            )}
            <div className="user-settings-sidebar-divider" />
          </nav>

          <div className="user-settings-content">
            <button className="settings-esc-close" onClick={onClose} aria-label={t("serverSettings.closeAriaLabel")}>
              <div className="settings-esc-circle">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </div>
              <span className="settings-esc-label">{t("serverSettings.escLabel")}</span>
            </button>
            {error && <div className="settings-error" style={{ marginBottom: 16 }}>{error}</div>}

            {tab === "overview" && canManageServer && (
              <div className="settings-section">
                <div className="settings-section-title">{t("serverSettings.overview.serverIcon")}</div>
                <p className="settings-description">
                  {t("serverSettings.overview.serverIconDesc")}
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                  <div
                    className="server-icon-preview"
                    style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--bg-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, overflow: "hidden", cursor: "pointer" }}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/png,image/jpeg,image/gif,image/webp";
                      input.onchange = async () => {
                        const file = input.files?.[0];
                        if (!file) return;
                        if (file.size > 2 * 1024 * 1024) {
                          setError(t("serverSettings.overview.iconTooLarge"));
                          return;
                        }
                        setError("");
                        setSuccess("");
                        try {
                          const buf = await file.arrayBuffer();
                          await api.uploadServerIcon(serverId, buf);
                          await useChatStore.getState().loadChannels();
                          setSuccess(t("serverSettings.overview.serverIconUpdated"));
                          setTimeout(() => setSuccess(""), 3000);
                        } catch (err: any) {
                          setError(err.message || t("serverSettings.overview.failedUploadIcon"));
                        }
                      };
                      input.click();
                    }}
                    title={t("serverSettings.overview.clickToUploadIcon")}
                  >
                    {server?.icon_url ? (
                      <img src={server.icon_url} alt={t("serverSettings.overview.serverIconAlt")} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>+</span>
                    )}
                  </div>
                  {server?.icon_url && (
                    <button
                      className="btn-secondary"
                      onClick={async () => {
                        setError("");
                        try {
                          await api.deleteServerIcon(serverId);
                          await useChatStore.getState().loadChannels();
                        } catch (err: any) {
                          setError(err.message || t("serverSettings.overview.failedRemoveIcon"));
                        }
                      }}
                    >
                      {t("serverSettings.overview.removeIcon")}
                    </button>
                  )}
                </div>
                {success && <span className="settings-success" style={{ color: "var(--green)", display: "block", marginTop: 8, fontSize: 13 }}>{success}</span>}
              </div>
            )}
            {tab === "overview" && canManageServer && (
              <div className="settings-section">
                <div className="settings-section-title">{t("serverSettings.overview.systemMessagesChannel")}</div>
                <p className="settings-description">
                  {t("serverSettings.overview.systemMessagesDesc")}
                </p>
                <select
                  className="settings-input"
                  value={systemChannelId ?? ""}
                  onChange={(e) => setSystemChannelId(e.target.value || null)}
                  style={{ marginBottom: 12 }}
                >
                  <option value="">{t("serverSettings.overview.systemChannelNone")}</option>
                  {serverChannels.map((ch) => {
                    const display = parseChannelDisplay(ch.encrypted_meta, "");
                    return (
                      <option key={ch.id} value={ch.id}>
                        #{display?.name ?? ch.id.slice(0, 8)}
                      </option>
                    );
                  })}
                </select>
                <button
                  className="btn-primary settings-save-btn"
                  onClick={async () => {
                    setError("");
                    try {
                      await api.updateServer(serverId, { system_channel_id: systemChannelId });
                      await useChatStore.getState().loadChannels();
                    } catch (err: any) {
                      setError(err.message || t("serverSettings.overview.failedUpdateServer"));
                    }
                  }}
                >
                  {t("serverSettings.overview.saveChanges")}
                </button>
              </div>
            )}

            {tab === "members" && (
              <div className="settings-section">
                <div className="settings-section-title">{t("serverSettings.members.title")} ({members.length})</div>
                <div className="server-settings-member-list">
                  {members.map((m) => (
                    <div key={m.user_id} className="server-member-row">
                      <Avatar
                        avatarUrl={m.avatar_url}
                        name={m.display_name || m.username}
                        size={32}
                      />
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
                              {t("serverSettings.members.roles")}
                            </button>
                          )}
                          {canKickMembers && (
                            <button
                              className="btn-ghost server-kick-btn"
                              onClick={() => setKickTarget({ userId: m.user_id, username: m.display_name || m.username })}
                            >
                              {t("serverSettings.members.kick")}
                            </button>
                          )}
                          {canBanMembers && (
                            <button
                              className="btn-ghost server-ban-btn"
                              onClick={() => setBanTarget({ userId: m.user_id, username: m.display_name || m.username })}
                            >
                              {t("serverSettings.members.ban")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "invites" && (canManageInvites || canCreateInvites) && (
              <div className="settings-section">
                <div className="settings-section-title">{t("serverSettings.invites.title")}</div>
                <div style={{ marginBottom: 16 }}>
                  <button className="btn-primary" onClick={handleCreateInvite}>
                    {t("serverSettings.invites.createInvite")}
                  </button>
                  {createdCode && (
                    <div className="invite-created" style={{ marginTop: 8 }}>
                      {t("serverSettings.invites.code")} <strong>{createdCode}</strong>
                      <button
                        className="btn-ghost"
                        onClick={() => navigator.clipboard.writeText(createdCode)}
                        style={{ marginLeft: 8 }}
                      >
                        {t("serverSettings.invites.copy")}
                      </button>
                    </div>
                  )}
                </div>

                {invites.map((inv) => (
                  <div key={inv.id} className="invite-row">
                    <div className="invite-code">{inv.code}</div>
                    <div className="invite-meta">
                      {t("serverSettings.invites.uses")} {inv.use_count}{inv.max_uses ? `/${inv.max_uses}` : ""}
                      {inv.expires_at && (
                        <span> | {t("serverSettings.invites.expires")} {new Date(inv.expires_at).toLocaleString()}</span>
                      )}
                    </div>
                    {canManageInvites && (
                      <button
                        className="btn-ghost"
                        onClick={() => handleDeleteInvite(inv.id)}
                      >
                        {t("serverSettings.invites.revoke")}
                      </button>
                    )}
                  </div>
                ))}
                {invites.length === 0 && (
                  <p className="settings-description">
                    {t("serverSettings.invites.emptyMessage")}
                  </p>
                )}
              </div>
            )}

            {tab === "categories" && canManageChannels && (
              <div className="settings-section">
                <div className="settings-section-title">{t("serverSettings.categories.title")}</div>
                <div className="dm-input-row" style={{ marginBottom: 16 }}>
                  <input
                    className="settings-input"
                    type="text"
                    placeholder={t("serverSettings.categories.placeholder")}
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateCategory()}
                  />
                  <button className="btn-primary" onClick={handleCreateCategory}>{t("serverSettings.categories.create")}</button>
                </div>

                {categories.map((cat) => (
                  <div key={cat.id} className="server-member-row">
                    {editingCatId === cat.id ? (
                      <div className="dm-input-row" style={{ flex: 1 }}>
                        <input
                          className="settings-input"
                          type="text"
                          value={editingCatName}
                          onChange={(e) => setEditingCatName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameCategory(cat.id);
                            if (e.key === "Escape") setEditingCatId(null);
                          }}
                          autoFocus
                        />
                        <button className="btn-primary" onClick={() => handleRenameCategory(cat.id)}>{t("serverSettings.categories.save")}</button>
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
                          {t("serverSettings.categories.rename")}
                        </button>
                        <button
                          className="btn-ghost server-kick-btn"
                          onClick={() => setDeleteCatTarget({ id: cat.id, name: cat.name })}
                        >
                          {t("serverSettings.categories.delete")}
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {categories.length === 0 && (
                  <p className="settings-description">
                    {t("serverSettings.categories.emptyMessage")}
                  </p>
                )}
              </div>
            )}

            {tab === "bans" && canBanMembers && (
              <div className="settings-section">
                <div className="settings-section-title">{t("serverSettings.bans.title")} ({bans.length})</div>
                {bans.map((ban) => (
                  <div key={ban.id} className="server-member-row">
                    <div className="server-member-avatar" style={{ background: "var(--red)" }}>
                      {ban.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="server-member-info">
                      <span className="server-member-name">{ban.username}</span>
                      {ban.reason && (
                        <span className="server-member-username">{t("serverSettings.bans.reason")} {ban.reason}</span>
                      )}
                      <span className="server-member-username">
                        {t("serverSettings.bans.banned")} {new Date(ban.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      className="btn-ghost"
                      onClick={() => handleRevokeBan(ban.user_id)}
                    >
                      {t("serverSettings.bans.revoke")}
                    </button>
                  </div>
                ))}
                {bans.length === 0 && (
                  <p className="settings-description">{t("serverSettings.bans.emptyMessage")}</p>
                )}
              </div>
            )}

            {tab === "roles" && canManageRoles && (
              <RoleSettings serverId={serverId} />
            )}

            {tab === "emoji" && canManageEmojis && (
              <div className="settings-section">
                <div className="settings-section-title">{t("serverSettings.emoji.title")}</div>
                <div className="emoji-slot-counters">
                  <span>{staticCount}/25 {t("serverSettings.emoji.staticSlots")}</span>
                  <span>{animatedCount}/10 {t("serverSettings.emoji.animatedSlots")}</span>
                </div>

                <input
                  ref={emojiFileRef}
                  type="file"
                  accept="image/png,image/gif,image/jpeg"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (emojiFileRef.current) emojiFileRef.current.value = "";
                    if (file.size > 256 * 1024) {
                      setError(t("serverSettings.emoji.emojiTooLarge"));
                      return;
                    }
                    // Auto-derive name from filename
                    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
                    const name = baseName.length >= 2 ? baseName : "emoji";
                    const preview = URL.createObjectURL(file);
                    setPendingEmoji({ file, preview, name });
                    setError("");
                  }}
                />

                {pendingEmoji ? (
                  <div className="emoji-pending-row">
                    <img src={pendingEmoji.preview} alt={t("serverSettings.emoji.previewAlt")} className="emoji-manage-img" />
                    <input
                      className="settings-input"
                      type="text"
                      placeholder={t("serverSettings.emoji.namePlaceholder")}
                      value={pendingEmoji.name}
                      onChange={(e) => { setPendingEmoji({ ...pendingEmoji, name: e.target.value }); setError(""); }}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn-primary"
                      disabled={emojiUploading}
                      onClick={async () => {
                        if (uploadingRef.current) return;
                        const name = pendingEmoji.name.trim();
                        if (!/^[a-zA-Z0-9_]{2,}$/.test(name)) {
                          setError(t("serverSettings.emoji.nameValidation"));
                          return;
                        }
                        if (serverEmojis.some((e) => e.name === name)) {
                          setError(t("serverSettings.emoji.nameExists"));
                          return;
                        }
                        setError("");
                        setEmojiUploading(true);
                        uploadingRef.current = true;
                        try {
                          const buf = await pendingEmoji.file.arrayBuffer();
                          await api.uploadEmoji(serverId, name, buf);
                          URL.revokeObjectURL(pendingEmoji.preview);
                          setPendingEmoji(null);
                        } catch (err: any) {
                          setError(err.message || t("serverSettings.emoji.failedUpload"));
                        } finally {
                          setEmojiUploading(false);
                          uploadingRef.current = false;
                        }
                      }}
                    >
                      {emojiUploading ? t("serverSettings.emoji.saving") : t("serverSettings.emoji.save")}
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        URL.revokeObjectURL(pendingEmoji.preview);
                        setPendingEmoji(null);
                        setError("");
                      }}
                    >
                      {t("serverSettings.emoji.cancel")}
                    </button>
                  </div>
                ) : (
                  <div className="emoji-upload-row">
                    <button
                      className="btn-primary"
                      disabled={emojiUploading}
                      onClick={() => emojiFileRef.current?.click()}
                    >
                      {t("serverSettings.emoji.uploadEmoji")}
                    </button>
                  </div>
                )}

                {serverEmojis.length > 0 ? (
                  <div className="emoji-manage-table">
                    <div className="emoji-manage-header emoji-manage-4col">
                      <span>{t("serverSettings.emoji.tableImage")}</span>
                      <span>{t("serverSettings.emoji.tableName")}</span>
                      <span>{t("serverSettings.emoji.tableUploadedBy")}</span>
                      <span></span>
                    </div>
                    {serverEmojis.map((emoji) => (
                      <div key={emoji.id} className="emoji-manage-row emoji-manage-4col">
                        <img
                          src={emoji.image_url}
                          alt={emoji.name}
                          className="emoji-manage-img"
                        />
                        <span className="emoji-manage-name">
                          :{emoji.name}:
                          {emoji.animated && (
                            <span className="emoji-manage-badge">{t("serverSettings.emoji.animated")}</span>
                          )}
                        </span>
                        <span className="emoji-manage-uploader">
                          {emoji.uploaded_by ? (userNames[emoji.uploaded_by] ?? t("serverSettings.emoji.unknown")) : "\u2014"}
                        </span>
                        <button
                          className="btn-ghost server-kick-btn"
                          onClick={() => setDeleteEmojiTarget({ id: emoji.id, name: emoji.name })}
                        >
                          {t("serverSettings.categories.delete")}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="settings-description" style={{ marginTop: 16 }}>
                    {t("serverSettings.emoji.emptyMessage")}
                  </p>
                )}
              </div>
            )}

            {tab === "audit" && canViewAuditLog && (
              <div className="settings-section">
                <div className="settings-section-title">{t("serverSettings.audit.title")}</div>
                {auditLoading && auditEntries.length === 0 && (
                  <p className="settings-description">{t("serverSettings.audit.loading")}</p>
                )}
                {auditEntries.length === 0 && !auditLoading && (
                  <p className="settings-description">{t("serverSettings.audit.emptyMessage")}</p>
                )}
                <div className="audit-log-list">
                  {auditEntries.map((entry) => (
                    <div key={entry.id} className="audit-log-entry">
                      <div className="audit-log-entry-header">
                        <span className="audit-log-actor">{entry.actor_username}</span>
                        <span className="audit-log-action">{formatAuditAction(entry.action)}</span>
                        {entry.target_type && (
                          <span className="audit-log-target">
                            {entry.target_type}{entry.target_id ? ` ${entry.target_id.slice(0, 8)}` : ""}
                          </span>
                        )}
                      </div>
                      {entry.reason && (
                        <div className="audit-log-reason">{t("serverSettings.audit.reason")} {entry.reason}</div>
                      )}
                      {entry.changes && Object.keys(entry.changes).length > 0 && (
                        <div className="audit-log-changes">
                          {Object.entries(entry.changes).map(([key, val]) => (
                            <span key={key} className="audit-log-change">
                              {key}: {typeof val === "string" ? val : JSON.stringify(val)}
                            </span>
                          ))}
                        </div>
                      )}
                      <time className="audit-log-time">
                        {new Date(entry.created_at).toLocaleString()}
                      </time>
                    </div>
                  ))}
                </div>
                {auditHasMore && auditEntries.length > 0 && (
                  <button
                    className="btn-ghost"
                    style={{ marginTop: 12 }}
                    disabled={auditLoading}
                    onClick={async () => {
                      setAuditLoading(true);
                      try {
                        const last = auditEntries[auditEntries.length - 1];
                        const more = await api.getAuditLog(serverId, { limit: 50, before: last.id });
                        setAuditEntries((prev) => [...prev, ...more]);
                        setAuditHasMore(more.length >= 50);
                      } catch {
                        setError(t("serverSettings.audit.failedLoadMore"));
                      } finally {
                        setAuditLoading(false);
                      }
                    }}
                  >
                    {auditLoading ? t("serverSettings.audit.loading") : t("serverSettings.audit.loadMore")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Kick confirmation */}
      {kickTarget && (
        <ConfirmDialog
          title={t("serverSettings.confirm.kickTitle")}
          message={t("serverSettings.confirm.kickMessage", { username: kickTarget.username })}
          confirmLabel={t("serverSettings.confirm.kickLabel")}
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
            loadData();
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
          title={t("serverSettings.confirm.deleteCategoryTitle")}
          message={t("serverSettings.confirm.deleteCategoryMessage", { name: deleteCatTarget.name })}
          confirmLabel={t("serverSettings.confirm.deleteCategoryLabel")}
          danger
          onConfirm={() => handleDeleteCategory(deleteCatTarget.id)}
          onCancel={() => setDeleteCatTarget(null)}
        />
      )}

      {/* Delete emoji confirmation */}
      {deleteEmojiTarget && (
        <ConfirmDialog
          title={t("serverSettings.confirm.deleteEmojiTitle")}
          message={t("serverSettings.confirm.deleteEmojiMessage", { name: deleteEmojiTarget.name })}
          confirmLabel={t("serverSettings.confirm.deleteEmojiLabel")}
          danger
          onConfirm={async () => {
            try {
              await api.deleteEmoji(serverId, deleteEmojiTarget.id);
              setDeleteEmojiTarget(null);
            } catch (err: any) {
              setError(err.message || t("serverSettings.emoji.failedDelete"));
              setDeleteEmojiTarget(null);
            }
          }}
          onCancel={() => setDeleteEmojiTarget(null)}
        />
      )}
    </>
  );
}
