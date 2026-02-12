interface LinkWarningModalProps {
  url: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function LinkWarningModal({ url, onConfirm, onCancel }: LinkWarningModalProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-dialog link-warning-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Leaving Haven</h3>
        <p className="link-warning-subtitle">
          You are about to visit an external website. Make sure you trust this link before continuing.
        </p>
        <div className="link-warning-url">{url}</div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary modal-submit"
            onClick={onConfirm}
          >
            Visit Site
          </button>
        </div>
      </div>
    </div>
  );
}
