import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

interface ErrorModalProps {
  title?: string;
  message: string;
  onClose: () => void;
}

export default function ErrorModal({ title, message, onClose }: ErrorModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-dialog error-modal" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="error-modal-title">
        <div className="error-modal-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="var(--red)" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
        </div>
        <h3 className="modal-title" id="error-modal-title">{title ?? t("errorModal.defaultTitle")}</h3>
        <p className="error-modal-message">{message}</p>
        <div className="modal-footer error-modal-footer">
          <button type="button" className="btn-primary modal-submit" onClick={onClose}>
            {t("errorModal.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
