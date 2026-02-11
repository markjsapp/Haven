import { useAuthStore } from "../store/auth.js";

export default function UserPanel() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  if (!user) return null;

  return (
    <div className="user-panel">
      <div className="user-panel-avatar-wrap">
        <div className="user-panel-avatar">
          {user.username.charAt(0).toUpperCase()}
        </div>
        <span className="user-panel-status online" />
      </div>
      <div className="user-panel-info">
        <span className="user-panel-name">{user.display_name || user.username}</span>
        <span className="user-panel-tag">Online</span>
      </div>
      <div className="user-panel-actions">
        <button
          className="user-panel-btn logout-btn"
          onClick={logout}
          title="Log Out"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
