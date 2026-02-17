import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import type { RoleResponse } from "@haven/core";

interface Props {
  serverId: string;
  userId: string;
  username: string;
  onClose: () => void;
  onChanged?: () => void;
}

export default function EditMemberRolesModal({ serverId, userId, username, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [allRoles, setAllRoles] = useState<RoleResponse[]>([]);
  const [memberRoleIds, setMemberRoleIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedRoleId, setSavedRoleId] = useState<string | null>(null);

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
      setError(err.message || t("editMemberRoles.loadFailed"));
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
      // Refresh current user's permissions & member lists
      useChatStore.getState().refreshPermissions(serverId);
      useChatStore.getState().loadChannels();
      onChanged?.();
      setSavedRoleId(roleId);
      setTimeout(() => setSavedRoleId(null), 1500);
    } catch (err: any) {
      setError(err.message || t("editMemberRoles.updateFailed"));
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-dialog edit-roles-modal" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-roles-title">
        <h3 className="modal-title" id="edit-roles-title">{t("editMemberRoles.title")}</h3>
        <p className="edit-roles-subtitle">{t("editMemberRoles.subtitle", { username })}</p>

        {error && <div className="error-small">{error}</div>}

        {loading ? (
          <div className="edit-roles-loading">{t("editMemberRoles.loadingRoles")}</div>
        ) : allRoles.length === 0 ? (
          <div className="edit-roles-empty">{t("editMemberRoles.noRoles")}</div>
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
                {savedRoleId === role.id && (
                  <span className="role-saved-indicator">{t("editMemberRoles.updated")}</span>
                )}
              </label>
            ))}
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn-primary modal-submit" onClick={onClose}>
            {t("editMemberRoles.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
