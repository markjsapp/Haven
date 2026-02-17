import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { usePresenceStore, STATUS_CONFIG, type PresenceStatus } from "../store/presence.js";

const STATUS_OPTIONS: PresenceStatus[] = ["online", "idle", "dnd", "invisible"];

interface StatusSelectorProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export default function StatusSelector({ anchorRef, onClose }: StatusSelectorProps) {
  const { t } = useTranslation();
  const ownStatus = usePresenceStore((s) => s.ownStatus);
  const setOwnStatus = usePresenceStore((s) => s.setOwnStatus);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  // Calculate position from anchor element
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 4,
      });
    }
  }, [anchorRef]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      className="status-selector"
      ref={ref}
      style={{ left: pos.left, bottom: pos.bottom }}
      role="listbox"
      aria-label={t("statusSelector.ariaLabel")}
    >
      {STATUS_OPTIONS.map((status) => {
        const config = STATUS_CONFIG[status];
        return (
          <button
            key={status}
            role="option"
            aria-selected={status === ownStatus}
            className={`status-selector-item ${status === ownStatus ? "active" : ""}`}
            onClick={() => {
              setOwnStatus(status);
              onClose();
            }}
          >
            <span className="status-dot" style={{ backgroundColor: config.color }} />
            <span className="status-label">{config.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
