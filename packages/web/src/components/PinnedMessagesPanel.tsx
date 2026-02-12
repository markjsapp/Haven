import { useChatStore } from "../store/chat.js";
import { useUiStore } from "../store/ui.js";
import { useAuthStore } from "../store/auth.js";

interface PinnedMessagesPanelProps {
  channelId: string;
}

export default function PinnedMessagesPanel({ channelId }: PinnedMessagesPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const pinnedMessageIds = useChatStore((s) => s.pinnedMessageIds);
  const unpinMessage = useChatStore((s) => s.unpinMessage);
  const userNames = useChatStore((s) => s.userNames);
  const togglePinnedPanel = useUiStore((s) => s.togglePinnedPanel);
  const user = useAuthStore((s) => s.user);

  const pinnedIds = pinnedMessageIds[channelId] ?? [];
  const channelMsgs = messages[channelId] ?? [];

  const pinnedMessages = pinnedIds
    .map((id) => channelMsgs.find((m) => m.id === id))
    .filter(Boolean);

  function scrollToMessage(messageId: string) {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      togglePinnedPanel();
    }
  }

  return (
    <div className="pinned-panel">
      <div className="pinned-panel-header">
        <h3>Pinned Messages</h3>
        <button type="button" className="btn-ghost" onClick={togglePinnedPanel}>
          &times;
        </button>
      </div>
      <div className="pinned-panel-list">
        {pinnedMessages.length === 0 && (
          <div className="pinned-panel-empty">No pinned messages in this channel.</div>
        )}
        {pinnedMessages.map((msg) => {
          if (!msg) return null;
          const senderName = msg.senderId === user?.id
            ? user?.username ?? "You"
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
                  Jump
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm btn-danger-text"
                  onClick={() => unpinMessage(msg.id)}
                >
                  Unpin
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
