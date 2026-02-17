import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "\u2318" : "Ctrl";

interface Shortcut {
  keys: string[];
  descriptionKey: string;
}

interface ShortcutGroup {
  labelKey: string;
  shortcuts: Shortcut[];
}

const groups: ShortcutGroup[] = [
  {
    labelKey: "keyboardShortcuts.navigation",
    shortcuts: [
      { keys: [mod, "K"], descriptionKey: "keyboardShortcuts.openCommandPalette" },
      { keys: ["Esc"], descriptionKey: "keyboardShortcuts.closeModalPanel" },
      { keys: ["\u2191", "\u2193"], descriptionKey: "keyboardShortcuts.navigateLists" },
      { keys: ["Enter"], descriptionKey: "keyboardShortcuts.activateSelection" },
      { keys: ["Alt", "\u2191"], descriptionKey: "keyboardShortcuts.previousUnreadChannel" },
      { keys: ["Alt", "\u2193"], descriptionKey: "keyboardShortcuts.nextUnreadChannel" },
    ],
  },
  {
    labelKey: "keyboardShortcuts.messages",
    shortcuts: [
      { keys: ["Enter"], descriptionKey: "keyboardShortcuts.sendMessage" },
      { keys: ["Shift", "Enter"], descriptionKey: "keyboardShortcuts.newLine" },
      { keys: [mod, "B"], descriptionKey: "keyboardShortcuts.boldText" },
      { keys: [mod, "I"], descriptionKey: "keyboardShortcuts.italicText" },
    ],
  },
  {
    labelKey: "keyboardShortcuts.voice",
    shortcuts: [
      { keys: [mod, "Shift", "M"], descriptionKey: "keyboardShortcuts.toggleMute" },
      { keys: [mod, "Shift", "D"], descriptionKey: "keyboardShortcuts.toggleDeafen" },
    ],
  },
  {
    labelKey: "keyboardShortcuts.general",
    shortcuts: [
      { keys: ["?"], descriptionKey: "keyboardShortcuts.keyboardShortcutsShortcut" },
      { keys: [mod, "Shift", "I"], descriptionKey: "keyboardShortcuts.toggleMemberSidebar" },
    ],
  },
];

export default function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
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
      <div className="modal-dialog keyboard-shortcuts-modal" ref={ref} role="dialog" aria-label={t("keyboardShortcuts.title")}>
        <div className="modal-dialog-header">
          <h3 className="modal-title">{t("keyboardShortcuts.title")}</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label={t("keyboardShortcuts.close")}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" /></svg>
          </button>
        </div>
        <div className="keyboard-shortcuts-grid">
          {groups.map((group) => (
            <div key={group.labelKey} className="keyboard-shortcuts-section">
              <h4 className="keyboard-shortcuts-section-title">{t(group.labelKey)}</h4>
              {group.shortcuts.map((sc, i) => (
                <div key={i} className="keyboard-shortcut-row">
                  <span className="keyboard-shortcut-desc">{t(sc.descriptionKey)}</span>
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
