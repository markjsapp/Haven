import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { Permission, type RoleResponse } from "@haven/core";
import ConfirmDialog from "./ConfirmDialog.js";

const PRESET_COLORS = [
  // Row 1 -- bright
  "#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#e91e63",
  "#e74c3c", "#f1c40f", "#e67e22", "#fd7e72", "#607d8b",
  // Row 2 -- dark
  "#11806a", "#1f8b4c", "#206694", "#71368a", "#ad1457",
  "#992d22", "#c27c0e", "#a84300", "#c0392b", "#95a5a6",
];

const PERM_LABEL_KEYS: Array<{ key: keyof typeof Permission; labelKey: string }> = [
  { key: "ADMINISTRATOR", labelKey: "roleSettings.perm.administrator" },
  { key: "MANAGE_SERVER", labelKey: "roleSettings.perm.manageServer" },
  { key: "MANAGE_ROLES", labelKey: "roleSettings.perm.manageRoles" },
  { key: "MANAGE_CHANNELS", labelKey: "roleSettings.perm.manageChannels" },
  { key: "KICK_MEMBERS", labelKey: "roleSettings.perm.kickMembers" },
  { key: "BAN_MEMBERS", labelKey: "roleSettings.perm.banMembers" },
  { key: "MANAGE_MESSAGES", labelKey: "roleSettings.perm.manageMessages" },
  { key: "VIEW_CHANNELS", labelKey: "roleSettings.perm.viewChannels" },
  { key: "SEND_MESSAGES", labelKey: "roleSettings.perm.sendMessages" },
  { key: "CREATE_INVITES", labelKey: "roleSettings.perm.createInvites" },
  { key: "MANAGE_INVITES", labelKey: "roleSettings.perm.manageInvites" },
  { key: "ADD_REACTIONS", labelKey: "roleSettings.perm.addReactions" },
  { key: "MENTION_EVERYONE", labelKey: "roleSettings.perm.mentionEveryone" },
  { key: "ATTACH_FILES", labelKey: "roleSettings.perm.attachFiles" },
  { key: "READ_MESSAGE_HISTORY", labelKey: "roleSettings.perm.readMessageHistory" },
];

interface Props {
  serverId: string;
}

