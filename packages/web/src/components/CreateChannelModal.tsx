import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { unicodeBtoa } from "../lib/base64.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import EmojiPicker from "./EmojiPicker.js";

interface Props {
  serverId: string;
  categoryId?: string | null;
  categoryName?: string;
  onClose: () => void;
}

export default function CreateChannelModal({ serverId, categoryId, categoryName, onClose }: Props) {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const loadChannels = useChatStore((s) => s.loadChannels);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const [channelType, setChannelType] = useState<"text" | "voice">("text");
  const [channelName, setChannelName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Auto-format channel name (lowercase ASCII, replace spaces with hyphens, allow emoji)
  function formatName(raw: string) {
    // Split into grapheme clusters to preserve emoji sequences
    let result = "";
    for (const ch of raw) {
      if (/\s/.test(ch)) { result += "-"; continue; }
      // Keep emoji-related code points as-is
      const cp = ch.codePointAt(0) ?? 0;
      if (cp > 127) { result += ch; continue; }
      // ASCII: lowercase, keep letters/digits/hyphens/underscores
      const lower = ch.toLowerCase();
      if (/[a-z0-9\-_]/.test(lower)) result += lower;
    }
    return result;
  }

  async function handleCreate() {
    const name = channelName.trim();
    if (!name) return;
    setError("");
    setLoading(true);
    try {
      const meta = JSON.stringify({ name });
      await api.createChannel(serverId, {
        encrypted_meta: unicodeBtoa(meta),
        channel_type: channelType,
        category_id: categoryId ?? undefined,
        is_private: isPrivate || undefined,
      });
      await loadChannels();
      onClose();
    } catch (err: any) {
      setError(err.message || t("createChannel.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-dialog create-channel-modal" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-channel-title">
        <div className="modal-dialog-header">
          <h2 className="modal-title" id="create-channel-title">{t("createChannel.title")}</h2>
          {categoryName && (
            <p className="modal-subtitle">{t("createChannel.inCategory", { categoryName })}</p>
          )}
          <button className="modal-close-btn" onClick={onClose} aria-label={t("createChannel.close")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
            </svg>
          </button>
        </div>

        <div className="create-channel-body">
          <fieldset className="modal-fieldset">
          <legend className="modal-label">{t("createChannel.channelTypeLabel")}</legend>
          <div className="create-channel-types">
            <label
              className={`create-channel-type-option ${channelType === "text" ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="channelType"
                value="text"
                checked={channelType === "text"}
                onChange={() => setChannelType("text")}
              />
              <div className="create-channel-type-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.88 21l.85-4H2.5l.41-2h4.24l.85-4H3.76l.41-2h4.24L9.26 5h2l-.85 4h4l.85-4h2l-.85 4h4.24l-.41 2h-4.24l-.85 4h4.24l-.41 2h-4.24L14.74 21h-2l.85-4h-4l-.85 4h-2zm3.54-6h4l.85-4h-4l-.85 4z" />
                </svg>
              </div>
              <div className="create-channel-type-info">
                <span className="create-channel-type-name">{t("createChannel.textName")}</span>
                <span className="create-channel-type-desc">{t("createChannel.textDescription")}</span>
              </div>
              <span className="create-channel-type-radio" />
            </label>

            <label
              className={`create-channel-type-option ${channelType === "voice" ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="channelType"
                value="voice"
                checked={channelType === "voice"}
                onChange={() => setChannelType("voice")}
              />
              <div className="create-channel-type-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              </div>
              <div className="create-channel-type-info">
                <span className="create-channel-type-name">{t("createChannel.voiceName")}</span>
                <span className="create-channel-type-desc">{t("createChannel.voiceDescription")}</span>
              </div>
              <span className="create-channel-type-radio" />
            </label>
          </div>
          </fieldset>

          <label className="modal-label" htmlFor="create-channel-name">{t("createChannel.channelNameLabel")}</label>
          <div className="create-channel-name-input">
            <span className="create-channel-name-prefix">
              {channelType === "text" ? "#" : "\uD83C\uDF99"}
            </span>
            <input
              id="create-channel-name"
              ref={nameInputRef}
              type="text"
              className="modal-input"
              placeholder={t("createChannel.channelNamePlaceholder")}
              value={channelName}
              onChange={(e) => setChannelName(formatName(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
              maxLength={100}
            />
            <div className="create-channel-emoji-wrap">
              <button
                type="button"
                className="create-channel-emoji-btn"
                onClick={() => setShowEmoji(!showEmoji)}
                title={t("createChannel.addEmoji")}
                aria-label={t("createChannel.addEmojiToName")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
                </svg>
              </button>
              {showEmoji && (
                <EmojiPicker
                  onSelect={(emoji) => {
                    setChannelName((prev) => prev + emoji);
                    setShowEmoji(false);
                    nameInputRef.current?.focus();
                  }}
                  onClose={() => setShowEmoji(false)}
                />
              )}
            </div>
          </div>

          <label className="create-channel-private-toggle">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="lock-icon">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" />
            </svg>
            <span>{t("createChannel.privateChannel")}</span>
          </label>
          {isPrivate && (
            <p className="create-channel-private-hint">
              {t("createChannel.privateHint")}
            </p>
          )}

          {error && <span className="modal-error" role="alert">{error}</span>}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>{t("createChannel.cancel")}</button>
          <button
            className="btn-primary modal-submit"
            onClick={handleCreate}
            disabled={loading || !channelName.trim()}
          >
            {loading ? t("createChannel.submitLoading") : t("createChannel.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
