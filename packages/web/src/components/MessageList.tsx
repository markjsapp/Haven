import { useEffect, useMemo, useRef, useState, useCallback, Fragment, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
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

function formatDateDivider(dateStr: string, t: (key: string) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return t("messageList.dateDivider.today");
  if (msgDate.getTime() === yesterday.getTime()) return t("messageList.dateDivider.yesterday");

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
  const { t } = useTranslation();
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const messages = useChatStore((s) => s.messages);
  const channels = useChatStore((s) => s.channels);
  const startEditing = useChatStore((s) => s.startEditing);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const userNames = useChatStore((s) => s.userNames);
  const userAvatars = useChatStore((s) => s.userAvatars);
  const reactions = useChatStore((s) => s.reactions);
  const toggleReaction = useChatStore((s) => s.toggleReaction);
  const blockedUserIds = useChatStore((s) => s.blockedUserIds);
  const startReply = useChatStore((s) => s.startReply);
  const pinnedMessageIds = useChatStore((s) => s.pinnedMessageIds);
  const pinMessage = useChatStore((s) => s.pinMessage);
  const unpinMessage = useChatStore((s) => s.unpinMessage);
  const userRoleColors = useChatStore((s) => s.userRoleColors);
  const customEmojis = useChatStore((s) => s.customEmojis);
  const newMessageDividers = useChatStore((s) => s.newMessageDividers);
  const user = useAuthStore((s) => s.user);
  const bottomRef = useRef<HTMLDivElement>(null);

  const channelMessages = currentChannelId ? messages[currentChannelId] ?? [] : [];
  const newDividerIndex = currentChannelId
    ? (newMessageDividers[currentChannelId] ? channelMessages.length - newMessageDividers[currentChannelId] : -1)
    : -1;
  const currentChannel = channels.find((c) => c.id === currentChannelId);
  const serverId = currentChannel?.server_id ?? null;
  const { can } = usePermissions(serverId);
  const canManageMessages = can(Permission.MANAGE_MESSAGES);
  const nameMap = useMemo(() => parseNamesFromMeta(currentChannel?.encrypted_meta), [currentChannel?.encrypted_meta]);

  // Build custom emoji lookup map for the current server
  const customEmojiMap = useMemo(() => {
    const map = new Map<string, { name: string; image_url: string }>();
    if (!serverId) return map;
    const emojis = customEmojis[serverId] ?? [];
    for (const e of emojis) {
      map.set(e.id, { name: e.name, image_url: e.image_url });
    }
    return map;
  }, [serverId, customEmojis]);
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
    <div className="message-list" role="log" aria-live="polite" aria-relevant="additions text" aria-label={t("messageList.ariaLabel")}>
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
            <span className="date-divider-text">{formatDateDivider(msg.timestamp, t)}</span>
          </div>
        ) : null;

        const showNewDivider = i === newDividerIndex && i > 0;
        const newDividerEl = showNewDivider ? (
          <div className="new-messages-divider" key={`new-${msg.id}`}>
            <span className="new-messages-divider-label">{t("messageList.newDivider")}</span>
          </div>
        ) : null;

        // System messages render differently
        if (msg.messageType === "system") {
          let systemContent: React.ReactNode = msg.text;
          try {
            const data = JSON.parse(msg.text);
            const name = data.username ?? data.user_id?.slice(0, 8) ?? "Someone";
            if (data.event === "member_joined") systemContent = t("messageList.system.joinedServer", { name });
            else if (data.event === "member_left") systemContent = t("messageList.system.leftGroup", { name });
            else if (data.event === "member_kicked") systemContent = t("messageList.system.kicked", { name });
            else if (data.event === "message_pinned") {
              systemContent = <>{name} {t("messageList.system.pinnedMessage")} {data.message_id ? <button className="system-message-link" onClick={() => scrollToMessage(data.message_id)}>{t("messageList.system.aMessage")}</button> : t("messageList.system.aMessage")}</>;
            } else if (data.event === "message_unpinned") {
              systemContent = <>{name} {t("messageList.system.unpinnedMessage")} {data.message_id ? <button className="system-message-link" onClick={() => scrollToMessage(data.message_id)}>{t("messageList.system.aMessage")}</button> : t("messageList.system.aMessage")}</>;
            } else if (data.event === "call_ended") {
              const secs = data.duration_secs ?? 0;
              const mins = Math.floor(secs / 60);
              const remSecs = secs % 60;
              const duration = mins > 0
                ? `${mins}m ${remSecs}s`
                : `${remSecs}s`;
              systemContent = t("messageList.system.callEnded", { duration });
            } else systemContent = `${name} — ${data.event}`;
          } catch { /* use raw text */ }

          return (
            <Fragment key={msg.id}>
              {dateDividerEl}
              {newDividerEl}
              <div className="system-message" id={`msg-${msg.id}`}>
                <span className="system-message-text">{systemContent}</span>
                <time className="system-message-time" dateTime={new Date(msg.timestamp).toISOString()}>
                  {new Date(msg.timestamp).toLocaleString([], {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })}
                </time>
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
              {newDividerEl}
              <div id={`msg-${msg.id}`} className="message message-first message-blocked">
                <div className="message-avatar">?</div>
                <div className="message-content">
                  <div className="message-meta">
                    <span className="message-sender">{t("messageList.blockedUser")}</span>
                    <time className="message-time" dateTime={new Date(msg.timestamp).toISOString()}>
                      {new Date(msg.timestamp).toLocaleString([], {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <div className="message-text">{t("messageList.blockedUserMessage")}</div>
                </div>
              </div>
            </Fragment>
          );
        }

        return (
          <Fragment key={msg.id}>
            {dateDividerEl}
            {newDividerEl}
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
                    avatarUrl={msg.senderId === user?.id ? user?.avatar_url : userAvatars[msg.senderId]}
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
                    <span className="reply-preview-text">{t("messageList.replyPreview.notLoaded")}</span>
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
                    <time className="message-time" dateTime={new Date(msg.timestamp).toISOString()}>
                      {new Date(msg.timestamp).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    {msg.edited && <span className="message-edited">{t("messageList.edited")}</span>}
                    {isPinned && (
                      <span className="message-pin-indicator" title={t("messageList.pinned")}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                        </svg>
                      </span>
                    )}
                  </div>
                )}
                {msg.contentType === "server_invite" && msg.formatting ? (
                  <InviteCard invite={msg.formatting as { invite_code: string; server_name: string; server_id: string; server_icon_url?: string | null }} senderId={msg.senderId} />
                ) : (() => {
                  const displayText = stripEmbeddedImageUrls(msg.text, msg.linkPreviews);
                  return displayText ? <MessageBody text={displayText} contentType={msg.contentType} formatting={msg.formatting} customEmojiMap={customEmojiMap} /> : null;
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
                          <span className="reaction-emoji">{(() => {
                            // Check if this is a custom emoji (UUID format)
                            const customId = r.emoji.match(/^:?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):?$/i)?.[1];
                            const ce = customId ? customEmojiMap.get(customId) : null;
                            if (ce) return <img className="custom-emoji-reaction" src={`${ce.image_url}`} alt={`:${ce.name}:`} />;
                            return r.emoji;
                          })()}</span>
                          <span className="reaction-count">{r.userIds.length}</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="reaction-pill reaction-add-btn"
                      onClick={() => setReactionPickerMsgId(msg.id)}
                      title={t("messageList.actions.addReactionTitle")}
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
                  title={t("messageList.actions.replyTitle")}
                  aria-label={t("messageList.actions.replyAriaLabel")}
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
                  title={t("messageList.actions.addReactionTitle")}
                  aria-label={t("messageList.actions.addReactionAriaLabel")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
                  </svg>
                </button>
                {/* Pin/Unpin button */}
                <button
                  type="button"
                  className="message-action-btn"
                  onClick={() => isPinned ? unpinMessage(msg.id) : pinMessage(msg.id)}
                  title={isPinned ? t("messageList.actions.unpinTitle") : t("messageList.actions.pinTitle")}
                  aria-label={isPinned ? t("messageList.actions.unpinAriaLabel") : t("messageList.actions.pinAriaLabel")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                  </svg>
                </button>
                {isOwn && (
                  <button
                    type="button"
                    className="message-action-btn"
                    onClick={() => startEditing(msg.id)}
                    title={t("messageList.actions.editTitle")}
                    aria-label={t("messageList.actions.editAriaLabel")}
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
                    title={t("messageList.actions.deleteTitle")}
                    aria-label={t("messageList.actions.deleteAriaLabel")}
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
                      serverId={serverId ?? undefined}
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
          title={t("messageList.confirm.deleteTitle")}
          message={t("messageList.confirm.deleteMessage")}
          confirmLabel={t("messageList.confirm.deleteLabel")}
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

// ─── Invite Card (rendered inline in messages) ─────

interface InviteCardProps {
  invite: {
    invite_code: string;
    server_name: string;
    server_id: string;
    server_icon_url?: string | null;
  };
  senderId: string;
}

function InviteCard({ invite, senderId }: InviteCardProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const servers = useChatStore((s) => s.servers);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");

  const isSender = user?.id === senderId;
  const alreadyMember = servers.some((s) => s.id === invite.server_id);
  const initial = (invite.server_name || "?").charAt(0).toUpperCase();

  async function handleAccept() {
    if (joining || joined) return;
    setJoining(true);
    setError("");
    try {
      const api = useAuthStore.getState().api;
      await api.joinByInvite(invite.invite_code);
      setJoined(true);
      // Reload channels to pick up the new server
      await useChatStore.getState().loadChannels();
    } catch (err: any) {
      const msg = err.message || "Failed to join";
      if (msg.includes("Already a member")) {
        setJoined(true);
      } else {
        setError(msg);
      }
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="invite-card">
      <div className="invite-card-header">
        <div className="invite-card-icon">
          {invite.server_icon_url ? (
            <img src={invite.server_icon_url} alt="" />
          ) : (
            <span>{initial}</span>
          )}
        </div>
        <div className="invite-card-info">
          <span className="invite-card-label">{t("messageList.inviteCard.serverInvite")}</span>
          <span className="invite-card-name">{invite.server_name}</span>
        </div>
      </div>
      <div className="invite-card-actions">
        {alreadyMember || joined ? (
          <span className="invite-card-status joined">{t("messageList.inviteCard.joined")}</span>
        ) : isSender ? (
          <span className="invite-card-status waiting">{t("messageList.inviteCard.inviteSent")}</span>
        ) : error ? (
          <span className="invite-card-status error">{error}</span>
        ) : (
          <>
            <button
              className="invite-card-btn accept"
              onClick={handleAccept}
              disabled={joining}
            >
              {joining ? t("messageList.inviteCard.joining") : t("messageList.inviteCard.accept")}
            </button>
            <button className="invite-card-btn ignore" disabled>
              {t("messageList.inviteCard.ignore")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
