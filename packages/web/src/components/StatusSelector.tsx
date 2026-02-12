import { useEffect, useRef } from "react";
import { usePresenceStore, STATUS_CONFIG, type PresenceStatus } from "../store/presence.js";

const STATUS_OPTIONS: PresenceStatus[] = ["online", "idle", "dnd", "invisible"];

interface StatusSelectorProps {
  onClose: () => void;
}

export default function StatusSelector({ onClose }: StatusSelectorProps) {
  const ownStatus = usePresenceStore((s) => s.ownStatus);
  const setOwnStatus = usePresenceStore((s) => s.setOwnStatus);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div className="status-selector" ref={ref}>
      {STATUS_OPTIONS.map((status) => {
        const config = STATUS_CONFIG[status];
        return (
          <button
            key={status}
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
    </div>
  );
}
