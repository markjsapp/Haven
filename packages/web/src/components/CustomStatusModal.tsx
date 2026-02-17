import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import EmojiPicker from "./EmojiPicker.js";
import type { UserPublic } from "@haven/core";

interface Props {
  initialStatus?: string | null;
  initialEmoji?: string | null;
  onClose: () => void;
}

export default function CustomStatusModal({ initialStatus, initialEmoji, onClose }: Props) {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const user = useAuthStore((s) => s.user);
  const [statusText, setStatusText] = useState(initialStatus || "");
  const [emoji, setEmoji] = useState(initialEmoji || "");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    if (showEmojiPicker) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showEmojiPicker]);

  async function handleSave() {
    setLoading(true);
    setError("");
    try {
      const newStatus = statusText.trim() || null;
      const newEmoji = emoji || null;
      await api.updateProfile({
        custom_status: newStatus,
        custom_status_emoji: newEmoji,
      });
      // Update local user state
      if (user) {
        useAuthStore.setState({ user: { ...user, custom_status: newStatus, custom_status_emoji: newEmoji } as UserPublic });
      }
      onClose();
    } catch (err: any) {
      setError(err.message || t("customStatus.updateFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    setLoading(true);
    setError("");
    try {
      await api.updateProfile({
        custom_status: null,
        custom_status_emoji: null,
      });
      if (user) {
        useAuthStore.setState({ user: { ...user, custom_status: null, custom_status_emoji: null } as UserPublic });
      }
      onClose();
    } catch (err: any) {
      setError(err.message || t("customStatus.clearFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-dialog custom-status-modal" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="custom-status-title">
        <h3 className="modal-title" id="custom-status-title">{t("customStatus.title")}</h3>

        <div className="custom-status-input-row">
          <input
            ref={inputRef}
            className="custom-status-input"
            type="text"
            placeholder={t("customStatus.placeholder")}
            value={statusText}
            onChange={(e) => setStatusText(e.target.value.slice(0, 128))}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            maxLength={128}
          />
          <div className="custom-status-emoji-btn-wrap" ref={pickerRef}>
            <button
              className="custom-status-emoji-btn"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              title={t("customStatus.pickEmoji")}
            >
              {emoji || "\uD83D\uDE00"}
            </button>
            {showEmojiPicker && (
              <div className="custom-status-emoji-picker">
                <EmojiPicker
                  onSelect={(native) => {
                    setEmoji(native);
                    setShowEmojiPicker(false);
                  }}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="custom-status-char-count">
          {statusText.length}/128
        </div>

        {error && <div className="error-small">{error}</div>}

        <div className="modal-footer">
          {(initialStatus || initialEmoji) && (
            <button type="button" className="btn-ghost" onClick={handleClear} disabled={loading}>
              {t("customStatus.clearStatus")}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t("customStatus.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary modal-submit"
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? t("customStatus.submitLoading") : t("customStatus.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
