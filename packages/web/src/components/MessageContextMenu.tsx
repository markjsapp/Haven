import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore, type DecryptedMessage } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { Permission } from "@haven/core";
import { usePermissions } from "../hooks/usePermissions.js";
import { useMenuKeyboard } from "../hooks/useMenuKeyboard.js";

interface MessageContextMenuProps {
  message: DecryptedMessage;
  x: number;
  y: number;
  isPinned: boolean;
  serverId?: string | null;
  onClose: () => void;
  onDelete: () => void;
  onReport: () => void;
}

export default function MessageContextMenu({
  message,
  x,
  y,
  isPinned,
  serverId,
  onClose,
  onDelete,
  onReport,
}: MessageContextMenuProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const startReply = useChatStore((s) => s.startReply);
  const startEditing = useChatStore((s) => s.startEditing);
  const pinMessage = useChatStore((s) => s.pinMessage);
  const unpinMessage = useChatStore((s) => s.unpinMessage);
  const { can } = usePermissions(serverId);
  const ref = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useMenuKeyboard(ref);

  const isOwn = message.senderId === user?.id;
  const canManageMessages = can(Permission.MANAGE_MESSAGES);

  // Close on outside click, scroll, or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleScroll() {
      onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  // Clamp position to viewport
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(y, window.innerHeight - 250),
    left: Math.min(x, window.innerWidth - 180),
    zIndex: 1000,
  };

  return (
    <div className="message-context-menu" style={style} ref={ref} role="menu" aria-label={t("messageContext.ariaLabel")} tabIndex={-1} onKeyDown={handleKeyDown}>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="context-menu-item"
        onClick={() => { startReply(message.id); onClose(); }}
      >
        {t("messageContext.reply")}
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="context-menu-item"
        onClick={() => {
          navigator.clipboard.writeText(message.text);
          onClose();
        }}
      >
        {t("messageContext.copyText")}
      </button>
      {canManageMessages && (
        <>
          <div className="context-menu-separator" role="separator" />
          {isPinned ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="context-menu-item"
              onClick={() => { unpinMessage(message.id); onClose(); }}
            >
              {t("messageContext.unpinMessage")}
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="context-menu-item"
              onClick={() => { pinMessage(message.id); onClose(); }}
            >
              {t("messageContext.pinMessage")}
            </button>
          )}
        </>
      )}
      {isOwn && (
        <>
          <div className="context-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="context-menu-item"
            onClick={() => { startEditing(message.id); onClose(); }}
          >
            {t("messageContext.editMessage")}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="context-menu-item context-menu-item-danger"
            onClick={() => { onDelete(); onClose(); }}
          >
            {t("messageContext.deleteMessage")}
          </button>
        </>
      )}
      {!isOwn && (
        <>
          <div className="context-menu-separator" role="separator" />
          {canManageMessages && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="context-menu-item context-menu-item-danger"
              onClick={() => { onDelete(); onClose(); }}
            >
              {t("messageContext.deleteMessage")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="context-menu-item context-menu-item-danger"
            onClick={() => { onReport(); onClose(); }}
          >
            {t("messageContext.reportMessage")}
          </button>
        </>
      )}
    </div>
  );
}
