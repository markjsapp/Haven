import { useEffect, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { Permission, type RoleResponse, type OverwriteResponse } from "@haven/core";

const CHANNEL_PERMS: Array<{ key: keyof typeof Permission; label: string }> = [
  { key: "VIEW_CHANNELS", label: "View Channel" },
  { key: "SEND_MESSAGES", label: "Send Messages" },
  { key: "MANAGE_MESSAGES", label: "Manage Messages" },
  { key: "ADD_REACTIONS", label: "Add Reactions" },
  { key: "ATTACH_FILES", label: "Attach Files" },
  { key: "READ_MESSAGE_HISTORY", label: "Read Message History" },
  { key: "MENTION_EVERYONE", label: "Mention @everyone" },
];

type TriState = "inherit" | "allow" | "deny";

interface Props {
  channelId: string;
  serverId: string;
  onClose: () => void;
  /** When true, renders content only (no overlay/modal wrapper). */
  embedded?: boolean;
}

export default function ChannelPermissionsEditor({ channelId, serverId, onClose, embedded }: Props) {
  const api = useAuthStore((s) => s.api);
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [overwrites, setOverwrites] = useState<OverwriteResponse[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Local edit state: role_id -> { perm_key -> tri-state }
  const [editState, setEditState] = useState<Record<string, Record<string, TriState>>>({});

  useEffect(() => {
    loadData();
  }, [channelId, serverId]);

  async function loadData() {
    try {
      const [r, ow] = await Promise.all([
        api.listRoles(serverId),
        api.listOverwrites(channelId),
      ]);
      setRoles(r);
      setOverwrites(ow);

      // Build edit state from existing overwrites
      const state: Record<string, Record<string, TriState>> = {};
      for (const role of r) {
        const overwrite = ow.find((o) => o.target_type === "role" && o.target_id === role.id);
        const perms: Record<string, TriState> = {};
        for (const { key } of CHANNEL_PERMS) {
          const bit = Permission[key];
          if (overwrite) {
            const allow = BigInt(overwrite.allow_bits);
            const deny = BigInt(overwrite.deny_bits);
            if ((allow & bit) !== BigInt(0)) perms[key] = "allow";
            else if ((deny & bit) !== BigInt(0)) perms[key] = "deny";
            else perms[key] = "inherit";
          } else {
            perms[key] = "inherit";
          }
        }
        state[role.id] = perms;
      }
      setEditState(state);
      if (r.length > 0 && !selectedRoleId) setSelectedRoleId(r[0].id);
    } catch (err: any) {
      setError(err.message || "Failed to load permissions");
    }
  }

  function cyclePerm(roleId: string, permKey: string) {
    setEditState((prev) => {
      const rolePerms = { ...prev[roleId] };
      const current = rolePerms[permKey] || "inherit";
      const next: TriState = current === "inherit" ? "allow" : current === "allow" ? "deny" : "inherit";
      rolePerms[permKey] = next;
      return { ...prev, [roleId]: rolePerms };
    });
  }

  async function handleSave(roleId: string) {
    const perms = editState[roleId];
    if (!perms) return;

    let allowBits = BigInt(0);
    let denyBits = BigInt(0);
    for (const { key } of CHANNEL_PERMS) {
      const bit = Permission[key];
      if (perms[key] === "allow") allowBits |= bit;
      else if (perms[key] === "deny") denyBits |= bit;
    }

    setSaving(true);
    setError("");
    try {
      // If everything is inherit, delete the overwrite
      if (allowBits === BigInt(0) && denyBits === BigInt(0)) {
        const existing = overwrites.find((o) => o.target_type === "role" && o.target_id === roleId);
        if (existing) {
          await api.deleteOverwrite(channelId, "role", roleId);
          setOverwrites((prev) => prev.filter((o) => o.id !== existing.id));
        }
      } else {
        const result = await api.setOverwrite(channelId, {
          target_type: "role",
          target_id: roleId,
          allow_bits: allowBits.toString(),
          deny_bits: denyBits.toString(),
        });
        setOverwrites((prev) => {
          const idx = prev.findIndex((o) => o.target_type === "role" && o.target_id === roleId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = result;
            return next;
          }
          return [...prev, result];
        });
      }
    } catch (err: any) {
      setError(err.message || "Failed to save permissions");
    } finally {
      setSaving(false);
    }
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const selectedPerms = selectedRoleId ? editState[selectedRoleId] : null;

  const content = (
    <div className="role-settings">
      <div className="role-settings-sidebar">
        {roles.map((role) => {
          const hasOverwrite = overwrites.some((o) => o.target_type === "role" && o.target_id === role.id);
          return (
            <button
              key={role.id}
              className={`role-list-item ${selectedRoleId === role.id ? "active" : ""}`}
              onClick={() => setSelectedRoleId(role.id)}
            >
              {role.color && (
                <span className="role-dot" style={{ background: role.color }} />
              )}
              <span>{role.name}</span>
              {hasOverwrite && <span className="overwrite-indicator">*</span>}
            </button>
          );
        })}
      </div>

      <div className="role-settings-main">
        {error && <div className="error-small" style={{ marginBottom: 8 }}>{error}</div>}

        {selectedRole && selectedPerms ? (
          <>
            <div style={{ marginBottom: 12, fontSize: 13, color: "var(--text-muted)" }}>
              Set permission overwrites for <strong>{selectedRole.name}</strong> in this channel.
              Click a cell to cycle: Inherit &rarr; Allow &rarr; Deny.
            </div>

            <div className="perm-grid">
              {CHANNEL_PERMS.map(({ key, label }) => {
                const state = selectedPerms[key] || "inherit";
                return (
                  <div key={key} className="perm-overwrite-row">
                    <span className="perm-overwrite-label">{label}</span>
                    <button
                      type="button"
                      className={`perm-tri-btn perm-tri-${state}`}
                      onClick={() => cyclePerm(selectedRole.id, key)}
                    >
                      {state === "allow" ? "Allow" : state === "deny" ? "Deny" : "—"}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="profile-edit-actions" style={{ marginTop: 12 }}>
              <button
                className="btn-primary"
                onClick={() => handleSave(selectedRole.id)}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </>
        ) : (
          <div style={{ color: "var(--text-muted)", padding: 16 }}>
            Select a role to configure its channel permissions.
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) return content;

  return (
    <div className="server-settings-overlay" onClick={onClose} role="presentation">
      <div className="server-settings-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Channel Permissions">
        <div className="server-settings-header">
          <h3>Channel Permissions</h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        {content}
      </div>
    </div>
  );
}