export default function RoleSettings({ serverId }: Props) {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<bigint>(BigInt(0));
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);

  useEffect(() => {
    loadRoles();
  }, [serverId]);

  async function loadRoles() {
    try {
      const r = await api.listRoles(serverId);
      setRoles(r);
    } catch (err: any) {
      setError(err.message || t("roleSettings.failedLoad"));
    }
  }

  function selectRole(role: RoleResponse) {
    setSelectedRoleId(role.id);
    setEditName(role.name);
    setEditColor(role.color || "");
    setEditPerms(BigInt(role.permissions));
    setError("");
  }

  function togglePerm(perm: bigint) {
    setEditPerms((prev) => (prev & perm) !== BigInt(0) ? prev & ~perm : prev | perm);
  }

  async function handleSave() {
    if (!selectedRoleId) return;
    setError("");
    try {
      const updated = await api.updateRole(serverId, selectedRoleId, {
        name: editName || undefined,
        color: editColor,
        permissions: editPerms.toString(),
      });
      setRoles((prev) => prev.map((r) => (r.id === selectedRoleId ? updated : r)));
      useChatStore.getState().refreshPermissions(serverId);
      useChatStore.getState().loadChannels();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || t("roleSettings.failedUpdate"));
    }
  }

  async function handleCreate() {
    if (!newRoleName.trim()) return;
    setError("");
    try {
      const role = await api.createRole(serverId, {
        name: newRoleName.trim(),
        position: roles.length,
      });
      setRoles((prev) => [...prev, role]);
      setNewRoleName("");
      useChatStore.getState().loadChannels();
    } catch (err: any) {
      setError(err.message || t("roleSettings.failedCreate"));
    }
  }

  async function handleDelete(roleId: string) {
    setError("");
    try {
      await api.deleteRole(serverId, roleId);
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      if (selectedRoleId === roleId) setSelectedRoleId(null);
      setDeletingRoleId(null);
      useChatStore.getState().refreshPermissions(serverId);
      useChatStore.getState().loadChannels();
    } catch (err: any) {
      setError(err.message || t("roleSettings.failedDelete"));
    }
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  return (
    <div className="role-settings">
      <div className="role-settings-sidebar">
        <div className="dm-input-row" style={{ padding: "0 0 8px 0" }}>
          <input
            type="text"
            placeholder={t("roleSettings.newRolePlaceholder")}
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button className="btn-small" onClick={handleCreate}>{t("roleSettings.create")}</button>
        </div>

        {roles.map((role) => (
          <button
            key={role.id}
            className={`role-list-item ${selectedRoleId === role.id ? "active" : ""}`}
            onClick={() => selectRole(role)}
          >
            {role.color && (
              <span className="role-dot" style={{ background: role.color }} />
            )}
            <span>{role.name}</span>
          </button>
        ))}
      </div>

      <div className="role-settings-main">
        {error && <div className="error-small" style={{ marginBottom: 8 }}>{error}</div>}

        {selectedRole ? (
          <>
            <div className="role-edit-header">
              <label className="profile-edit-label">
                {t("roleSettings.roleName")}
                <input
                  className="profile-edit-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={selectedRole.is_default}
                />
              </label>
            </div>

            <div className="role-color-section">
              <div className="role-color-title">{t("roleSettings.roleColor")}</div>
              <p className="role-color-desc">
                {t("roleSettings.roleColorDesc")}
              </p>
              <div className="role-color-swatches">
                <button
                  className={`role-color-swatch role-color-default ${!editColor ? "selected" : ""}`}
                  onClick={() => setEditColor("")}
                  title={t("roleSettings.defaultColor")}
                >
                  {!editColor && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  )}
                </button>
                <button
                  className={`role-color-swatch role-color-custom ${editColor && !PRESET_COLORS.includes(editColor) ? "selected" : ""}`}
                  onClick={() => colorInputRef.current?.click()}
                  style={editColor && !PRESET_COLORS.includes(editColor) ? { backgroundColor: editColor } : undefined}
                  title={t("roleSettings.customColor")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.33a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.83z" />
                  </svg>
                </button>
                <input
                  ref={colorInputRef}
                  type="color"
                  className="role-color-hidden-input"
                  value={editColor || "#000000"}
                  onChange={(e) => setEditColor(e.target.value)}
                />
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`role-color-swatch ${editColor === color ? "selected" : ""}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setEditColor(color)}
                    title={color}
                  >
                    {editColor === color && (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="perm-grid">
              {PERM_LABEL_KEYS.map(({ key, labelKey }) => {
                const bit = Permission[key];
                const checked = (editPerms & bit) !== BigInt(0);
                return (
                  <label key={key} className="perm-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePerm(bit)}
                    />
                    <span>{t(labelKey)}</span>
                  </label>
                );
              })}
            </div>

            <div className="profile-edit-actions" style={{ marginTop: 12 }}>
              {!selectedRole.is_default && (
                <button
                  className="btn-danger"
                  onClick={() => setDeletingRoleId(selectedRole.id)}
                >
                  {t("roleSettings.delete")}
                </button>
              )}
              <button className={`btn-primary ${saved ? "btn-saved" : ""}`} onClick={handleSave}>
                {saved ? t("roleSettings.saved") : t("roleSettings.saveChanges")}
              </button>
            </div>
          </>
        ) : (
          <div style={{ color: "var(--text-muted)", padding: 16 }}>
            {t("roleSettings.selectRoleHint")}
          </div>
        )}
      </div>

      {deletingRoleId && (
        <ConfirmDialog
          title={t("roleSettings.confirm.deleteTitle")}
          message={t("roleSettings.confirm.deleteMessage", { name: roles.find((r) => r.id === deletingRoleId)?.name })}
          confirmLabel={t("roleSettings.confirm.deleteLabel")}
          danger
          onConfirm={() => handleDelete(deletingRoleId)}
          onCancel={() => setDeletingRoleId(null)}
        />
      )}
    </div>
  );
}
