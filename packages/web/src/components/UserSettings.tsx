import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { useUiStore, type Theme } from "../store/ui.js";
import { useVoiceStore } from "../store/voice.js";
import Avatar from "./Avatar.js";
import EmojiPicker from "./EmojiPicker.js";
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
      <div className="user-settings-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label="User Settings">
        <nav className="user-settings-sidebar">
          <div className="user-settings-sidebar-header">User Settings</div>
          <button
            className={`user-settings-nav-item ${tab === "account" ? "active" : ""}`}
            onClick={() => setTab("account")}
          >
            My Account
          </button>
          <button
            className={`user-settings-nav-item ${tab === "profile" ? "active" : ""}`}
            onClick={() => setTab("profile")}
          >
            Profile
          </button>
          <button
            className={`user-settings-nav-item ${tab === "privacy" ? "active" : ""}`}
            onClick={() => setTab("privacy")}
          >
            Privacy
          </button>
          <button
            className={`user-settings-nav-item ${tab === "voice" ? "active" : ""}`}
            onClick={() => setTab("voice")}
          >
            Voice & Audio
          </button>
          <button
            className={`user-settings-nav-item ${tab === "appearance" ? "active" : ""}`}
            onClick={() => setTab("appearance")}
          >
            Appearance
          </button>
          <button
            className={`user-settings-nav-item ${tab === "security" ? "active" : ""}`}
            onClick={() => setTab("security")}
          >
            Security & Backup
          </button>
          <button
            className={`user-settings-nav-item ${tab === "accessibility" ? "active" : ""}`}
            onClick={() => setTab("accessibility")}
          >
            Accessibility
          </button>
          <div className="user-settings-sidebar-divider" />
          <button
            className="user-settings-nav-item danger"
            onClick={() => {
              useAuthStore.getState().logout();
              setShowUserSettings(false);
            }}
          >
            Log Out
          </button>
        </nav>
        <div className="user-settings-content">
          <div className="user-settings-content-header">
            <h2>{tab === "account" ? "My Account" : tab === "profile" ? "Profile" : tab === "privacy" ? "Privacy" : tab === "voice" ? "Voice & Audio" : tab === "appearance" ? "Appearance" : tab === "security" ? "Security & Backup" : "Accessibility"}</h2>
            <button className="settings-esc-close" onClick={() => setShowUserSettings(false)} aria-label="Close settings">
              <div className="settings-esc-circle">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </div>
              <span className="settings-esc-label">ESC</span>
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
      setPwError("All fields are required");
      return;
    }
    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("New passwords do not match");
      return;
    }
    setPwLoading(true);
    try {
      await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPwSuccess("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPwError(err.message || "Failed to change password");
    } finally {
      setPwLoading(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-card">
        <div className="settings-card-row">
          <div>
            <div className="settings-label">USERNAME</div>
            <div className="settings-value">{user.username}</div>
          </div>
        </div>
        <div className="settings-card-row">
          <div>
            <div className="settings-label">DISPLAY NAME</div>
            <div className="settings-value">{user.display_name || user.username}</div>
          </div>
        </div>
      </div>

      <div className="settings-section-title">Change Password</div>
      <div className="settings-fields">
        <label className="settings-field-label">
          Current Password
          <input
            className="settings-input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label className="settings-field-label">
          New Password
          <input
            className="settings-input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className="settings-field-label">
          Confirm New Password
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
          {pwLoading ? "Changing..." : "Change Password"}
        </button>
      </div>

      <div className="settings-section-title" style={{ marginTop: 32 }}>Delete Account</div>
      <p className="settings-description">
        Permanently delete your account and all associated data. This action cannot be undone.
      </p>
      {!showDeleteConfirm ? (
        <button
          className="btn-danger"
          onClick={() => setShowDeleteConfirm(true)}
        >
          Delete Account
        </button>
      ) : (
        <div className="delete-account-confirm">
          <p className="settings-description" style={{ color: "var(--red)", fontWeight: 600 }}>
            Are you sure? All your data, servers you own, and messages will be permanently deleted.
          </p>
          <label className="settings-field-label">
            Confirm Password
            <input
              className="settings-input"
              type="password"
              value={deletePassword}
              onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(""); }}
              placeholder="Enter your password to confirm"
              autoComplete="current-password"
            />
          </label>
          {deleteError && <div className="settings-error">{deleteError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              className="btn-secondary"
              onClick={() => { setShowDeleteConfirm(false); setDeletePassword(""); setDeleteError(""); }}
            >
              Cancel
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
                  setDeleteError(err.message || "Failed to delete account");
                } finally {
                  setDeleteLoading(false);
                }
              }}
            >
              {deleteLoading ? "Deleting..." : "Permanently Delete Account"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Profile Tab ────────────────────────────────────

function ProfileTab() {
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
      setSuccess("Profile updated");
    } catch (err: any) {
      setError(err.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Avatar must be under 2MB");
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
      setSuccess("Avatar updated");
    } catch (err: any) {
      setError(err.message || "Failed to upload avatar");
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("Banner must be under 8MB");
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
      setSuccess("Banner updated");
    } catch (err: any) {
      setError(err.message || "Failed to upload banner");
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
          {bannerUploading ? "Uploading..." : "Change Banner"}
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
            {avatarUploading ? "Uploading..." : "Change Avatar"}
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
          Display Name
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
          About Me
          <textarea
            className="settings-textarea"
            value={aboutMe}
            onChange={(e) => setAboutMe(e.target.value)}
            maxLength={190}
            rows={3}
            placeholder="Tell us about yourself"
          />
          <span className="settings-char-count">{aboutMe.length}/190</span>
        </label>
        <div className="settings-field-label">
          Custom Status
          <div className="settings-input-with-emoji">
            <input
              ref={statusInputRef}
              className="settings-input"
              type="text"
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              maxLength={128}
              placeholder="What's happening?"
            />
            <div className="settings-emoji-btn-wrap">
              <button
                type="button"
                className="create-channel-emoji-btn"
                onClick={() => setShowStatusEmoji(!showStatusEmoji)}
                title="Add emoji"
                aria-label="Add emoji to status"
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
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ─── Privacy Tab ────────────────────────────────────

function PrivacyTab() {
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
    return <div className="settings-section"><p className="settings-loading">Loading...</p></div>;
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Direct Message Privacy</div>
      <p className="settings-description">
        Choose who can send you direct messages.
      </p>
      <div className="settings-select-group">
        {[
          { value: "everyone", label: "Everyone" },
          { value: "friends_only", label: "Friends Only" },
          { value: "server_members", label: "Server Members" },
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
        Blocked Users {blockedUsers.length > 0 && `(${blockedUsers.length})`}
      </div>
      {blockedUsers.length === 0 ? (
        <p className="settings-description">You haven't blocked anyone.</p>
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
                Unblock
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
      <div className="settings-section-title">Input Device</div>
      <select
        className="settings-select"
        value={inputDeviceId}
        onChange={(e) => setInputDevice(e.target.value)}
      >
        <option value="">Default</option>
        {inputDevices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
          </option>
        ))}
      </select>

      <div className="settings-section-title">Input Volume</div>
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
          {testing ? "Stop Test" : "Test Microphone"}
        </button>
        {testing && (
          <div className="mic-level-bar">
            <div className="mic-level-fill" style={{ width: `${audioLevel}%` }} />
          </div>
        )}
      </div>

      <div className="settings-section-title" style={{ marginTop: 24 }}>Output Device</div>
      <select
        className="settings-select"
        value={outputDeviceId}
        onChange={(e) => setOutputDevice(e.target.value)}
      >
        <option value="">Default</option>
        {outputDevices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Speaker (${d.deviceId.slice(0, 8)})`}
          </option>
        ))}
      </select>

      <div className="settings-section-title">Output Volume</div>
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

      <div className="settings-section-title" style={{ marginTop: 24 }}>Voice Processing</div>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={echoCancellation}
          onChange={(e) => setEchoCancellation(e.target.checked)}
        />
        <span>Echo Cancellation</span>
      </label>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={noiseSuppression}
          onChange={(e) => setNoiseSuppression(e.target.checked)}
        />
        <span>Noise Suppression</span>
      </label>
    </div>
  );
}

// ─── Security & Backup Tab ──────────────────────────

function SecurityTab() {
  const api = useAuthStore((s) => s.api);

  const [backupExists, setBackupExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

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
    return () => { cancelled = true; };
  }, []);

  async function handleChangePhrase() {
    setError("");
    setSuccess("");
    if (newPhrase.length < 8) {
      setError("New phrase must be at least 8 characters");
      return;
    }
    if (newPhrase !== confirmPhrase) {
      setError("New phrases do not match");
      return;
    }
    setSaving(true);
    try {
      // If we have a cached phrase, use it; otherwise require the current phrase
      const cached = getCachedPhrase();
      if (!cached && !currentPhrase) {
        setError("Enter your current security phrase to verify identity");
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
      setSuccess("Security phrase updated successfully");
      setMode("idle");
      setBackupExists(true);
      setCurrentPhrase("");
      setNewPhrase("");
      setConfirmPhrase("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update. Is the current phrase correct?");
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
      setSuccess("Key backup created successfully");
      setMode("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create backup");
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
      setSuccess("Backup deleted");
      setMode("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete backup");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="settings-section"><p className="settings-loading">Loading...</p></div>;
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Key Backup Status</div>
      <p className="settings-description">
        Your key backup protects your encrypted messages. If you log in on a new device,
        you'll need your security phrase to restore access to your message history.
      </p>
      <div className="settings-card" style={{ marginBottom: 16 }}>
        <div className="settings-card-row">
          <div>
            <div className="settings-label">STATUS</div>
            <div className="settings-value">
              {backupExists ? (
                <span style={{ color: "var(--status-online, #3ba55d)" }}>Backup exists on server</span>
              ) : (
                <span style={{ color: "var(--status-dnd, #ed4245)" }}>No backup — messages won't transfer to new devices</span>
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
                Change Security Phrase
              </button>
              <button
                className="btn-secondary btn-danger-outline"
                onClick={handleDeleteBackup}
                disabled={saving}
              >
                Delete Backup
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-primary"
                onClick={() => { setMode("setup"); setError(""); setSuccess(""); }}
                style={{ marginRight: 8 }}
              >
                Set Up Security Phrase
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
                Generate Recovery Key
              </button>
            </>
          )}
        </div>
      )}

      {mode === "change" && (
        <div className="settings-fields">
          <div className="settings-section-title">Change Security Phrase</div>
          {!getCachedPhrase() && (
            <label className="settings-field-label">
              Current Security Phrase
              <input
                className="settings-input"
                type="password"
                value={currentPhrase}
                onChange={(e) => { setCurrentPhrase(e.target.value); setError(""); }}
                placeholder="Enter your current phrase..."
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
            Generate Phrase
          </button>
          {newPhrase && newPhrase === confirmPhrase && newPhrase.includes("-") && (
            <div className="recovery-key-display" style={{ marginBottom: 12 }}>
              <code>{newPhrase}</code>
              <button
                className="btn-secondary"
                style={{ marginTop: 8, width: "100%" }}
                onClick={() => navigator.clipboard.writeText(newPhrase)}
              >
                Copy to Clipboard
              </button>
            </div>
          )}
          <label className="settings-field-label">
            New Security Phrase
            <input
              className="settings-input"
              type="password"
              value={newPhrase}
              onChange={(e) => { setNewPhrase(e.target.value); setError(""); }}
              placeholder="At least 8 characters..."
            />
          </label>
          <label className="settings-field-label">
            Confirm New Phrase
            <input
              className="settings-input"
              type="password"
              value={confirmPhrase}
              onChange={(e) => { setConfirmPhrase(e.target.value); setError(""); }}
              placeholder="Confirm new phrase..."
              onKeyDown={(e) => e.key === "Enter" && handleChangePhrase()}
            />
          </label>
          {error && <div className="settings-error">{error}</div>}
          <div className="security-phrase-actions">
            <button className="btn-secondary" onClick={() => setMode("idle")}>Cancel</button>
            <button
              className="btn-primary"
              onClick={handleChangePhrase}
              disabled={saving || !newPhrase || !confirmPhrase}
              style={{ marginLeft: 8 }}
            >
              {saving ? "Saving..." : "Update Phrase"}
            </button>
          </div>
        </div>
      )}

      {mode === "setup" && (
        <div className="settings-fields">
          <div className="settings-section-title">Create Security Phrase</div>
          <p className="settings-description">
            Choose a strong phrase you'll remember, or generate one automatically.
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
            Generate Phrase
          </button>
          {newPhrase && newPhrase === confirmPhrase && newPhrase.includes("-") && (
            <div className="recovery-key-display" style={{ marginBottom: 12 }}>
              <code>{newPhrase}</code>
              <button
                className="btn-secondary"
                style={{ marginTop: 8, width: "100%" }}
                onClick={() => navigator.clipboard.writeText(newPhrase)}
              >
                Copy to Clipboard
              </button>
            </div>
          )}
          <label className="settings-field-label">
            Security Phrase
            <input
              className="settings-input"
              type="password"
              value={newPhrase}
              onChange={(e) => { setNewPhrase(e.target.value); setError(""); }}
              placeholder="At least 8 characters..."
              autoFocus
            />
          </label>
          <label className="settings-field-label">
            Confirm Phrase
            <input
              className="settings-input"
              type="password"
              value={confirmPhrase}
              onChange={(e) => { setConfirmPhrase(e.target.value); setError(""); }}
              placeholder="Confirm phrase..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPhrase.length >= 8 && newPhrase === confirmPhrase) {
                  handleSetupWithPhrase(newPhrase);
                }
              }}
            />
          </label>
          {error && <div className="settings-error">{error}</div>}
          <div className="security-phrase-actions">
            <button className="btn-secondary" onClick={() => setMode("idle")}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => {
                if (newPhrase.length < 8) { setError("Must be at least 8 characters"); return; }
                if (newPhrase !== confirmPhrase) { setError("Phrases do not match"); return; }
                handleSetupWithPhrase(newPhrase);
              }}
              disabled={saving || !newPhrase || !confirmPhrase}
              style={{ marginLeft: 8 }}
            >
              {saving ? "Saving..." : "Create Backup"}
            </button>
          </div>
        </div>
      )}

      {mode === "generated" && (
        <div className="settings-fields">
          <div className="settings-section-title">Your Recovery Key</div>
          <p className="settings-description">
            Copy this key and store it somewhere safe. You'll need it on other devices.
          </p>
          <div className="recovery-key-display">
            <code>{recoveryKey}</code>
          </div>
          <button
            className="btn-secondary"
            style={{ width: "100%", marginBottom: 12 }}
            onClick={() => navigator.clipboard.writeText(recoveryKey)}
          >
            Copy to Clipboard
          </button>
          <label className="security-phrase-confirm-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I have saved my recovery key
          </label>
          {error && <div className="settings-error">{error}</div>}
          <div className="security-phrase-actions">
            <button className="btn-secondary" onClick={() => setMode("idle")}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => handleSetupWithPhrase(recoveryKey)}
              disabled={!confirmed || saving}
              style={{ marginLeft: 8 }}
            >
              {saving ? "Saving..." : "Save Backup"}
            </button>
          </div>
        </div>
      )}

      {success && <div className="settings-success" style={{ marginTop: 12 }}>{success}</div>}
    </div>
  );
}

// ─── Appearance Tab ─────────────────────────────────

function AppearanceTab() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const themes: { value: Theme; label: string; colors: string[] }[] = [
    {
      value: "night",
      label: "Night Mode",
      colors: ["#1e1f22", "#2b2d31", "#313338", "#5865f2", "#dbdee1"],
    },
    {
      value: "default",
      label: "Default",
      colors: ["#E2D9CC", "#EAE3D7", "#F5F0E8", "#C2410C", "#3D3029"],
    },
    {
      value: "light",
      label: "Light Mode",
      colors: ["#E3E5E8", "#F2F3F5", "#FFFFFF", "#4752C4", "#2E3338"],
    },
    {
      value: "sage",
      label: "Sage",
      colors: ["#171717", "#212121", "#2D2D2D", "#10A37F", "#ECECEC"],
    },
    {
      value: "cosmos",
      label: "Cosmos",
      colors: ["#131620", "#1B1F2E", "#232736", "#8B6CEF", "#E3E5EA"],
    },
    {
      value: "forest",
      label: "Forest",
      colors: ["#1A2318", "#222E1F", "#2A3627", "#5FAD56", "#D4DDD2"],
    },
    {
      value: "bluebird",
      label: "Bluebird",
      colors: ["#E8ECF0", "#F5F8FA", "#FFFFFF", "#0C7ABF", "#14171A"],
    },
  ];

  const customCss = useUiStore((s) => s.customCss);
  const setCustomCss = useUiStore((s) => s.setCustomCss);

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">Theme</div>
        <p className="settings-description">Choose how Haven looks for you.</p>
        <div className="theme-picker">
          {themes.map((t) => (
            <button
              key={t.value}
              className={`theme-card ${theme === t.value ? "selected" : ""}`}
              onClick={() => setTheme(t.value)}
              aria-pressed={theme === t.value}
            >
              <div className="theme-preview">
                {t.colors.map((c, i) => (
                  <div key={i} className="theme-swatch" style={{ background: c }} />
                ))}
              </div>
              <span className="theme-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">Custom CSS</div>
        <p className="settings-description">
          Advanced: paste your own CSS to customize Haven's appearance. Changes apply immediately.
          For security, <code>@import</code>, <code>url()</code>, and <code>expression()</code> are stripped.
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
            Clear Custom CSS
          </button>
        )}
      </div>
    </>
  );
}

// ─── Accessibility Tab ──────────────────────────────

function AccessibilityTab() {
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
      <div className="settings-section-title">Motion</div>
      <p className="settings-description">
        Reduce or remove animations and transitions throughout the app.
      </p>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={reducedMotion}
          onChange={(e) => setReducedMotion(e.target.checked)}
        />
        <span>Reduce Motion</span>
      </label>
      <p className="settings-hint">
        When enabled, most animations and transitions will be disabled. This also applies
        when your operating system's "reduce motion" preference is active.
      </p>

      <div className="settings-section-title" style={{ marginTop: 24 }}>Font</div>
      <p className="settings-description">
        Choose a font optimized for readability.
      </p>
      <div className="settings-select-group">
        {([
          { value: "default", label: "Default (gg sans)" },
          { value: "opendyslexic", label: "OpenDyslexic" },
          { value: "atkinson", label: "Atkinson Hyperlegible" },
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

      <div className="settings-section-title" style={{ marginTop: 24 }}>Contrast</div>
      <p className="settings-description">
        Increase the contrast of text and UI elements for better visibility.
      </p>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={highContrast}
          onChange={(e) => setHighContrast(e.target.checked)}
        />
        <span>High Contrast Mode</span>
      </label>

      <div className="settings-section-title" style={{ marginTop: 24 }}>Chat Display</div>
      <p className="settings-description">
        Make chat messages easier to parse for screen readers and visual clarity.
      </p>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={alwaysShowTimestamps}
          onChange={(e) => setAlwaysShowTimestamps(e.target.checked)}
        />
        <span>Always Show Message Timestamps</span>
      </label>
      <p className="settings-hint">
        Show full timestamps and author names on every message, instead of grouping consecutive messages from the same user.
      </p>
    </div>
  );
}
