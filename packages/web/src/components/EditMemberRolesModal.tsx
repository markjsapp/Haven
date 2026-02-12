import { useEffect, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import type { RoleResponse } from "@haven/core";

interface Props {
  serverId: string;
  userId: string;
  username: string;
  onClose: () => void;
}

export default function EditMemberRolesModal({ serverId, userId, username, onClose }: Props) {
  const api = useAuthStore((s) => s.api);
  const [allRoles, setAllRoles] = useState<RoleResponse[]>([]);
  const [memberRoleIds, setMemberRoleIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadRolesAndMember();
  }, [serverId, userId]);

  async function loadRolesAndMember() {
    try {
      const [roles, profile] = await Promise.all([
        api.listRoles(serverId),
        api.getUserProfile(userId, serverId),
      ]);
      setAllRoles(roles.filter((r) => !r.is_default));
      setMemberRoleIds(new Set((profile.roles || []).map((r) => r.id)));
    } catch (err: any) {
      setError(err.message || "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }

  async function toggleRole(roleId: string) {
    const has = memberRoleIds.has(roleId);
    setError("");
    try {
      if (has) {
        await api.unassignRole(serverId, userId, roleId);
        setMemberRoleIds((prev) => {
          const next = new Set(prev);
          next.delete(roleId);
          return next;
        });
      } else {
        await api.assignRole(serverId, userId, { role_id: roleId });
        setMemberRoleIds((prev) => new Set(prev).add(roleId));
      }
    } catch (err: any) {
      setError(err.message || "Failed to update role");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog edit-roles-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Edit Roles</h3>
        <p className="edit-roles-subtitle">Manage roles for <strong>{username}</strong></p>

        {error && <div className="error-small">{error}</div>}

        {loading ? (
          <div className="edit-roles-loading">Loading roles...</div>
        ) : allRoles.length === 0 ? (
          <div className="edit-roles-empty">No roles to assign. Create roles first.</div>
        ) : (
          <div className="edit-roles-list">
            {allRoles.map((role) => (
              <label key={role.id} className="edit-roles-item">
                <input
                  type="checkbox"
                  checked={memberRoleIds.has(role.id)}
                  onChange={() => toggleRole(role.id)}
                />
                {role.color && (
                  <span className="role-dot" style={{ background: role.color }} />
                )}
                <span>{role.name}</span>
              </label>
            ))}
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn-primary modal-submit" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
