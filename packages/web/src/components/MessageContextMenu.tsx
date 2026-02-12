import { useEffect, useRef } from "react";
import { useChatStore, type DecryptedMessage } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";

interface MessageContextMenuProps {
  message: DecryptedMessage;
  x: number;
  y: number;
  isPinned: boolean;
  onClose: () => void;
  onDelete: () => void;
  onReport: () => void;
}

export default function MessageContextMenu({
  message,
  x,
  y,
  isPinned,
  onClose,
  onDelete,
  onReport,
}: MessageContextMenuProps) {
  const user = useAuthStore((s) => s.user);
  const startReply = useChatStore((s) => s.startReply);
  const startEditing = useChatStore((s) => s.startEditing);
  const pinMessage = useChatStore((s) => s.pinMessage);
  const unpinMessage = useChatStore((s) => s.unpinMessage);
  const ref = useRef<HTMLDivElement>(null);

  const isOwn = message.senderId === user?.id;

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
    <div className="message-context-menu" style={style} ref={ref}>
      <button
        type="button"
        className="context-menu-item"
        onClick={() => { startReply(message.id); onClose(); }}
      >
        Reply
      </button>
      <button
        type="button"
        className="context-menu-item"
        onClick={() => {
          navigator.clipboard.writeText(message.text);
          onClose();
        }}
      >
        Copy Text
      </button>
      <div className="context-menu-separator" />
      {isPinned ? (
        <button
          type="button"
          className="context-menu-item"
          onClick={() => { unpinMessage(message.id); onClose(); }}
        >
          Unpin Message
        </button>
      ) : (
        <button
          type="button"
          className="context-menu-item"
          onClick={() => { pinMessage(message.id); onClose(); }}
        >
          Pin Message
        </button>
      )}
      {isOwn && (
        <>
          <div className="context-menu-separator" />
          <button
            type="button"
            className="context-menu-item"
            onClick={() => { startEditing(message.id); onClose(); }}
          >
            Edit Message
          </button>
          <button
            type="button"
            className="context-menu-item context-menu-item-danger"
            onClick={() => { onDelete(); onClose(); }}
          >
            Delete Message
          </button>
        </>
      )}
      {!isOwn && (
        <>
          <div className="context-menu-separator" />
          <button
            type="button"
            className="context-menu-item context-menu-item-danger"
            onClick={() => { onReport(); onClose(); }}
          >
            Report Message
          </button>
        </>
      )}
    </div>
  );
}
