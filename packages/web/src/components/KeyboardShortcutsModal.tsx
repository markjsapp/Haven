import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "\u2318" : "Ctrl";

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  label: string;
  shortcuts: Shortcut[];
}

const groups: ShortcutGroup[] = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: [mod, "K"], description: "Open command palette" },
      { keys: ["Esc"], description: "Close modal / panel" },
      { keys: ["\u2191", "\u2193"], description: "Navigate lists" },
      { keys: ["Enter"], description: "Activate selection" },
    ],
  },
  {
    label: "Messages",
    shortcuts: [
      { keys: ["Enter"], description: "Send message" },
      { keys: ["Shift", "Enter"], description: "New line in message" },
      { keys: [mod, "B"], description: "Bold text" },
      { keys: [mod, "I"], description: "Italic text" },
    ],
  },
  {
    label: "Voice",
    shortcuts: [
      { keys: [mod, "Shift", "M"], description: "Toggle mute" },
      { keys: [mod, "Shift", "D"], description: "Toggle deafen" },
    ],
  },
  {
    label: "General",
    shortcuts: [
      { keys: ["?"], description: "Keyboard shortcuts" },
      { keys: [mod, "Shift", "I"], description: "Toggle member sidebar" },
    ],
  },
];

export default function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog keyboard-shortcuts-modal" ref={ref} role="dialog" aria-label="Keyboard Shortcuts">
        <div className="modal-dialog-header">
          <h3 className="modal-title">Keyboard Shortcuts</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" /></svg>
          </button>
        </div>
        <div className="keyboard-shortcuts-grid">
          {groups.map((group) => (
            <div key={group.label} className="keyboard-shortcuts-section">
              <h4 className="keyboard-shortcuts-section-title">{group.label}</h4>
              {group.shortcuts.map((sc, i) => (
                <div key={i} className="keyboard-shortcut-row">
                  <span className="keyboard-shortcut-desc">{sc.description}</span>
                  <span className="keyboard-shortcut-keys">
                    {sc.keys.map((k, j) => (
                      <span key={j}>
                        <kbd className="keyboard-shortcut-key">{k}</kbd>
                        {j < sc.keys.length - 1 && <span className="keyboard-shortcut-plus">+</span>}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
