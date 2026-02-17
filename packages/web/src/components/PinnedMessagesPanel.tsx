import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../store/chat.js";
import { useUiStore } from "../store/ui.js";
import { useAuthStore } from "../store/auth.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

interface PinnedMessagesPanelProps {
  channelId: string;
}

export default function PinnedMessagesPanel({ channelId }: PinnedMessagesPanelProps) {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);
  const pinnedMessageIds = useChatStore((s) => s.pinnedMessageIds);
  const unpinMessage = useChatStore((s) => s.unpinMessage);
  const userNames = useChatStore((s) => s.userNames);
  const togglePinnedPanel = useUiStore((s) => s.togglePinnedPanel);
  const user = useAuthStore((s) => s.user);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const pinnedIds = pinnedMessageIds[channelId] ?? [];
  const channelMsgs = messages[channelId] ?? [];

  const pinnedMessages = pinnedIds
    .map((id) => channelMsgs.find((m) => m.id === id))
    .filter(Boolean);

  function scrollToMessage(messageId: string) {
    togglePinnedPanel();
    // Use requestAnimationFrame so the modal closes before we scroll
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("message-highlight");
        setTimeout(() => el.classList.remove("message-highlight"), 2000);
      }
    });
  }

  return (
    <div className="modal-overlay" onClick={togglePinnedPanel} role="presentation">
      <div
        className="modal-dialog pinned-modal"
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pinned-modal-title"
      >
        <div className="pinned-modal-header">
          <h3 id="pinned-modal-title">{t("pinnedMessages.title")}</h3>
          <button type="button" className="btn-ghost" onClick={togglePinnedPanel} aria-label={t("pinnedMessages.close")}>
            &times;
          </button>
        </div>
        <div className="pinned-modal-list">
          {pinnedMessages.length === 0 && (
            <div className="pinned-modal-empty">{t("pinnedMessages.empty")}</div>
          )}
          {pinnedMessages.map((msg) => {
            if (!msg) return null;
            const senderName = msg.senderId === user?.id
              ? user?.username ?? t("pinnedMessages.you")
              : userNames[msg.senderId] ?? msg.senderId.slice(0, 8);
            return (
              <div key={msg.id} className="pinned-message-card">
                <div className="pinned-message-header">
                  <span className="pinned-message-sender">{senderName}</span>
                  <span className="pinned-message-time">
                    {new Date(msg.timestamp).toLocaleString([], {
                      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="pinned-message-text">
                  {msg.text.length > 150 ? msg.text.slice(0, 150) + "..." : msg.text}
                </div>
                <div className="pinned-message-actions">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => scrollToMessage(msg.id)}
                  >
                    {t("pinnedMessages.jump")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm btn-danger-text"
                    onClick={() => unpinMessage(msg.id)}
                  >
                    {t("pinnedMessages.unpin")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
