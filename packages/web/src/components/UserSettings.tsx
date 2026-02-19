import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { useUiStore, type Theme } from "../store/ui.js";
import { useVoiceStore } from "../store/voice.js";
import Avatar from "./Avatar.js";
import EmojiPicker from "./EmojiPicker.js";
import { QRCodeSVG } from "qrcode.react";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import type { BlockedUserResponse } from "@haven/core";
import { generateRecoveryKey, generatePassphrase } from "@haven/core";
import {
  uploadBackup,
  cacheSecurityPhrase,
  getCachedPhrase,
  checkBackupStatus,
  downloadAndRestoreBackup,
} from "../lib/backup.js";

type Tab = "account" | "profile" | "privacy" | "voice" | "appearance" | "accessibility" | "security";

export default function UserSettings() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const api = useAuthStore((s) => s.api);
  const setShowUserSettings = useUiStore((s) => s.setShowUserSettings);
  const [tab, setTab] = useState<Tab>("account");

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setShowUserSettings(false);
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [setShowUserSettings]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  if (!user) return null;

  return (
    <div className="user-settings-overlay" role="presentation">
      <div className="user-settings-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("userSettings.ariaLabel")}>
        <nav className="user-settings-sidebar">
          <div className="user-settings-sidebar-header">{t("userSettings.sidebarHeader")}</div>
          <button
            className={`user-settings-nav-item ${tab === "account" ? "active" : ""}`}
            onClick={() => setTab("account")}
          >
            {t("userSettings.tab.myAccount")}
          </button>
          <button
            className={`user-settings-nav-item ${tab === "profile" ? "active" : ""}`}
            onClick={() => setTab("profile")}
          >
            {t("userSettings.tab.profile")}
          </button>
          <button
            className={`user-settings-nav-item ${tab === "privacy" ? "active" : ""}`}
            onClick={() => setTab("privacy")}
          >
            {t("userSettings.tab.privacy")}
          </button>
          <button
            className={`user-settings-nav-item ${tab === "voice" ? "active" : ""}`}
            onClick={() => setTab("voice")}
          >
            {t("userSettings.tab.voiceAudio")}
          </button>
          <button
            className={`user-settings-nav-item ${tab === "appearance" ? "active" : ""}`}
            onClick={() => setTab("appearance")}
          >
            {t("userSettings.tab.appearance")}
          </button>
          <button
            className={`user-settings-nav-item ${tab === "security" ? "active" : ""}`}
            onClick={() => setTab("security")}
          >
            {t("userSettings.tab.securityBackup")}
          </button>
          <button
            className={`user-settings-nav-item ${tab === "accessibility" ? "active" : ""}`}
            onClick={() => setTab("accessibility")}
          >
            {t("userSettings.tab.accessibility")}
          </button>
          <div className="user-settings-sidebar-divider" />
          <button
            className="user-settings-nav-item danger"
            onClick={() => {
              useAuthStore.getState().logout();
              setShowUserSettings(false);
            }}
          >
            {t("userSettings.logOut")}
          </button>
        </nav>
        <div className="user-settings-content">
          <div className="user-settings-content-header">
            <h2>{tab === "account" ? t("userSettings.tab.myAccount") : tab === "profile" ? t("userSettings.tab.profile") : tab === "privacy" ? t("userSettings.tab.privacy") : tab === "voice" ? t("userSettings.tab.voiceAudio") : tab === "appearance" ? t("userSettings.tab.appearance") : tab === "security" ? t("userSettings.tab.securityBackup") : t("userSettings.tab.accessibility")}</h2>
            <button className="settings-esc-close" onClick={() => setShowUserSettings(false)} aria-label={t("userSettings.closeAriaLabel")}>
              <div className="settings-esc-circle">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </div>
              <span className="settings-esc-label">{t("userSettings.escLabel")}</span>
            </button>
          </div>
          <div className="user-settings-content-body">
            {tab === "account" && <AccountTab />}
            {tab === "profile" && <ProfileTab />}
            {tab === "privacy" && <PrivacyTab />}
            {tab === "voice" && <VoiceTab />}
            {tab === "appearance" && <AppearanceTab />}
            {tab === "security" && <SecurityTab />}
            {tab === "accessibility" && <AccessibilityTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── My Account Tab ──────────────────────────────

function AccountTab() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const api = useAuthStore((s) => s.api);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  if (!user) return null;

  async function handleChangePassword() {
    setPwError("");
    setPwSuccess("");
    if (!currentPassword || !newPassword) {
      setPwError(t("userSettings.account.allFieldsRequired"));
      return;
    }
    if (newPassword.length < 8) {
      setPwError(t("userSettings.account.passwordMinLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError(t("userSettings.account.passwordsDoNotMatch"));
      return;
    }
    setPwLoading(true);
    try {
      await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPwSuccess(t("userSettings.account.passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPwError(err.message || t("userSettings.account.failedChangePassword"));
    } finally {
      setPwLoading(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-card">
        <div className="settings-card-row">
          <div>
            <div className="settings-label">{t("userSettings.account.usernameLabel")}</div>
            <div className="settings-value">{user.username}</div>
          </div>
        </div>
        <div className="settings-card-row">
          <div>
            <div className="settings-label">{t("userSettings.account.displayNameLabel")}</div>
            <div className="settings-value">{user.display_name || user.username}</div>
          </div>
        </div>
      </div>

      <div className="settings-section-title">{t("userSettings.account.changePassword")}</div>
      <div className="settings-fields">
        <label className="settings-field-label">
          {t("userSettings.account.currentPassword")}
          <input
            className="settings-input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label className="settings-field-label">
          {t("userSettings.account.newPassword")}
          <input
            className="settings-input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className="settings-field-label">
          {t("userSettings.account.confirmNewPassword")}
          <input
            className="settings-input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {pwError && <div className="settings-error">{pwError}</div>}
        {pwSuccess && <div className="settings-success">{pwSuccess}</div>}
        <button
          className="btn-primary settings-save-btn"
          onClick={handleChangePassword}
          disabled={pwLoading}
        >
          {pwLoading ? t("userSettings.account.changing") : t("userSettings.account.changePasswordBtn")}
        </button>
      </div>

      <div className="settings-section-title" style={{ marginTop: 32 }}>{t("userSettings.account.deleteAccount")}</div>
      <p className="settings-description">
        {t("userSettings.account.deleteAccountDesc")}
      </p>
      {!showDeleteConfirm ? (
        <button
          className="btn-danger"
          onClick={() => setShowDeleteConfirm(true)}
        >
          {t("userSettings.account.deleteAccountBtn")}
        </button>
      ) : (
        <div className="delete-account-confirm">
          <p className="settings-description" style={{ color: "var(--red)", fontWeight: 600 }}>
            {t("userSettings.account.deleteConfirmWarning")}
          </p>
          <label className="settings-field-label">
            {t("userSettings.account.confirmPassword")}
            <input
              className="settings-input"
              type="password"
              value={deletePassword}
              onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(""); }}
              placeholder={t("userSettings.account.confirmPasswordPlaceholder")}
              autoComplete="current-password"
            />
          </label>
          {deleteError && <div className="settings-error">{deleteError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              className="btn-secondary"
              onClick={() => { setShowDeleteConfirm(false); setDeletePassword(""); setDeleteError(""); }}
            >
              {t("userSettings.account.cancel")}
            </button>
            <button
              className="btn-danger"
              disabled={deleteLoading || !deletePassword}
              onClick={async () => {
                setDeleteError("");
                setDeleteLoading(true);
                try {
                  await api.deleteAccount(deletePassword);
                  useAuthStore.getState().logout();
                } catch (err: any) {
                  setDeleteError(err.message || t("userSettings.account.failedDeleteAccount"));
                } finally {
                  setDeleteLoading(false);
                }
              }}
            >
              {deleteLoading ? t("userSettings.account.deleting") : t("userSettings.account.permanentlyDeleteAccount")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Profile Tab ────────────────────────────────────

function ProfileTab() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const api = useAuthStore((s) => s.api);

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [aboutMe, setAboutMe] = useState(user?.about_me ?? "");
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [showStatusEmoji, setShowStatusEmoji] = useState(false);
  const statusInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  async function handleSaveProfile() {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const updated = await api.updateProfile({
        display_name: displayName || null,
        about_me: aboutMe || null,
        custom_status: customStatus || null,
      });
      useAuthStore.setState({
        user: { ...user!, ...updated },
      });
      setSuccess(t("userSettings.profile.profileUpdated"));
    } catch (err: any) {
      setError(err.message || t("userSettings.profile.failedUpdateProfile"));
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError(t("userSettings.profile.avatarTooLarge"));
      return;
    }
    setError("");
    setAvatarUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const updated = await api.uploadAvatar(buf);
      useAuthStore.setState({
        user: { ...user!, ...updated },
      });
      setSuccess(t("userSettings.profile.avatarUpdated"));
    } catch (err: any) {
      setError(err.message || t("userSettings.profile.failedUploadAvatar"));
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError(t("userSettings.profile.bannerTooLarge"));
      return;
    }
    setError("");
    setBannerUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const updated = await api.uploadBanner(buf);
      useAuthStore.setState({
        user: { ...user!, ...updated },
      });
      setSuccess(t("userSettings.profile.bannerUpdated"));
    } catch (err: any) {
      setError(err.message || t("userSettings.profile.failedUploadBanner"));
    } finally {
      setBannerUploading(false);
      if (bannerInputRef.current) bannerInputRef.current.value = "";
    }
  }

  return (
    <div className="settings-section">
      {/* Banner upload */}
      <div
        className="settings-banner-preview"
        onClick={() => bannerInputRef.current?.click()}
        style={user.banner_url ? { backgroundImage: `url(${user.banner_url})` } : undefined}
      >
        <div className="settings-banner-overlay">
          {bannerUploading ? t("userSettings.profile.uploading") : t("userSettings.profile.changeBanner")}
        </div>
      </div>
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: "none" }}
        onChange={handleBannerUpload}
      />

      <div className="settings-avatar-section">
        <div className="settings-avatar-preview" onClick={() => fileInputRef.current?.click()}>
          <Avatar
            avatarUrl={user.avatar_url}
            name={user.display_name || user.username}
            size={80}
          />
          <div className="settings-avatar-overlay">
            {avatarUploading ? t("userSettings.profile.uploading") : t("userSettings.profile.changeAvatar")}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: "none" }}
          onChange={handleAvatarUpload}
        />
      </div>

      <div className="settings-fields">
        <label className="settings-field-label">
          {t("userSettings.profile.displayName")}
          <input
            className="settings-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={32}
            placeholder={user.username}
          />
        </label>
        <label className="settings-field-label">
          {t("userSettings.profile.aboutMe")}
          <textarea
            className="settings-textarea"
            value={aboutMe}
            onChange={(e) => setAboutMe(e.target.value)}
            maxLength={190}
            rows={3}
            placeholder={t("userSettings.profile.aboutMePlaceholder")}
          />
          <span className="settings-char-count">{aboutMe.length}/190</span>
        </label>
        <div className="settings-field-label">
          {t("userSettings.profile.customStatus")}
          <div className="settings-input-with-emoji">
            <input
              ref={statusInputRef}
              className="settings-input"
              type="text"
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              maxLength={128}
              placeholder={t("userSettings.profile.customStatusPlaceholder")}
            />
            <div className="settings-emoji-btn-wrap">
              <button
                type="button"
                className="create-channel-emoji-btn"
                onClick={() => setShowStatusEmoji(!showStatusEmoji)}
                title={t("userSettings.profile.addEmojiTitle")}
                aria-label={t("userSettings.profile.addEmojiAriaLabel")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
                </svg>
              </button>
              {showStatusEmoji && (
                <EmojiPicker
                  onSelect={(emoji) => {
                    const input = statusInputRef.current;
                    const start = input?.selectionStart ?? customStatus.length;
                    const end = input?.selectionEnd ?? customStatus.length;
                    setCustomStatus(customStatus.slice(0, start) + emoji + customStatus.slice(end));
                    setShowStatusEmoji(false);
                    requestAnimationFrame(() => {
                      const pos = start + emoji.length;
                      input?.setSelectionRange(pos, pos);
                      input?.focus();
                    });
                  }}
                  onClose={() => setShowStatusEmoji(false)}
                />
              )}
            </div>
          </div>
        </div>
        {error && <div className="settings-error">{error}</div>}
        {success && <div className="settings-success">{success}</div>}
        <button
          className="btn-primary settings-save-btn"
          onClick={handleSaveProfile}
          disabled={saving}
        >
          {saving ? t("userSettings.profile.saving") : t("userSettings.profile.saveChanges")}
        </button>
      </div>
    </div>
  );
}

// ─── Privacy Tab ────────────────────────────────────

function PrivacyTab() {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const user = useAuthStore((s) => s.user);

  const [dmPrivacy, setDmPrivacy] = useState("everyone");
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getBlockedUsers(),
    ]).then(([blocked]) => {
      if (cancelled) return;
      setBlockedUsers(blocked);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [api]);

  async function handleDmPrivacyChange(value: string) {
    setDmPrivacy(value);
    try {
      await api.updateDmPrivacy({ dm_privacy: value });
    } catch { /* non-fatal */ }
  }

  async function handleUnblock(userId: string) {
    try {
      await api.unblockUser(userId);
      setBlockedUsers((prev) => prev.filter((b) => b.user_id !== userId));
    } catch { /* non-fatal */ }
  }

  if (loading) {
    return <div className="settings-section"><p className="settings-loading">{t("userSettings.privacy.loading")}</p></div>;
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("userSettings.privacy.dmPrivacy")}</div>
      <p className="settings-description">
        {t("userSettings.privacy.dmPrivacyDesc")}
      </p>
      <div className="settings-select-group">
        {[
          { value: "everyone", label: t("userSettings.privacy.everyone") },
          { value: "friends_only", label: t("userSettings.privacy.friendsOnly") },
          { value: "server_members", label: t("userSettings.privacy.serverMembers") },
        ].map((opt) => (
          <label key={opt.value} className="settings-radio-label">
            <input
              type="radio"
              name="dm_privacy"
              value={opt.value}
              checked={dmPrivacy === opt.value}
              onChange={() => handleDmPrivacyChange(opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>

      <div className="settings-section-title" style={{ marginTop: 24 }}>
        {t("userSettings.privacy.blockedUsers")} {blockedUsers.length > 0 && `(${blockedUsers.length})`}
      </div>
      {blockedUsers.length === 0 ? (
        <p className="settings-description">{t("userSettings.privacy.noBlockedUsers")}</p>
      ) : (
        <div className="settings-blocked-list">
          {blockedUsers.map((b) => (
            <div key={b.user_id} className="settings-blocked-row">
              <Avatar
                avatarUrl={b.avatar_url}
                name={b.display_name || b.username}
                size={32}
              />
              <div className="settings-blocked-info">
                <span className="settings-blocked-name">{b.display_name || b.username}</span>
                <span className="settings-blocked-username">{b.username}</span>
              </div>
              <button
                className="btn-secondary settings-unblock-btn"
                onClick={() => handleUnblock(b.user_id)}
              >
                {t("userSettings.privacy.unblock")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Voice & Audio Tab ──────────────────────────────

function VoiceTab() {
  const { t } = useTranslation();
  const {
    inputDeviceId,
    outputDeviceId,
    inputVolume,
    outputVolume,
    echoCancellation,
    noiseSuppression,
    setInputDevice,
    setOutputDevice,
    setInputVolume,
    setOutputVolume,
    setEchoCancellation,
    setNoiseSuppression,
  } = useVoiceStore();

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const testRef = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setInputDevices(devices.filter((d) => d.kind === "audioinput"));
      setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
    });
  }, []);

  const startMicTest = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined },
      });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      function tick() {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const rms = sum / dataArray.length;
        setAudioLevel(Math.min(100, (rms / 128) * 100));
        testRef.current!.raf = requestAnimationFrame(tick);
      }

      testRef.current = { stream, ctx, raf: requestAnimationFrame(tick) };
      setTesting(true);
    } catch {
      // User denied mic access or device unavailable
    }
  }, [inputDeviceId]);

  const stopMicTest = useCallback(() => {
    if (testRef.current) {
      cancelAnimationFrame(testRef.current.raf);
      testRef.current.stream.getTracks().forEach((t) => t.stop());
      testRef.current.ctx.close();
      testRef.current = null;
    }
    setTesting(false);
    setAudioLevel(0);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (testRef.current) {
        cancelAnimationFrame(testRef.current.raf);
        testRef.current.stream.getTracks().forEach((t) => t.stop());
        testRef.current.ctx.close();
        testRef.current = null;
      }
    };
  }, []);

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("userSettings.voice.inputDevice")}</div>
      <select
        className="settings-select"
        value={inputDeviceId}
        onChange={(e) => setInputDevice(e.target.value)}
      >
        <option value="">{t("userSettings.voice.default")}</option>
        {inputDevices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
          </option>
        ))}
      </select>

      <div className="settings-section-title">{t("userSettings.voice.inputVolume")}</div>
      <div className="settings-slider-row">
        <input
          type="range"
          className="settings-slider"
          min={0}
          max={200}
          value={Math.round(inputVolume * 100)}
          onChange={(e) => setInputVolume(Number(e.target.value) / 100)}
        />
        <span className="settings-slider-value">{Math.round(inputVolume * 100)}%</span>
      </div>

      <div className="settings-mic-test">
        <button
          className="btn-secondary"
          onClick={testing ? stopMicTest : startMicTest}
        >
          {testing ? t("userSettings.voice.stopTest") : t("userSettings.voice.testMicrophone")}
        </button>
        {testing && (
          <div className="mic-level-bar">
            <div className="mic-level-fill" style={{ width: `${audioLevel}%` }} />
          </div>
        )}
      </div>

      <div className="settings-section-title" style={{ marginTop: 24 }}>{t("userSettings.voice.outputDevice")}</div>
      <select
        className="settings-select"
        value={outputDeviceId}
        onChange={(e) => setOutputDevice(e.target.value)}
      >
        <option value="">{t("userSettings.voice.default")}</option>
        {outputDevices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Speaker (${d.deviceId.slice(0, 8)})`}
          </option>
        ))}
      </select>

      <div className="settings-section-title">{t("userSettings.voice.outputVolume")}</div>
      <div className="settings-slider-row">
        <input
          type="range"
          className="settings-slider"
          min={0}
          max={200}
          value={Math.round(outputVolume * 100)}
          onChange={(e) => setOutputVolume(Number(e.target.value) / 100)}
        />
        <span className="settings-slider-value">{Math.round(outputVolume * 100)}%</span>
      </div>

      <div className="settings-section-title" style={{ marginTop: 24 }}>{t("userSettings.voice.voiceProcessing")}</div>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={echoCancellation}
          onChange={(e) => setEchoCancellation(e.target.checked)}
        />
        <span>{t("userSettings.voice.echoCancellation")}</span>
      </label>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={noiseSuppression}
          onChange={(e) => setNoiseSuppression(e.target.checked)}
        />
        <span>{t("userSettings.voice.noiseSuppression")}</span>
      </label>
    </div>
  );
}

// ─── Security & Backup Tab ──────────────────────────

function SecurityTab() {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const user = useAuthStore((s) => s.user);

  const [backupExists, setBackupExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // Session management
  const [sessions, setSessions] = useState<import("@haven/core").SessionResponse[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // TOTP 2FA
  const [totpEnabled, setTotpEnabled] = useState(user?.totp_enabled ?? false);
  type TotpMode = "idle" | "setup" | "disable";
  const [totpMode, setTotpMode] = useState<TotpMode>("idle");
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; qr_code_uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState("");
  const [totpSuccess, setTotpSuccess] = useState("");
  const [totpSaving, setTotpSaving] = useState(false);
  const [totpSecretCopied, setTotpSecretCopied] = useState(false);

  // Change phrase flow
  type Mode = "idle" | "change" | "setup" | "generated";
  const [mode, setMode] = useState<Mode>("idle");
  const [currentPhrase, setCurrentPhrase] = useState("");
  const [newPhrase, setNewPhrase] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkBackupStatus()
      .then(({ hasBackup }) => {
        if (!cancelled) {
          setBackupExists(hasBackup);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    // Load sessions
    api.getSessions()
      .then((s) => { if (!cancelled) setSessions(s); })
      .catch(() => { if (!cancelled) setSessionError(t("userSettings.security.failedLoadSessions")); })
      .finally(() => { if (!cancelled) setSessionsLoading(false); });
    return () => { cancelled = true; };
  }, [api]);

  async function handleRevokeSession(familyId: string) {
    setRevokingId(familyId);
    setSessionError("");
    try {
      await api.revokeSession(familyId);
      setSessions((prev) => prev.filter((s) => s.family_id !== familyId));
    } catch {
      setSessionError(t("userSettings.security.failedRevokeSession"));
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeAllOther() {
    setSessionError("");
    const others = sessions.filter((s) => !s.is_current && s.family_id);
    for (const s of others) {
      try {
        await api.revokeSession(s.family_id!);
      } catch { /* continue */ }
    }
    setSessions((prev) => prev.filter((s) => s.is_current));
  }

  async function handleChangePhrase() {
    setError("");
    setSuccess("");
    if (newPhrase.length < 8) {
      setError(t("userSettings.security.changePhrase.phraseMinLength"));
      return;
    }
    if (newPhrase !== confirmPhrase) {
      setError(t("userSettings.security.changePhrase.phrasesDoNotMatch"));
      return;
    }
    setSaving(true);
    try {
      // If we have a cached phrase, use it; otherwise require the current phrase
      const cached = getCachedPhrase();
      if (!cached && !currentPhrase) {
        setError(t("userSettings.security.changePhrase.enterCurrentPhrase"));
        setSaving(false);
        return;
      }
      // Verify current phrase by attempting to download and decrypt
      if (!cached) {
        await downloadAndRestoreBackup(currentPhrase);
      }
      // Upload new backup with new phrase
      await uploadBackup(newPhrase);
      cacheSecurityPhrase(newPhrase);
      setSuccess(t("userSettings.security.changePhrase.phraseUpdated"));
      setMode("idle");
      setBackupExists(true);
      setCurrentPhrase("");
      setNewPhrase("");
      setConfirmPhrase("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("userSettings.security.changePhrase.failedUpdate"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSetupWithPhrase(phrase: string) {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await uploadBackup(phrase);
      cacheSecurityPhrase(phrase);
      setBackupExists(true);
      setSuccess(t("userSettings.security.setup.backupCreated"));
      setMode("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("userSettings.security.setup.failedCreate"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBackup() {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await api.deleteKeyBackup();
      setBackupExists(false);
      setSuccess(t("userSettings.security.backupDeleted"));
      setMode("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("userSettings.security.failedDeleteBackup"));
    } finally {
      setSaving(false);
    }
  }

  async function handleTotpSetup() {
    setTotpError("");
    setTotpSuccess("");
    setTotpSaving(true);
    try {
      const data = await api.totpSetup();
      setTotpSetupData(data);
      setTotpMode("setup");
    } catch (e: any) {
      setTotpError(e?.message || t("userSettings.security.totp.setupFailed"));
    } finally {
      setTotpSaving(false);
    }
  }

  async function handleTotpVerify() {
    setTotpError("");
    setTotpSaving(true);
    try {
      await api.totpVerify({ code: totpCode });
      setTotpEnabled(true);
      setTotpMode("idle");
      setTotpSetupData(null);
      setTotpCode("");
      setTotpSuccess(t("userSettings.security.totp.enableSuccess"));
    } catch {
      setTotpError(t("userSettings.security.totp.invalidCode"));
    } finally {
      setTotpSaving(false);
    }
  }

  async function handleTotpDisable() {
    setTotpError("");
    setTotpSaving(true);
    try {
      await api.totpDisable();
      setTotpEnabled(false);
      setTotpMode("idle");
      setTotpSuccess(t("userSettings.security.totp.disableSuccess"));
    } catch (e: any) {
      setTotpError(e?.message || "Failed to disable 2FA");
    } finally {
      setTotpSaving(false);
    }
  }

  if (loading) {
    return <div className="settings-section"><p className="settings-loading">{t("userSettings.security.loading")}</p></div>;
  }

  return (
    <>
    <div className="settings-section">
      <div className="settings-section-title">{t("userSettings.security.activeSessions")}</div>
      <p className="settings-description">
        {t("userSettings.security.activeSessionsDesc")}
      </p>
      {sessionsLoading && <p className="settings-loading">{t("userSettings.security.loadingSessions")}</p>}
      {sessionError && <div className="settings-error">{sessionError}</div>}
      {!sessionsLoading && sessions.length > 0 && (
        <div className="session-list">
          {sessions.map((s) => (
            <div key={s.id} className={`session-card${s.is_current ? " session-current" : ""}`}>
              <div className="session-card-info">
                <div className="session-card-device">
                  {s.device_name || t("userSettings.security.unknownDevice")}
                  {s.is_current && <span className="session-badge-current">{t("userSettings.security.current")}</span>}
                </div>
                <div className="session-card-meta">
                  {s.ip_address && <span>{s.ip_address}</span>}
                  {s.last_activity && (
                    <span>{t("userSettings.security.active")} {new Date(s.last_activity).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                  <span>{t("userSettings.security.created")} {new Date(s.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                </div>
              </div>
              {!s.is_current && s.family_id && (
                <button
                  className="btn-secondary btn-danger-outline btn-sm"
                  onClick={() => handleRevokeSession(s.family_id!)}
                  disabled={revokingId === s.family_id}
                >
                  {revokingId === s.family_id ? t("userSettings.security.revoking") : t("userSettings.security.revoke")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!sessionsLoading && sessions.length > 1 && (
        <button
          className="btn-secondary btn-danger-outline"
          style={{ marginTop: 12 }}
          onClick={handleRevokeAllOther}
        >
          {t("userSettings.security.revokeAllOther")}
        </button>
      )}
    </div>

    <div className="settings-section">
      <div className="settings-section-title">{t("userSettings.security.totp.title")}</div>
      <p className="settings-description">
        {t("userSettings.security.totp.desc")}
      </p>

      {totpMode === "idle" && (
        <>
          <div className="settings-card" style={{ marginBottom: 16 }}>
            <div className="settings-card-row">
              <div>
                <div className="settings-label">{t("userSettings.security.statusLabel")}</div>
                <div className="settings-value">
                  {totpEnabled ? (
                    <span style={{ color: "var(--green)" }}>{t("userSettings.security.totp.enabled")}</span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>{t("userSettings.security.totp.disabled")}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="security-phrase-actions">
            {totpEnabled ? (
              <button
                className="btn-secondary btn-danger-outline"
                onClick={() => { setTotpMode("disable"); setTotpError(""); setTotpSuccess(""); }}
              >
                {t("userSettings.security.totp.disable")}
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={handleTotpSetup}
                disabled={totpSaving}
              >
                {totpSaving ? t("userSettings.security.loading") : t("userSettings.security.totp.enable")}
              </button>
            )}
          </div>
        </>
      )}

      {totpMode === "setup" && totpSetupData && (
        <div className="settings-fields">
          <p className="settings-description" style={{ marginBottom: 8 }}>
            {t("userSettings.security.totp.scanQrCode")}
          </p>
          <div className="totp-qr-container">
            <QRCodeSVG value={totpSetupData.qr_code_uri} size={180} bgColor="transparent" fgColor="var(--text-normal)" />
          </div>
          <p className="settings-description" style={{ marginTop: 12, marginBottom: 4 }}>
            {t("userSettings.security.totp.manualEntry")}
          </p>
          <div className="totp-secret-display">
            <code>{totpSetupData.secret}</code>
            <button
              className="btn-secondary btn-sm"
              style={{ marginLeft: 8 }}
              onClick={() => {
                navigator.clipboard.writeText(totpSetupData.secret);
                setTotpSecretCopied(true);
                setTimeout(() => setTotpSecretCopied(false), 2000);
              }}
            >
              {totpSecretCopied ? t("userSettings.security.totp.copied") : t("userSettings.security.totp.copySecret")}
            </button>
          </div>
          <label className="settings-field-label" style={{ marginTop: 16 }}>
            {t("userSettings.security.totp.enterCode")}
            <input
              className="settings-input totp-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "")); setTotpError(""); }}
              placeholder={t("userSettings.security.totp.codePlaceholder")}
              autoFocus
            />
          </label>
          {totpError && <div className="settings-error">{totpError}</div>}
          <div className="security-phrase-actions">
            <button className="btn-secondary" onClick={() => { setTotpMode("idle"); setTotpSetupData(null); setTotpCode(""); setTotpError(""); }}>
              {t("userSettings.security.totp.cancel")}
            </button>
            <button
              className="btn-primary"
              onClick={handleTotpVerify}
              disabled={totpSaving || totpCode.length !== 6}
              style={{ marginLeft: 8 }}
            >
              {totpSaving ? t("userSettings.security.totp.verifying") : t("userSettings.security.totp.verifyAndEnable")}
            </button>
          </div>
        </div>
      )}

      {totpMode === "disable" && (
        <div className="settings-fields">
          <p className="settings-description" style={{ color: "var(--red)" }}>
            {t("userSettings.security.totp.disableWarning")}
          </p>
          {totpError && <div className="settings-error">{totpError}</div>}
          <div className="security-phrase-actions">
            <button className="btn-secondary" onClick={() => { setTotpMode("idle"); setTotpError(""); }}>
              {t("userSettings.security.totp.cancel")}
            </button>
            <button
              className="btn-secondary btn-danger-outline"
              onClick={handleTotpDisable}
              disabled={totpSaving}
              style={{ marginLeft: 8 }}
            >
              {totpSaving ? t("userSettings.security.totp.disabling") : t("userSettings.security.totp.confirmDisable")}
            </button>
          </div>
        </div>
      )}

      {totpSuccess && <div className="settings-success" style={{ marginTop: 12 }}>{totpSuccess}</div>}
    </div>

    <div className="settings-section">
      <div className="settings-section-title">{t("userSettings.security.keyBackupStatus")}</div>
      <p className="settings-description">
        {t("userSettings.security.keyBackupDesc")}
      </p>
      <div className="settings-card" style={{ marginBottom: 16 }}>
        <div className="settings-card-row">
          <div>
            <div className="settings-label">{t("userSettings.security.statusLabel")}</div>
            <div className="settings-value">
              {backupExists ? (
                <span style={{ color: "var(--status-online, #3ba55d)" }}>{t("userSettings.security.backupExists")}</span>
              ) : (
                <span style={{ color: "var(--status-dnd, #ed4245)" }}>{t("userSettings.security.noBackup")}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {mode === "idle" && (
        <div className="security-phrase-actions">
          {backupExists ? (
            <>
              <button
                className="btn-primary"
                onClick={() => { setMode("change"); setError(""); setSuccess(""); }}
                style={{ marginRight: 8 }}
              >
                {t("userSettings.security.changeSecurityPhrase")}
              </button>
              <button
                className="btn-secondary btn-danger-outline"
                onClick={handleDeleteBackup}
                disabled={saving}
              >
                {t("userSettings.security.deleteBackup")}
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-primary"
                onClick={() => { setMode("setup"); setError(""); setSuccess(""); }}
                style={{ marginRight: 8 }}
              >
                {t("userSettings.security.setUpSecurityPhrase")}
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setRecoveryKey(generateRecoveryKey());
                  setMode("generated");
                  setError("");
                  setSuccess("");
                }}
              >
                {t("userSettings.security.generateRecoveryKey")}
              </button>
            </>
          )}
        </div>
      )}

      {mode === "change" && (
        <div className="settings-fields">
          <div className="settings-section-title">{t("userSettings.security.changePhrase.title")}</div>
          {!getCachedPhrase() && (
            <label className="settings-field-label">
              {t("userSettings.security.changePhrase.currentLabel")}
              <input
                className="settings-input"
                type="password"
                value={currentPhrase}
                onChange={(e) => { setCurrentPhrase(e.target.value); setError(""); }}
                placeholder={t("userSettings.security.changePhrase.currentPlaceholder")}
              />
            </label>
          )}
          <button
            className="btn-secondary"
            style={{ marginBottom: 12 }}
            onClick={() => {
              const phrase = generatePassphrase();
              setNewPhrase(phrase);
              setConfirmPhrase(phrase);
              setError("");
            }}
          >
            {t("userSettings.security.changePhrase.generatePhrase")}
          </button>
          {newPhrase && newPhrase === confirmPhrase && newPhrase.includes("-") && (
            <div className="recovery-key-display" style={{ marginBottom: 12 }}>
              <code>{newPhrase}</code>
              <button
                className="btn-secondary"
                style={{ marginTop: 8, width: "100%" }}
                onClick={() => navigator.clipboard.writeText(newPhrase)}
              >
                {t("userSettings.security.changePhrase.copyToClipboard")}
              </button>
            </div>
          )}
          <label className="settings-field-label">
            {t("userSettings.security.changePhrase.newLabel")}
            <input
              className="settings-input"
              type="password"
              value={newPhrase}
              onChange={(e) => { setNewPhrase(e.target.value); setError(""); }}
              placeholder={t("userSettings.security.changePhrase.newPlaceholder")}
            />
          </label>
          <label className="settings-field-label">
            {t("userSettings.security.changePhrase.confirmLabel")}
            <input
              className="settings-input"
              type="password"
              value={confirmPhrase}
              onChange={(e) => { setConfirmPhrase(e.target.value); setError(""); }}
              placeholder={t("userSettings.security.changePhrase.confirmPlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && handleChangePhrase()}
            />
          </label>
          {error && <div className="settings-error">{error}</div>}
          <div className="security-phrase-actions">
            <button className="btn-secondary" onClick={() => setMode("idle")}>{t("userSettings.security.changePhrase.cancel")}</button>
            <button
              className="btn-primary"
              onClick={handleChangePhrase}
              disabled={saving || !newPhrase || !confirmPhrase}
              style={{ marginLeft: 8 }}
            >
              {saving ? t("userSettings.security.changePhrase.saving") : t("userSettings.security.changePhrase.updatePhrase")}
            </button>
          </div>
        </div>
      )}

      {mode === "setup" && (
        <div className="settings-fields">
          <div className="settings-section-title">{t("userSettings.security.setup.title")}</div>
          <p className="settings-description">
            {t("userSettings.security.setup.desc")}
          </p>
          <button
            className="btn-secondary"
            style={{ marginBottom: 12 }}
            onClick={() => {
              const phrase = generatePassphrase();
              setNewPhrase(phrase);
              setConfirmPhrase(phrase);
              setError("");
            }}
          >
            {t("userSettings.security.setup.generatePhrase")}
          </button>
          {newPhrase && newPhrase === confirmPhrase && newPhrase.includes("-") && (
            <div className="recovery-key-display" style={{ marginBottom: 12 }}>
              <code>{newPhrase}</code>
              <button
                className="btn-secondary"
                style={{ marginTop: 8, width: "100%" }}
                onClick={() => navigator.clipboard.writeText(newPhrase)}
              >
                {t("userSettings.security.setup.copyToClipboard")}
              </button>
            </div>
          )}
          <label className="settings-field-label">
            {t("userSettings.security.setup.phraseLabel")}
            <input
              className="settings-input"
              type="password"
              value={newPhrase}
              onChange={(e) => { setNewPhrase(e.target.value); setError(""); }}
              placeholder={t("userSettings.security.setup.phrasePlaceholder")}
              autoFocus
            />
          </label>
          <label className="settings-field-label">
            {t("userSettings.security.setup.confirmLabel")}
            <input
              className="settings-input"
              type="password"
              value={confirmPhrase}
              onChange={(e) => { setConfirmPhrase(e.target.value); setError(""); }}
              placeholder={t("userSettings.security.setup.confirmPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPhrase.length >= 8 && newPhrase === confirmPhrase) {
                  handleSetupWithPhrase(newPhrase);
                }
              }}
            />
          </label>
          {error && <div className="settings-error">{error}</div>}
          <div className="security-phrase-actions">
            <button className="btn-secondary" onClick={() => setMode("idle")}>{t("userSettings.security.setup.cancel")}</button>
            <button
              className="btn-primary"
              onClick={() => {
                if (newPhrase.length < 8) { setError(t("userSettings.security.setup.mustBeMinLength")); return; }
                if (newPhrase !== confirmPhrase) { setError(t("userSettings.security.setup.phrasesDoNotMatch")); return; }
                handleSetupWithPhrase(newPhrase);
              }}
              disabled={saving || !newPhrase || !confirmPhrase}
              style={{ marginLeft: 8 }}
            >
              {saving ? t("userSettings.security.setup.saving") : t("userSettings.security.setup.createBackup")}
            </button>
          </div>
        </div>
      )}

      {mode === "generated" && (
        <div className="settings-fields">
          <div className="settings-section-title">{t("userSettings.security.generated.title")}</div>
          <p className="settings-description">
            {t("userSettings.security.generated.desc")}
          </p>
          <div className="recovery-key-display">
            <code>{recoveryKey}</code>
          </div>
          <button
            className="btn-secondary"
            style={{ width: "100%", marginBottom: 12 }}
            onClick={() => navigator.clipboard.writeText(recoveryKey)}
          >
            {t("userSettings.security.generated.copyToClipboard")}
          </button>
          <label className="security-phrase-confirm-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t("userSettings.security.generated.savedConfirm")}
          </label>
          {error && <div className="settings-error">{error}</div>}
          <div className="security-phrase-actions">
            <button className="btn-secondary" onClick={() => setMode("idle")}>{t("userSettings.security.generated.cancel")}</button>
            <button
              className="btn-primary"
              onClick={() => handleSetupWithPhrase(recoveryKey)}
              disabled={!confirmed || saving}
              style={{ marginLeft: 8 }}
            >
              {saving ? t("userSettings.security.generated.saving") : t("userSettings.security.generated.saveBackup")}
            </button>
          </div>
        </div>
      )}

      {success && <div className="settings-success" style={{ marginTop: 12 }}>{success}</div>}
    </div>
    </>
  );
}

// ─── Appearance Tab ─────────────────────────────────

function AppearanceTab() {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const themes: { value: Theme; key: string; colors: string[] }[] = [
    {
      value: "night",
      key: "nightMode",
      colors: ["#1e1f22", "#2b2d31", "#313338", "#5865f2", "#dbdee1"],
    },
    {
      value: "default",
      key: "default",
      colors: ["#E2D9CC", "#EAE3D7", "#F5F0E8", "#C2410C", "#3D3029"],
    },
    {
      value: "light",
      key: "lightMode",
      colors: ["#E3E5E8", "#F2F3F5", "#FFFFFF", "#4752C4", "#2E3338"],
    },
    {
      value: "sage",
      key: "sage",
      colors: ["#171717", "#212121", "#2D2D2D", "#10A37F", "#ECECEC"],
    },
    {
      value: "cosmos",
      key: "cosmos",
      colors: ["#131620", "#1B1F2E", "#232736", "#8B6CEF", "#E3E5EA"],
    },
    {
      value: "forest",
      key: "forest",
      colors: ["#1A2318", "#222E1F", "#2A3627", "#5FAD56", "#D4DDD2"],
    },
    {
      value: "bluebird",
      key: "bluebird",
      colors: ["#E8ECF0", "#F5F8FA", "#FFFFFF", "#0C7ABF", "#14171A"],
    },
  ];

  const customCss = useUiStore((s) => s.customCss);
  const setCustomCss = useUiStore((s) => s.setCustomCss);

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">{t("userSettings.appearance.theme")}</div>
        <p className="settings-description">{t("userSettings.appearance.themeDesc")}</p>
        <div className="theme-picker">
          {themes.map((thm) => (
            <button
              key={thm.value}
              className={`theme-card ${theme === thm.value ? "selected" : ""}`}
              onClick={() => setTheme(thm.value)}
              aria-pressed={theme === thm.value}
            >
              <div className="theme-preview">
                {thm.colors.map((c, i) => (
                  <div key={i} className="theme-swatch" style={{ background: c }} />
                ))}
              </div>
              <span className="theme-label">{t(`userSettings.appearance.${thm.key}`)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t("userSettings.appearance.customCss")}</div>
        <p className="settings-description">
          {t("userSettings.appearance.customCssDesc")}
        </p>
        <textarea
          className="settings-input custom-css-textarea"
          value={customCss}
          onChange={(e) => setCustomCss(e.target.value)}
          placeholder={`/* Example: change the brand color */\n:root {\n  --brand: #ff6b6b;\n}`}
          spellCheck={false}
          rows={8}
        />
        {customCss && (
          <button
            className="btn-ghost"
            style={{ marginTop: 8 }}
            onClick={() => setCustomCss("")}
          >
            {t("userSettings.appearance.clearCustomCss")}
          </button>
        )}
      </div>
    </>
  );
}

// ─── Accessibility Tab ──────────────────────────────

function AccessibilityTab() {
  const { t } = useTranslation();
  const reducedMotion = useUiStore((s) => s.a11yReducedMotion);
  const font = useUiStore((s) => s.a11yFont);
  const highContrast = useUiStore((s) => s.a11yHighContrast);
  const alwaysShowTimestamps = useUiStore((s) => s.a11yAlwaysShowTimestamps);
  const setReducedMotion = useUiStore((s) => s.setA11yReducedMotion);
  const setFont = useUiStore((s) => s.setA11yFont);
  const setHighContrast = useUiStore((s) => s.setA11yHighContrast);
  const setAlwaysShowTimestamps = useUiStore((s) => s.setA11yAlwaysShowTimestamps);

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("userSettings.accessibility.motion")}</div>
      <p className="settings-description">
        {t("userSettings.accessibility.motionDesc")}
      </p>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={reducedMotion}
          onChange={(e) => setReducedMotion(e.target.checked)}
        />
        <span>{t("userSettings.accessibility.reduceMotion")}</span>
      </label>
      <p className="settings-hint">
        {t("userSettings.accessibility.reduceMotionHint")}
      </p>

      <div className="settings-section-title" style={{ marginTop: 24 }}>{t("userSettings.accessibility.font")}</div>
      <p className="settings-description">
        {t("userSettings.accessibility.fontDesc")}
      </p>
      <div className="settings-select-group">
        {([
          { value: "default", label: t("userSettings.accessibility.fontDefault") },
          { value: "opendyslexic", label: t("userSettings.accessibility.fontOpenDyslexic") },
          { value: "atkinson", label: t("userSettings.accessibility.fontAtkinson") },
        ] as const).map((opt) => (
          <label key={opt.value} className="settings-radio-label">
            <input
              type="radio"
              name="a11y_font"
              value={opt.value}
              checked={font === opt.value}
              onChange={() => setFont(opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>

      <div className="settings-section-title" style={{ marginTop: 24 }}>{t("userSettings.accessibility.contrast")}</div>
      <p className="settings-description">
        {t("userSettings.accessibility.contrastDesc")}
      </p>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={highContrast}
          onChange={(e) => setHighContrast(e.target.checked)}
        />
        <span>{t("userSettings.accessibility.highContrastMode")}</span>
      </label>

      <div className="settings-section-title" style={{ marginTop: 24 }}>{t("userSettings.accessibility.chatDisplay")}</div>
      <p className="settings-description">
        {t("userSettings.accessibility.chatDisplayDesc")}
      </p>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={alwaysShowTimestamps}
          onChange={(e) => setAlwaysShowTimestamps(e.target.checked)}
        />
        <span>{t("userSettings.accessibility.alwaysShowTimestamps")}</span>
      </label>
      <p className="settings-hint">
        {t("userSettings.accessibility.alwaysShowTimestampsHint")}
      </p>
    </div>
  );
}
