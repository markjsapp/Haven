import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

interface LinkWarningModalProps {
  url: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function LinkWarningModal({ url, onConfirm, onCancel }: LinkWarningModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div className="modal-dialog link-warning-dialog" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="link-warning-title">
        <h3 className="modal-title" id="link-warning-title">{t("linkWarning.title")}</h3>
        <p className="link-warning-subtitle">
          {t("linkWarning.message")}
        </p>
        <div className="link-warning-url">{url}</div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {t("linkWarning.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary modal-submit"
            onClick={onConfirm}
          >
            {t("linkWarning.visitSite")}
          </button>
        </div>
      </div>
    </div>
  );
}
