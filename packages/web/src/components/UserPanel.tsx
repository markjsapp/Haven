import { useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { usePresenceStore, STATUS_CONFIG } from "../store/presence.js";
import { useUiStore } from "../store/ui.js";
import Avatar from "./Avatar.js";
import StatusSelector from "./StatusSelector.js";
import CustomStatusModal from "./CustomStatusModal.js";

export default function UserPanel() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const ownStatus = usePresenceStore((s) => s.ownStatus);
  const setShowUserSettings = useUiStore((s) => s.setShowUserSettings);
  const [showStatusSelector, setShowStatusSelector] = useState(false);
  const [showCustomStatus, setShowCustomStatus] = useState(false);

  if (!user) return null;

  const statusConfig = STATUS_CONFIG[ownStatus] || STATUS_CONFIG.online;

  return (
    <div className="user-panel">
      <div className="user-panel-avatar-wrap" onClick={() => setShowStatusSelector((v) => !v)}>
        <Avatar
          avatarUrl={user.avatar_url}
          name={user.display_name || user.username}
          size={32}
          className="user-panel-avatar"
        />
        <span
          className="user-panel-status"
          style={{ backgroundColor: statusConfig.color }}
        />
      </div>
      <div className="user-panel-info">
        <span className="user-panel-name">{user.display_name || user.username}</span>
        {user.custom_status ? (
          <span className="user-panel-custom-status" onClick={() => setShowCustomStatus(true)} title="Edit custom status">
            {user.custom_status_emoji && <span>{user.custom_status_emoji} </span>}
            {user.custom_status}
          </span>
        ) : (
          <span className="user-panel-tag" onClick={() => setShowCustomStatus(true)} title="Set a custom status">
            {statusConfig.label}
          </span>
        )}
      </div>
      <div className="user-panel-actions">
        <button
          className="user-panel-btn"
          onClick={() => setShowUserSettings(true)}
          title="User Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" />
          </svg>
        </button>
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

      {showStatusSelector && (
        <StatusSelector onClose={() => setShowStatusSelector(false)} />
      )}

      {showCustomStatus && (
        <CustomStatusModal
          initialStatus={user.custom_status}
          initialEmoji={user.custom_status_emoji}
          onClose={() => setShowCustomStatus(false)}
        />
      )}
    </div>
  );
}
