import { useState, useRef } from "react";
import { useAuthStore } from "../store/auth.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

interface ReportModalProps {
  messageId: string;
  channelId: string;
  onClose: () => void;
}

export default function ReportModal({ messageId, channelId, onClose }: ReportModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const { api } = useAuthStore.getState();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 10) {
      setError("Reason must be at least 10 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.reportMessage({
        message_id: messageId,
        channel_id: channelId,
        reason: reason.trim(),
      });
      setSubmitted(true);
      setTimeout(onClose, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-content" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
        <h3 id="report-modal-title">Report Message</h3>
        {submitted ? (
          <p className="report-success">Report submitted. Thank you.</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <textarea
              className="report-reason"
              placeholder="Describe the issue (min 10 characters)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              autoFocus
            />
            {error && <p className="report-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || reason.trim().length < 10}
              >
                {submitting ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
