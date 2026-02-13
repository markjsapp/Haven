import { useEffect, useMemo, useRef, useState, useCallback, Fragment, lazy, Suspense } from "react";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { Permission } from "@haven/core";
import { usePermissions } from "../hooks/usePermissions.js";
import MessageAttachments from "./MessageAttachments.js";
import MessageBody from "./MessageBody.js";
import LinkPreviewCard from "./LinkPreviewCard.js";
import ConfirmDialog from "./ConfirmDialog.js";
const ProfilePopup = lazy(() => import("./ProfilePopup.js"));
import Avatar from "./Avatar.js";
import { parseNamesFromMeta, parseChannelDisplay } from "../lib/channel-utils.js";
import EmojiPicker from "./EmojiPicker.js";
import MessageContextMenu from "./MessageContextMenu.js";
import ReportModal from "./ReportModal.js";
import type { DecryptedMessage, LinkPreview } from "../store/chat.js";

// ─── Embedded URL Stripping ──────────────────────────

const IMAGE_EXT_RE = /\.(?:gif|png|jpe?g|webp|avif|apng|svg)(?:\?[^\s]*)?$/i;
const GIF_HOST_RE = /(?:tenor\.com(?:\/view)?|giphy\.com\/gifs|media[0-9]*\.giphy\.com|i\.imgur\.com)\//i;

/** Strip URLs from message text that are rendered as image/GIF embeds. */
function stripEmbeddedImageUrls(text: string, previews?: LinkPreview[]): string {
  if (!previews || previews.length === 0) return text;
  const embeddedUrls = new Set<string>();
  for (const p of previews) {
    // Strip if it's a direct image URL
    try {
      if (IMAGE_EXT_RE.test(new URL(p.url).pathname)) { embeddedUrls.add(p.url); continue; }
    } catch {
      if (IMAGE_EXT_RE.test(p.url)) { embeddedUrls.add(p.url); continue; }
    }
    // Strip if it's a GIF service URL that rendered an image embed
    if (p.image && GIF_HOST_RE.test(p.url)) embeddedUrls.add(p.url);
  }
  if (embeddedUrls.size === 0) return text;
  let result = text;
  for (const url of embeddedUrls) {
    result = result.split(url).join("");
  }
  return result.trim();
}

// ─── Date Divider Helpers ─────────────────────────────

