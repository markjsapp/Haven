import { useState, useRef } from "react";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

interface Props {
  serverId: string;
  categoryId?: string | null;
  categoryName?: string;
  onClose: () => void;
}

export default function CreateChannelModal({ serverId, categoryId, categoryName, onClose }: Props) {
  const api = useAuthStore((s) => s.api);
  const loadChannels = useChatStore((s) => s.loadChannels);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const [channelType, setChannelType] = useState<"text" | "voice">("text");
  const [channelName, setChannelName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Auto-format channel name (lowercase, replace spaces with hyphens)
  function formatName(raw: string) {
    return raw
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-_]/g, "");
  }

  async function handleCreate() {
    const name = channelName.trim();
    if (!name) return;
    setError("");
    setLoading(true);
    try {
      const meta = JSON.stringify({ name });
      await api.createChannel(serverId, {
        encrypted_meta: btoa(meta),
        channel_type: channelType,
        category_id: categoryId ?? undefined,
      });
      await loadChannels();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create channel");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-dialog create-channel-modal" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-channel-title">
        <div className="modal-dialog-header">
          <h2 className="modal-title" id="create-channel-title">Create Channel</h2>
          {categoryName && (
            <p className="modal-subtitle">in {categoryName}</p>
          )}
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
            </svg>
          </button>
        </div>

        <div className="create-channel-body">
          <label className="modal-label">CHANNEL TYPE</label>
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
                <span className="create-channel-type-name">Text</span>
                <span className="create-channel-type-desc">Send messages, images, GIFs, emoji, opinions, and puns</span>
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
                <span className="create-channel-type-name">Voice</span>
                <span className="create-channel-type-desc">Hang out together with voice, video, and screen share</span>
              </div>
              <span className="create-channel-type-radio" />
            </label>
          </div>

          <label className="modal-label">CHANNEL NAME</label>
          <div className="create-channel-name-input">
            <span className="create-channel-name-prefix">
              {channelType === "text" ? "#" : "\uD83C\uDF99"}
            </span>
            <input
              type="text"
              className="modal-input"
              placeholder="new-channel"
              value={channelName}
              onChange={(e) => setChannelName(formatName(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
              maxLength={100}
            />
          </div>

          {error && <span className="modal-error">{error}</span>}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary modal-submit"
            onClick={handleCreate}
            disabled={loading || !channelName.trim()}
          >
            {loading ? "Creating..." : "Create Channel"}
          </button>
        </div>
      </div>
    </div>
  );
}
