import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "../store/auth.js";
import { useUiStore } from "../store/ui.js";
import { useVoiceStore } from "../store/voice.js";
import Avatar from "./Avatar.js";
import type { BlockedUserResponse } from "@haven/core";

type Tab = "account" | "profile" | "privacy" | "voice";

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

  if (!user) return null;

  return (
    <div className="user-settings-overlay">
      <div className="user-settings-modal">
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
            <h2>{tab === "account" ? "My Account" : tab === "profile" ? "Profile" : tab === "privacy" ? "Privacy" : "Voice & Audio"}</h2>
            <button
              className="user-settings-close"
              onClick={() => setShowUserSettings(false)}
              title="Close"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
          <div className="user-settings-content-body">
            {tab === "account" && <AccountTab />}
            {tab === "profile" && <ProfileTab />}
            {tab === "privacy" && <PrivacyTab />}
            {tab === "voice" && <VoiceTab />}
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="settings-section">
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
        <label className="settings-field-label">
          Custom Status
          <input
            className="settings-input"
            type="text"
            value={customStatus}
            onChange={(e) => setCustomStatus(e.target.value)}
            maxLength={128}
            placeholder="What's happening?"
          />
        </label>
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
