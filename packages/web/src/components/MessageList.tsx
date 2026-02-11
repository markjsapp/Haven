import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import MessageAttachments from "./MessageAttachments.js";
import MessageBody from "./MessageBody.js";
import LinkPreviewCard from "./LinkPreviewCard.js";
import ConfirmDialog from "./ConfirmDialog.js";
import ProfilePopup from "./ProfilePopup.js";
import { parseNamesFromMeta } from "../lib/channel-utils.js";
import { FREQUENT_EMOJIS } from "./EmojiPicker.js";

export default function MessageList() {
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const messages = useChatStore((s) => s.messages);
  const channels = useChatStore((s) => s.channels);
  const startEditing = useChatStore((s) => s.startEditing);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const userNames = useChatStore((s) => s.userNames);
  const reactions = useChatStore((s) => s.reactions);
  const toggleReaction = useChatStore((s) => s.toggleReaction);
  const blockedUserIds = useChatStore((s) => s.blockedUserIds);
  const user = useAuthStore((s) => s.user);
  const bottomRef = useRef<HTMLDivElement>(null);

  const channelMessages = currentChannelId ? messages[currentChannelId] ?? [] : [];
  const currentChannel = channels.find((c) => c.id === currentChannelId);
  const nameMap = useMemo(() => parseNamesFromMeta(currentChannel?.encrypted_meta), [currentChannel?.encrypted_meta]);

  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [profilePopup, setProfilePopup] = useState<{ userId: string; top: number; left: number } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [channelMessages.length]);

  // Close reaction picker on outside click
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reactionPickerMsgId) return;
    function handleClick(e: MouseEvent) {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target as Node)) {
        setReactionPickerMsgId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [reactionPickerMsgId]);

  const handleReactionSelect = useCallback((messageId: string, emoji: string) => {
    toggleReaction(messageId, emoji);
    setReactionPickerMsgId(null);
  }, [toggleReaction]);

  const handleAvatarClick = useCallback((userId: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setProfilePopup({ userId, top: rect.top, left: rect.right });
  }, []);

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
        const isBlocked = blockedUserIds.includes(msg.senderId);
        const prev = channelMessages[i - 1];
        const isGrouped = prev && prev.senderId === msg.senderId;
        const senderName = isOwn
          ? user?.username ?? "You"
          : nameMap[msg.senderId] ?? userNames[msg.senderId] ?? msg.senderId.slice(0, 8);

        const msgReactions = reactions[msg.id] ?? [];

        if (isBlocked) {
          return (
            <div key={msg.id} className="message message-first message-blocked">
              <div className="message-avatar">?</div>
              <div className="message-content">
                <div className="message-meta">
                  <span className="message-sender">Blocked User</span>
                  <span className="message-time">
                    {new Date(msg.timestamp).toLocaleString([], {
                      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="message-text">Message from a blocked user</div>
              </div>
            </div>
          );
        }

        return (
          <div
            key={msg.id}
            className={`message ${isGrouped ? "message-grouped" : "message-first"}`}
          >
            {!isGrouped && (
              <div
                className="message-avatar message-avatar-clickable"
                onClick={(e) => handleAvatarClick(msg.senderId, e)}
              >
                {senderName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="message-content">
              {!isGrouped && (
                <div className="message-meta">
                  <span
                    className="message-sender message-sender-clickable"
                    onClick={(e) => handleAvatarClick(msg.senderId, e)}
                  >
                    {senderName}
                  </span>
                  <span className="message-time">
                    {new Date(msg.timestamp).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {msg.edited && <span className="message-edited">(edited)</span>}
                </div>
              )}
              <MessageBody text={msg.text} contentType={msg.contentType} formatting={msg.formatting} />
              {msg.attachments && msg.attachments.length > 0 && (
                <MessageAttachments attachments={msg.attachments} />
              )}
              {msg.linkPreviews && msg.linkPreviews.length > 0 && (
                <div className="link-preview-list">
                  {msg.linkPreviews.map((lp) => (
                    <LinkPreviewCard key={lp.url} preview={lp} />
                  ))}
                </div>
              )}
              {msgReactions.length > 0 && (
                <div className="reaction-pills">
                  {msgReactions.map((r) => {
                    const isMine = user ? r.userIds.includes(user.id) : false;
                    return (
                      <button
                        key={r.emoji}
                        type="button"
                        className={`reaction-pill ${isMine ? "reaction-pill-active" : ""}`}
                        onClick={() => toggleReaction(msg.id, r.emoji)}
                        title={r.userIds.map((id) => userNames[id] ?? nameMap[id] ?? id.slice(0, 8)).join(", ")}
                      >
                        <span className="reaction-emoji">{r.emoji}</span>
                        <span className="reaction-count">{r.userIds.length}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="reaction-pill reaction-add-btn"
                    onClick={() => setReactionPickerMsgId(msg.id)}
                    title="Add Reaction"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
            <div className="message-actions">
              {/* Reaction button — available for ALL messages */}
              <button
                type="button"
                className="message-action-btn"
                onClick={() => setReactionPickerMsgId(
                  reactionPickerMsgId === msg.id ? null : msg.id
                )}
                title="Add Reaction"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
                </svg>
              </button>
              {isOwn && (
                <>
                  <button
                    type="button"
                    className="message-action-btn"
                    onClick={() => startEditing(msg.id)}
                    title="Edit"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="message-action-btn message-action-danger"
                    onClick={() => setDeletingMessageId(msg.id)}
                    title="Delete"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                  </button>
                </>
              )}
              {/* Inline reaction picker */}
              {reactionPickerMsgId === msg.id && (
                <div className="reaction-picker" ref={reactionPickerRef}>
                  {FREQUENT_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="reaction-picker-emoji"
                      onClick={() => handleReactionSelect(msg.id, emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
      {deletingMessageId && (
        <ConfirmDialog
          title="Delete Message"
          message="Are you sure you want to delete this message? This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deleteMessage(deletingMessageId);
            setDeletingMessageId(null);
          }}
          onCancel={() => setDeletingMessageId(null)}
        />
      )}
      {profilePopup && (
        <ProfilePopup
          userId={profilePopup.userId}
          position={{ top: profilePopup.top, left: profilePopup.left }}
          onClose={() => setProfilePopup(null)}
        />
      )}
    </div>
  );
}
