import { useEffect, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { Permission, type RoleResponse } from "@haven/core";
import ConfirmDialog from "./ConfirmDialog.js";

const PERM_LABELS: Array<{ key: keyof typeof Permission; label: string }> = [
  { key: "ADMINISTRATOR", label: "Administrator" },
  { key: "MANAGE_SERVER", label: "Manage Server" },
  { key: "MANAGE_ROLES", label: "Manage Roles" },
  { key: "MANAGE_CHANNELS", label: "Manage Channels" },
  { key: "KICK_MEMBERS", label: "Kick Members" },
  { key: "BAN_MEMBERS", label: "Ban Members" },
  { key: "MANAGE_MESSAGES", label: "Manage Messages" },
  { key: "VIEW_CHANNELS", label: "View Channels" },
  { key: "SEND_MESSAGES", label: "Send Messages" },
  { key: "CREATE_INVITES", label: "Create Invites" },
  { key: "MANAGE_INVITES", label: "Manage Invites" },
  { key: "ADD_REACTIONS", label: "Add Reactions" },
  { key: "MENTION_EVERYONE", label: "Mention @everyone" },
  { key: "ATTACH_FILES", label: "Attach Files" },
  { key: "READ_MESSAGE_HISTORY", label: "Read Message History" },
];

interface Props {
  serverId: string;
}

export default function RoleSettings({ serverId }: Props) {
  const api = useAuthStore((s) => s.api);
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<bigint>(BigInt(0));
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [error, setError] = useState("");
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);

  useEffect(() => {
    loadRoles();
  }, [serverId]);

  async function loadRoles() {
    try {
      const r = await api.listRoles(serverId);
      setRoles(r);
    } catch (err: any) {
      setError(err.message || "Failed to load roles");
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
        color: editColor || undefined,
        permissions: editPerms.toString(),
      });
      setRoles((prev) => prev.map((r) => (r.id === selectedRoleId ? updated : r)));
      useChatStore.getState().loadChannels();
    } catch (err: any) {
      setError(err.message || "Failed to update role");
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
      setError(err.message || "Failed to create role");
    }
  }

  async function handleDelete(roleId: string) {
    setError("");
    try {
      await api.deleteRole(serverId, roleId);
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      if (selectedRoleId === roleId) setSelectedRoleId(null);
      setDeletingRoleId(null);
      useChatStore.getState().loadChannels();
    } catch (err: any) {
      setError(err.message || "Failed to delete role");
    }
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  return (
    <div className="role-settings">
      <div className="role-settings-sidebar">
        <div className="dm-input-row" style={{ padding: "0 0 8px 0" }}>
          <input
            type="text"
            placeholder="New role..."
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button className="btn-small" onClick={handleCreate}>Create</button>
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
                Role Name
                <input
                  className="profile-edit-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={selectedRole.is_default}
                />
              </label>
              <label className="profile-edit-label">
                Color
                <input
                  className="profile-edit-input"
                  type="text"
                  placeholder="#ff0000"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                />
              </label>
            </div>

            <div className="perm-grid">
              {PERM_LABELS.map(({ key, label }) => {
                const bit = Permission[key];
                const checked = (editPerms & bit) !== BigInt(0);
                return (
                  <label key={key} className="perm-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePerm(bit)}
                    />
                    <span>{label}</span>
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
                  Delete
                </button>
              )}
              <button className="btn-primary" onClick={handleSave}>
                Save Changes
              </button>
            </div>
          </>
        ) : (
          <div style={{ color: "var(--text-muted)", padding: 16 }}>
            Select a role to edit its permissions.
          </div>
        )}
      </div>

      {deletingRoleId && (
        <ConfirmDialog
          title="Delete Role"
          message={`Delete the role "${roles.find((r) => r.id === deletingRoleId)?.name}"? Members will lose permissions from this role.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDelete(deletingRoleId)}
          onCancel={() => setDeletingRoleId(null)}
        />
      )}
    </div>
  );
}
