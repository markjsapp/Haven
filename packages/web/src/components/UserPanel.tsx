import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { usePresenceStore, STATUS_CONFIG } from "../store/presence.js";
import { useUiStore } from "../store/ui.js";
import { useVoiceStore } from "../store/voice.js";
import { parseChannelDisplay } from "../lib/channel-utils.js";
import Avatar from "./Avatar.js";
import StatusSelector from "./StatusSelector.js";
import CustomStatusModal from "./CustomStatusModal.js";

export default function UserPanel() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const ownStatus = usePresenceStore((s) => s.ownStatus);
  const setShowUserSettings = useUiStore((s) => s.setShowUserSettings);
  const setShowAdminPanel = useUiStore((s) => s.setShowAdminPanel);
  const isAdmin = user?.is_instance_admin === true;
  const voiceConnectionState = useVoiceStore((s) => s.connectionState);
  const voiceChannelId = useVoiceStore((s) => s.currentChannelId);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);
  const channels = useChatStore((s) => s.channels);
  const [showStatusSelector, setShowStatusSelector] = useState(false);
  const [showCustomStatus, setShowCustomStatus] = useState(false);
  const avatarWrapRef = useRef<HTMLDivElement>(null);

  if (!user) return null;

  const statusConfig = STATUS_CONFIG[ownStatus] || STATUS_CONFIG.online;
  const voiceConnected = voiceConnectionState === "connected" || voiceConnectionState === "connecting";
  const voiceChannel = voiceChannelId ? channels.find((c) => c.id === voiceChannelId) : null;
  const voiceChannelName = voiceChannel
    ? parseChannelDisplay(voiceChannel.encrypted_meta, user.id)?.name ?? t("chat.voiceDefaultName")
    : t("chat.voiceDefaultName");

  return (
    <div className="user-panel">
      {voiceConnected && (
        <div className="voice-connection-bar">
          <div className="voice-connection-info">
            <span className="voice-connected-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--green)" style={{ verticalAlign: "middle", marginRight: 4 }} aria-hidden="true">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
              {t("userPanel.voiceConnected")}
            </span>
            <span className="voice-channel-name">{voiceChannelName}</span>
          </div>
          <div className="voice-connection-actions">
            <button
              className={`voice-bar-btn ${isMuted ? "active" : ""}`}
              onClick={toggleMute}
              title={isMuted ? t("userPanel.unmute") : t("userPanel.mute")}
              aria-label={isMuted ? t("userPanel.unmute") : t("userPanel.mute")}
              aria-pressed={isMuted}
            >
              {isMuted ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9l4.17 4.18L21 19.73 4.27 3z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              )}
            </button>
            <button
              className={`voice-bar-btn ${isDeafened ? "active" : ""}`}
              onClick={toggleDeafen}
              title={isDeafened ? t("userPanel.undeafen") : t("userPanel.deafen")}
              aria-label={isDeafened ? t("userPanel.undeafen") : t("userPanel.deafen")}
              aria-pressed={isDeafened}
            >
              {isDeafened ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0014 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              )}
            </button>
            <button
              className="voice-bar-btn voice-disconnect-btn"
              onClick={leaveVoice}
              title={t("userPanel.disconnect")}
              aria-label={t("userPanel.disconnect")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
              </svg>
            </button>
          </div>
        </div>
      )}
      <div className="user-panel-row">
        <div className="user-panel-avatar-wrap" ref={avatarWrapRef} onClick={() => setShowStatusSelector((v) => !v)} role="button" tabIndex={0} aria-label={t("userPanel.changeStatus")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowStatusSelector((v) => !v); } }}>
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
          <span className="user-panel-name" role="button" tabIndex={0} onClick={() => setShowUserSettings(true, "profile")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowUserSettings(true, "profile"); } }}>{user.display_name || user.username}</span>
          {user.custom_status ? (
            <span className="user-panel-custom-status" onClick={() => setShowCustomStatus(true)} title={t("userPanel.editCustomStatus")} role="button" tabIndex={0} aria-label={t("userPanel.setCustomStatus")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowCustomStatus(true); } }}>
              {user.custom_status_emoji && <span>{user.custom_status_emoji} </span>}
              {user.custom_status}
            </span>
          ) : (
            <span className="user-panel-tag" onClick={() => setShowCustomStatus(true)} title={t("userPanel.setCustomStatus")} role="button" tabIndex={0} aria-label={t("userPanel.setCustomStatus")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowCustomStatus(true); } }}>
              {statusConfig.label}
            </span>
          )}
        </div>
        <div className="user-panel-actions">
          {isAdmin && (
            <button
              className="user-panel-btn"
              onClick={() => setShowAdminPanel(true)}
              title={t("userPanel.adminDashboard")}
              aria-label={t("userPanel.adminDashboard")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
              </svg>
            </button>
          )}
          <button
            className="user-panel-btn"
            onClick={() => setShowUserSettings(true)}
            title={t("userPanel.userSettings")}
            aria-label={t("userPanel.userSettings")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" />
            </svg>
          </button>
          <button
            className="user-panel-btn logout-btn"
            onClick={logout}
            title={t("userPanel.logOut")}
            aria-label={t("userPanel.logOut")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
            </svg>
          </button>
        </div>
      </div>

      {showStatusSelector && (
        <StatusSelector anchorRef={avatarWrapRef} onClose={() => setShowStatusSelector(false)} />
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
