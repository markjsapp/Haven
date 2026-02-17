import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div
        className="modal-dialog confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
      >
        <h3 className="modal-title" id="confirm-dialog-title">{title}</h3>
        <p className="confirm-dialog-message" id="confirm-dialog-desc">{message}</p>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {cancelLabel ?? t("confirmDialog.defaultCancel")}
          </button>
          <button
            type="button"
            className={`btn-primary modal-submit ${danger ? "btn-danger" : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel ?? t("confirmDialog.defaultConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