function formatDateDivider(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return "Today";
  if (msgDate.getTime() === yesterday.getTime()) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function isDifferentDay(a: string, b: string): boolean {
  const dA = new Date(a);
  const dB = new Date(b);
  return (
    dA.getFullYear() !== dB.getFullYear() ||
    dA.getMonth() !== dB.getMonth() ||
    dA.getDate() !== dB.getDate()
  );
}

// ─── Component ────────────────────────────────────────

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
  const startReply = useChatStore((s) => s.startReply);
  const pinnedMessageIds = useChatStore((s) => s.pinnedMessageIds);
  const userRoleColors = useChatStore((s) => s.userRoleColors);
  const user = useAuthStore((s) => s.user);
  const bottomRef = useRef<HTMLDivElement>(null);

  const channelMessages = currentChannelId ? messages[currentChannelId] ?? [] : [];
  const currentChannel = channels.find((c) => c.id === currentChannelId);
  const serverId = currentChannel?.server_id ?? null;
  const { can } = usePermissions(serverId);
  const canManageMessages = can(Permission.MANAGE_MESSAGES);
  const nameMap = useMemo(() => parseNamesFromMeta(currentChannel?.encrypted_meta), [currentChannel?.encrypted_meta]);
  const pinnedIds = currentChannelId ? pinnedMessageIds[currentChannelId] ?? [] : [];

  const channelDisplay = useMemo(() => {
    if (!currentChannel?.encrypted_meta) return null;
    return parseChannelDisplay(currentChannel.encrypted_meta, user?.id ?? "");
  }, [currentChannel?.encrypted_meta, user?.id]);

  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [profilePopup, setProfilePopup] = useState<{ userId: string; top: number; left: number } | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ message: DecryptedMessage; x: number; y: number } | null>(null);
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);

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

  const scrollToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMsgId(messageId);
      setTimeout(() => setHighlightedMsgId(null), 1500);
    }
  }, []);

  const getSenderName = useCallback((senderId: string) => {
    if (senderId === user?.id) return user?.username ?? "You";
    return nameMap[senderId] ?? userNames[senderId] ?? senderId.slice(0, 8);
  }, [user, nameMap, userNames]);

  return (
    <div className="message-list" role="log" aria-live="polite" aria-label="Messages">
      {/* Conversation start marker */}
      {currentChannel && channelDisplay && (
        <div className="conversation-start">
          {channelDisplay.isDm ? (
            <>
              <div className="conversation-start-avatar">
                <Avatar name={channelDisplay.name} size={80} />
              </div>
              <h2 className="conversation-start-name">{channelDisplay.name}</h2>
              <p className="conversation-start-desc">
                This is the beginning of your direct message history with <strong>{channelDisplay.name}</strong>.
              </p>
            </>
          ) : channelDisplay.isGroup ? (
            <>
              <h2 className="conversation-start-name">{channelDisplay.name}</h2>
              <p className="conversation-start-desc">
                Welcome to the beginning of the <strong>{channelDisplay.name}</strong> group.
              </p>
            </>
          ) : (
            <>
              <h2 className="conversation-start-name">
                <span className="conversation-start-hash">#</span>
                {channelDisplay.name}
              </h2>
              <p className="conversation-start-desc">
                This is the start of the <strong>#{channelDisplay.name}</strong> channel.
              </p>
            </>
          )}
        </div>
      )}
      {channelMessages.map((msg, i) => {
        const prev = channelMessages[i - 1];
        const showDateDivider = i === 0 || (prev && isDifferentDay(prev.timestamp, msg.timestamp));

        const dateDividerEl = showDateDivider ? (
          <div className="date-divider" key={`divider-${msg.id}`}>
            <span className="date-divider-text">{formatDateDivider(msg.timestamp)}</span>
          </div>
        ) : null;

        // System messages render differently
        if (msg.messageType === "system") {
          let systemContent: React.ReactNode = msg.text;
          try {
            const data = JSON.parse(msg.text);
            const name = data.username ?? data.user_id?.slice(0, 8) ?? "Someone";
            if (data.event === "member_joined") systemContent = `${name} joined the server`;
            else if (data.event === "member_left") systemContent = `${name} left the group`;
            else if (data.event === "member_kicked") systemContent = `${name} was kicked from the server`;
            else if (data.event === "message_pinned") {
              systemContent = <>{name} pinned {data.message_id ? <button className="system-message-link" onClick={() => scrollToMessage(data.message_id)}>a message</button> : "a message"}</>;
            } else if (data.event === "message_unpinned") {
              systemContent = <>{name} unpinned {data.message_id ? <button className="system-message-link" onClick={() => scrollToMessage(data.message_id)}>a message</button> : "a message"}</>;
            } else systemContent = `${name} — ${data.event}`;
          } catch { /* use raw text */ }

          return (
            <Fragment key={msg.id}>
              {dateDividerEl}
              <div className="system-message" id={`msg-${msg.id}`}>
                <span className="system-message-text">{systemContent}</span>
                <span className="system-message-time">
                  {new Date(msg.timestamp).toLocaleString([], {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>
            </Fragment>
          );
        }

        const isOwn = msg.senderId === user?.id;
        const isBlocked = blockedUserIds.includes(msg.senderId);
        // Break grouping at date boundaries
        const isGrouped = prev
          && prev.senderId === msg.senderId
          && prev.messageType !== "system"
          && !isDifferentDay(prev.timestamp, msg.timestamp);
        const senderName = getSenderName(msg.senderId);
        const isPinned = pinnedIds.includes(msg.id);

        const msgReactions = reactions[msg.id] ?? [];

        // Build reply preview
        const repliedMsg = msg.replyToId
          ? channelMessages.find((m) => m.id === msg.replyToId)
          : null;

        if (isBlocked) {
          return (
            <Fragment key={msg.id}>
              {dateDividerEl}
              <div id={`msg-${msg.id}`} className="message message-first message-blocked">
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
            </Fragment>
          );
        }

        return (
          <Fragment key={msg.id}>
            {dateDividerEl}
            <div
              id={`msg-${msg.id}`}
              className={`message ${isGrouped ? "message-grouped" : "message-first"} ${highlightedMsgId === msg.id ? "message-highlight" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ message: msg, x: e.clientX, y: e.clientY });
              }}
            >
              {!isGrouped && (
                <div
                  className="message-avatar message-avatar-clickable"
                  onClick={(e) => handleAvatarClick(msg.senderId, e)}
                >
                  <Avatar
                    name={senderName}
                    size={40}
                  />
                </div>
              )}
              <div className="message-content">
                {/* Reply preview */}
                {repliedMsg && (
                  <div
                    className="reply-preview"
                    onClick={() => scrollToMessage(repliedMsg.id)}
                  >
                    <span className="reply-preview-bar" />
                    <span className="reply-preview-sender">{getSenderName(repliedMsg.senderId)}</span>
                    <span className="reply-preview-text">
                      {repliedMsg.text.length > 80 ? repliedMsg.text.slice(0, 80) + "..." : repliedMsg.text}
                    </span>
                  </div>
                )}
                {msg.replyToId && !repliedMsg && (
                  <div className="reply-preview reply-preview-unknown">
                    <span className="reply-preview-bar" />
                    <span className="reply-preview-text">Original message not loaded</span>
                  </div>
                )}
                {!isGrouped && (
                  <div className="message-meta">
                    <span
                      className="message-sender message-sender-clickable"
                      onClick={(e) => handleAvatarClick(msg.senderId, e)}
                      style={userRoleColors[msg.senderId] ? { color: userRoleColors[msg.senderId] } : undefined}
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
                    {isPinned && (
                      <span className="message-pin-indicator" title="Pinned">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                        </svg>
                      </span>
                    )}
                  </div>
                )}
                {(() => {
                  const displayText = stripEmbeddedImageUrls(msg.text, msg.linkPreviews);
                  return displayText ? <MessageBody text={displayText} contentType={msg.contentType} formatting={msg.formatting} /> : null;
                })()}
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
                {/* Reply button */}
                <button
                  type="button"
                  className="message-action-btn"
                  onClick={() => startReply(msg.id)}
                  title="Reply"
                  aria-label="Reply"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
                  </svg>
                </button>
                {/* Reaction button */}
                <button
                  type="button"
                  className="message-action-btn"
                  onClick={() => setReactionPickerMsgId(
                    reactionPickerMsgId === msg.id ? null : msg.id
                  )}
                  title="Add Reaction"
                  aria-label="Add Reaction"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
                  </svg>
                </button>
                {isOwn && (
                  <button
                    type="button"
                    className="message-action-btn"
                    onClick={() => startEditing(msg.id)}
                    title="Edit"
                    aria-label="Edit"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" />
                    </svg>
                  </button>
                )}
                {(isOwn || canManageMessages) && (
                  <button
                    type="button"
                    className="message-action-btn message-action-danger"
                    onClick={() => setDeletingMessageId(msg.id)}
                    title="Delete"
                    aria-label="Delete"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                  </button>
                )}
                {/* Reaction emoji picker */}
                {reactionPickerMsgId === msg.id && (
                  <div className="reaction-picker-wrap" ref={reactionPickerRef}>
                    <EmojiPicker
                      onSelect={(emoji) => handleReactionSelect(msg.id, emoji)}
                      onClose={() => setReactionPickerMsgId(null)}
                    />
                  </div>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
      <div ref={bottomRef} style={{ minHeight: 24, flexShrink: 0 }} />
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
        <Suspense fallback={null}>
          <ProfilePopup
            userId={profilePopup.userId}
            serverId={currentChannel?.server_id ?? undefined}
            position={{ top: profilePopup.top, left: profilePopup.left }}
            onClose={() => setProfilePopup(null)}
          />
        </Suspense>
      )}
      {contextMenu && (
        <MessageContextMenu
          message={contextMenu.message}
          x={contextMenu.x}
          y={contextMenu.y}
          isPinned={pinnedIds.includes(contextMenu.message.id)}
          serverId={serverId}
          onClose={() => setContextMenu(null)}
          onDelete={() => setDeletingMessageId(contextMenu.message.id)}
          onReport={() => setReportingMessageId(contextMenu.message.id)}
        />
      )}
      {reportingMessageId && currentChannelId && (
        <ReportModal
          messageId={reportingMessageId}
          channelId={currentChannelId}
          onClose={() => setReportingMessageId(null)}
        />
      )}
    </div>
  );
}
