import { useEffect, useMemo, useRef } from "react";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";

function parseNamesFromMeta(encryptedMeta?: string): Record<string, string> {
  if (!encryptedMeta) return {};
  try {
    const json = JSON.parse(atob(encryptedMeta));
    return json.names ?? {};
  } catch {
    return {};
  }
}

export default function MessageList() {
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const messages = useChatStore((s) => s.messages);
  const channels = useChatStore((s) => s.channels);
  const user = useAuthStore((s) => s.user);
  const bottomRef = useRef<HTMLDivElement>(null);

  const channelMessages = currentChannelId ? messages[currentChannelId] ?? [] : [];
  const currentChannel = channels.find((c) => c.id === currentChannelId);
  const nameMap = useMemo(() => parseNamesFromMeta(currentChannel?.encrypted_meta), [currentChannel?.encrypted_meta]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [channelMessages.length]);

  return (
    <div className="message-list">
      {channelMessages.length === 0 && (
        <div className="message-list-empty">
          <h3>No messages yet</h3>
          <p>Send a message to start the conversation!</p>
        </div>
      )}
      {channelMessages.map((msg, i) => {
        const isOwn = msg.senderId === user?.id;
        const prev = channelMessages[i - 1];
        const isGrouped = prev && prev.senderId === msg.senderId;
        const senderName = isOwn
          ? user?.username ?? "You"
          : nameMap[msg.senderId] ?? msg.senderId.slice(0, 8);

        return (
          <div
            key={msg.id}
            className={`message ${isGrouped ? "message-grouped" : "message-first"}`}
          >
            {!isGrouped && (
              <div className="message-avatar">
                {senderName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="message-content">
              {!isGrouped && (
                <div className="message-meta">
                  <span className="message-sender">{senderName}</span>
                  <span className="message-time">
                    {new Date(msg.timestamp).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              )}
              <div className="message-body">{msg.text}</div>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
