import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore, useIsAdmin } from "../store/auth.js";
import type { AdminStats, AdminUserResponse } from "@haven/core";

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const isAdmin = useIsAdmin();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"stats" | "users">("stats");

  const loadStats = useCallback(async () => {
    try {
      const s = await api.getAdminStats();
      setStats(s);
    } catch {
      setError(t("adminPanel.errors.failedLoadStats"));
    }
  }, [api]);

  const loadUsers = useCallback(async (q?: string) => {
    try {
      const u = await api.listAdminUsers(q || undefined, 50, 0);
      setUsers(u);
    } catch {
      setError(t("adminPanel.errors.failedLoadUsers"));
    }
  }, [api]);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    Promise.all([loadStats(), loadUsers()]).finally(() => setLoading(false));
  }, [isAdmin, loadStats, loadUsers]);

  const handleSearch = useCallback(() => {
    loadUsers(search);
  }, [search, loadUsers]);

  const toggleAdmin = useCallback(async (userId: string, currentlyAdmin: boolean) => {
    try {
      await api.setUserAdmin(userId, !currentlyAdmin);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, is_instance_admin: !currentlyAdmin } : u
        )
      );
    } catch {
      setError(t("adminPanel.errors.failedUpdateAdmin"));
    }
  }, [api]);

  const deleteUser = useCallback(async (userId: string, username: string) => {
    if (!confirm(t("adminPanel.users.deleteConfirm", { username }))) return;
    try {
      await api.adminDeleteUser(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      // Refresh stats
      loadStats();
    } catch {
      setError(t("adminPanel.errors.failedDeleteUser"));
    }
  }, [api, loadStats]);

  if (!isAdmin) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="admin-panel" onClick={(e) => e.stopPropagation()}>
        <div className="admin-panel-header">
          <h2>{t("adminPanel.title")}</h2>
          <button className="admin-close-btn" onClick={onClose} aria-label={t("adminPanel.closeAriaLabel")}>
            &times;
          </button>
        </div>

        <div className="admin-tabs">
          <button
            className={`admin-tab ${tab === "stats" ? "active" : ""}`}
            onClick={() => setTab("stats")}
          >
            {t("adminPanel.tab.overview")}
          </button>
          <button
            className={`admin-tab ${tab === "users" ? "active" : ""}`}
            onClick={() => setTab("users")}
          >
            {t("adminPanel.tab.users")}
          </button>
        </div>

        {error && <div className="settings-error" style={{ padding: "0 24px" }}>{error}</div>}

        {loading ? (
          <div className="admin-loading">{t("adminPanel.loading")}</div>
        ) : tab === "stats" ? (
          <div className="admin-stats">
            <div className="admin-stat-card">
              <span className="admin-stat-value">{stats?.total_users ?? 0}</span>
              <span className="admin-stat-label">{t("adminPanel.stats.users")}</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{stats?.total_servers ?? 0}</span>
              <span className="admin-stat-label">{t("adminPanel.stats.servers")}</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{stats?.total_channels ?? 0}</span>
              <span className="admin-stat-label">{t("adminPanel.stats.channels")}</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{stats?.total_messages ?? 0}</span>
              <span className="admin-stat-label">{t("adminPanel.stats.messages")}</span>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-value">{stats?.active_connections ?? 0}</span>
              <span className="admin-stat-label">{t("adminPanel.stats.activeConnections")}</span>
            </div>
          </div>
        ) : (
          <div className="admin-users">
            <div className="admin-search-row">
              <input
                className="settings-input"
                type="text"
                placeholder={t("adminPanel.users.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <button className="btn-primary" onClick={handleSearch}>{t("adminPanel.users.search")}</button>
            </div>
            <div className="admin-user-list">
              {users.map((u) => (
                <div key={u.id} className="admin-user-row">
                  <div className="admin-user-info">
                    {u.avatar_url ? (
                      <img className="admin-user-avatar" src={u.avatar_url} alt="" />
                    ) : (
                      <div className="admin-user-avatar admin-user-avatar-placeholder">
                        {(u.display_name || u.username).charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="admin-user-details">
                      <span className="admin-user-name">
                        {u.display_name || u.username}
                        {u.is_instance_admin && <span className="admin-badge">{t("adminPanel.users.adminBadge")}</span>}
                      </span>
                      <span className="admin-user-meta">
                        @{u.username} &middot; {u.server_count} server{u.server_count !== 1 ? "s" : ""} &middot; {t("adminPanel.users.joined")} {new Date(u.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="admin-user-actions">
                    {u.id !== currentUserId && (
                      <>
                        <button
                          className={`btn-small ${u.is_instance_admin ? "btn-danger-outline" : "btn-primary-outline"}`}
                          onClick={() => toggleAdmin(u.id, u.is_instance_admin)}
                        >
                          {u.is_instance_admin ? t("adminPanel.users.revokeAdmin") : t("adminPanel.users.grantAdmin")}
                        </button>
                        <button
                          className="btn-small btn-danger"
                          onClick={() => deleteUser(u.id, u.username)}
                        >
                          {t("adminPanel.users.delete")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {users.length === 0 && (
                <div className="admin-empty">{t("adminPanel.users.noUsersFound")}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
