import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

interface Props {
  serverId: string;
  userId: string;
  username: string;
  onBanned: (userId: string) => void;
  onClose: () => void;
}

export default function BanMemberModal({ serverId, userId, username, onBanned, onClose }: Props) {
  const { t } = useTranslation();
  const api = useAuthStore((s) => s.api);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
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
      setError(err.message || t("banMember.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-dialog ban-modal" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="ban-modal-title">
        <h3 className="modal-title" id="ban-modal-title">{t("banMember.title", { username })}</h3>
        <p className="ban-modal-subtitle">
          Are you sure you want to ban <strong>{username}</strong> from this server?
          They will be kicked and unable to rejoin.
        </p>

        <label className="ban-modal-label">
          {t("banMember.reasonLabel")}
          <textarea
            className="ban-modal-textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("banMember.reasonPlaceholder")}
            maxLength={512}
            rows={3}
          />
        </label>

        {error && <div className="error-small">{error}</div>}

        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t("banMember.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary modal-submit btn-danger"
            onClick={handleBan}
            disabled={loading}
          >
            {loading ? t("banMember.submitLoading") : t("banMember.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
