import { useState } from "react";
import { useAuthStore } from "../store/auth.js";

interface Props {
  serverId: string;
  userId: string;
  username: string;
  onBanned: (userId: string) => void;
  onClose: () => void;
}

export default function BanMemberModal({ serverId, userId, username, onBanned, onClose }: Props) {
  const api = useAuthStore((s) => s.api);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleBan() {
    setLoading(true);
    setError("");
    try {
      await api.banMember(serverId, userId, { reason: reason.trim() || undefined });
      onBanned(userId);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to ban member");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog ban-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Ban {username}</h3>
        <p className="ban-modal-subtitle">
          Are you sure you want to ban <strong>{username}</strong> from this server?
          They will be kicked and unable to rejoin.
        </p>

        <label className="ban-modal-label">
          Reason (optional)
          <textarea
            className="ban-modal-textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter a reason for the ban..."
            maxLength={512}
            rows={3}
          />
        </label>

        {error && <div className="error-small">{error}</div>}

        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary modal-submit btn-danger"
            onClick={handleBan}
            disabled={loading}
          >
            {loading ? "Banning..." : "Ban"}
          </button>
        </div>
      </div>
    </div>
  );
}
