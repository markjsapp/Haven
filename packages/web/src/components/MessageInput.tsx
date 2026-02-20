import { useRef, useState, useCallback, useEffect, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Bold from "@tiptap/extension-bold";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { Extension, markInputRule } from "@tiptap/react";
import { useChatStore } from "../store/chat.js";
import { Spoiler } from "../lib/tiptap-spoiler.js";
import { Underline } from "../lib/tiptap-underline.js";
import { Subtext } from "../lib/tiptap-subtext.js";
import { MaskedLink } from "../lib/tiptap-masked-link.js";
import { CustomEmojiNode } from "../lib/tiptap-custom-emoji.js";
import EmojiPicker from "./EmojiPicker.js";
const GifPicker = lazy(() => import("./GifPicker.js"));
import { saveDraft, loadDraft, clearDraft } from "../lib/draft-store.js";
import { createMentionExtension, suggestionActiveRef, type MemberItem } from "../lib/tiptap-mention.js";
import { createChannelMentionExtension, type ChannelItem } from "../lib/tiptap-channel-mention.js";
import { createEmojiSuggestExtension } from "../lib/tiptap-emoji-suggest.js";
import { useUiStore } from "../store/ui.js";
import { useContextMenuPosition } from "../hooks/useContextMenuPosition.js";
import { parseChannelName } from "../lib/channel-utils.js";
import { usePermissions } from "../hooks/usePermissions.js";
import { Permission } from "@haven/core";

const lowlight = createLowlight(common);

// Bold with only ** InputRule (not __ which we use for underline)
const BoldStarOnly = Bold.extend({
  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|\s)\*\*([^*]+)\*\*$/,
        type: this.type,
      }),
    ];
  },
});

// Custom extension: Shift+Enter inserts a hard break (<br>), not a new paragraph
const ShiftEnterBreak = Extension.create({
  name: "shiftEnterBreak",

  addKeyboardShortcuts() {
    return {
      "Shift-Enter": ({ editor }) => {
        editor.commands.setHardBreak();
        return true;
      },
    };
  },
});

interface MessageInputProps {
  placeholder?: string;
}

// Create mention/suggestion extensions once (stable references)
const memberListRef = { current: [] as MemberItem[] };
const channelListRef = { current: [] as ChannelItem[] };
const customEmojiListRef = { current: [] as Array<{ id: string; name: string; image_url: string }> };
const MentionExtension = createMentionExtension(() => memberListRef.current);
const ChannelMentionExtension = createChannelMentionExtension(() => channelListRef.current);
const EmojiSuggestExtension = createEmojiSuggestExtension(() => customEmojiListRef.current);

export default function MessageInput({ placeholder }: MessageInputProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("messageInput.placeholder");
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [inputCtx, setInputCtx] = useState<{ x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputCtxRef = useRef<HTMLDivElement>(null);
  const inputCtxStyle = useContextMenuPosition(inputCtxRef, inputCtx?.x ?? 0, inputCtx?.y ?? 0);

  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendTyping = useChatStore((s) => s.sendTyping);
  const addFiles = useChatStore((s) => s.addFiles);
  const removePendingUpload = useChatStore((s) => s.removePendingUpload);
  const togglePendingUploadSpoiler = useChatStore((s) => s.togglePendingUploadSpoiler);
  const uploadPendingFiles = useChatStore((s) => s.uploadPendingFiles);
  const pendingUploads = useChatStore((s) => s.pendingUploads);
  const editingMessageId = useChatStore((s) => s.editingMessageId);
  const cancelEditing = useChatStore((s) => s.cancelEditing);
  const submitEdit = useChatStore((s) => s.submitEdit);
  const replyingToId = useChatStore((s) => s.replyingToId);
  const cancelReply = useChatStore((s) => s.cancelReply);
  const allMessages = useChatStore((s) => s.messages);
  const currentChannelId2 = useChatStore((s) => s.currentChannelId);
  const userNames = useChatStore((s) => s.userNames);
  const channels = useChatStore((s) => s.channels);
  const customEmojis = useChatStore((s) => s.customEmojis);
  const selectedServerId = useUiStore((s) => s.selectedServerId);
  const showSendButton = useUiStore((s) => s.showSendButton);
  const setShowSendButton = useUiStore((s) => s.setShowSendButton);
  const spellcheck = useUiStore((s) => s.spellcheck);
  const setSpellcheck = useUiStore((s) => s.setSpellcheck);
  const roles = useChatStore((s) => s.roles);
  const { can } = usePermissions();

  // Keep mention member list in sync (special mentions first, then users)
  const specialMentions: MemberItem[] = [];
  if (selectedServerId) {
    if (can(Permission.MENTION_EVERYONE)) {
      specialMentions.push({ id: "everyone", label: "everyone", type: "everyone" });
    }
    const serverRoles = roles[selectedServerId] ?? [];
    for (const role of serverRoles) {
      if (!role.is_default) {
        specialMentions.push({ id: role.id, label: role.name, type: "role", color: role.color });
      }
    }
  }
  const userMentions: MemberItem[] = Object.entries(userNames).map(([id, name]) => ({ id, label: name }));
  memberListRef.current = [...specialMentions, ...userMentions];

  // Keep channel mention list in sync (scoped to current server, text channels only)
  channelListRef.current = channels
    .filter((ch) => ch.server_id === selectedServerId && ch.channel_type === "text")
    .map((ch) => ({ id: ch.id, label: parseChannelName(ch.encrypted_meta) }));

  // Keep custom emoji list in sync for :name: autocomplete
  customEmojiListRef.current = selectedServerId ? (customEmojis[selectedServerId] ?? []) : [];

  // Store placeholder in a ref so TipTap's placeholder function always reads the latest
  const placeholderRef = useRef(resolvedPlaceholder);
  placeholderRef.current = resolvedPlaceholder;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bold: false,
        codeBlock: false,
        link: false,
        underline: false,
      }),
      BoldStarOnly,
      CodeBlockLowlight.configure({ lowlight }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Placeholder.configure({
        placeholder: () => placeholderRef.current,
      }),
      Underline,
      Spoiler,
      Subtext,
      MaskedLink,
      MentionExtension,
      ChannelMentionExtension,
      EmojiSuggestExtension,
      CustomEmojiNode,
      ShiftEnterBreak,
    ],
    onUpdate: ({ editor: e }) => { sendTyping(); setCharCount(e.getText().length); },
    editorProps: {
      attributes: {
        class: "tiptap-input",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Message",
      },
      handleKeyDown: (_view, event) => {
        // Let TipTap's suggestion handler process Enter/Tab when a popup is active
        if (suggestionActiveRef.current) return false;
        // Plain Enter (no modifiers) sends the message
        if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          document.dispatchEvent(new CustomEvent("haven:send"));
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          addFiles(files);
          return true;
        }
        // When clipboard has HTML, prefer plain text for simple content
        // to prevent pasted emojis/text from being wrapped in <p> tags
        const html = event.clipboardData?.getData("text/html");
        const text = event.clipboardData?.getData("text/plain");
        if (html && text) {
          // Check for rich formatting using DOM parsing
          const tmp = document.createElement("div");
          tmp.textContent = html;
          const parsed = new DOMParser().parseFromString(html, "text/html");
          const hasRichFormatting = parsed.querySelector(
            "strong, em, b, i, u, s, code, pre, a[href], h1, h2, h3, h4, h5, h6, ul, ol, blockquote, table, img"
          );
          if (!hasRichFormatting) {
            // Insert as plain text to keep it inline in the current paragraph
            const { tr } = view.state;
            tr.insertText(text);
            view.dispatch(tr);
            return true;
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) {
          event.stopPropagation(); // Prevent Chat.tsx drop handler from also adding files
          addFiles(files);
          return true;
        }
        return false;
      },
    },
  });

  // Sync spellcheck attribute
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    try {
      editor.view.dom.setAttribute("spellcheck", spellcheck ? "true" : "false");
    } catch { /* editor not mounted yet */ }
  }, [editor, spellcheck]);

  // Close input context menu on outside click / scroll / escape
  useEffect(() => {
    if (!inputCtx) return;
    function handleClick(e: MouseEvent) {
      if (inputCtxRef.current && !inputCtxRef.current.contains(e.target as Node)) setInputCtx(null);
    }
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") setInputCtx(null); }
    function handleScroll() { setInputCtx(null); }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [inputCtx]);

  // Update placeholder attribute when it changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    try {
      editor.view.dispatch(editor.state.tr);
    } catch { /* editor not mounted yet */ }
  }, [editor, resolvedPlaceholder]);

  // Draft save/restore on channel switch
  const prevChannelRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    const prev = prevChannelRef.current;
    prevChannelRef.current = currentChannelId2;

    // Save draft for previous channel
    if (prev && prev !== currentChannelId2) {
      const json = editor.getJSON();
      const text = editor.getText().trim();
      if (text) {
        saveDraft(prev, json);
      } else {
        clearDraft(prev);
      }
    }

    // Load draft for new channel (unless editing)
    if (currentChannelId2 && !editingMessageId) {
      const draft = loadDraft(currentChannelId2);
      if (draft) {
        editor.commands.setContent(draft);
      } else {
        editor.commands.clearContent();
      }
    }
  }, [editor, currentChannelId2, editingMessageId]);

  // When editing starts, populate the editor with the message content
  useEffect(() => {
    if (!editor || !editingMessageId) return;
    const channelId = useChatStore.getState().currentChannelId;
    if (!channelId) return;
    const messages = useChatStore.getState().messages[channelId] ?? [];
    const msg = messages.find((m) => m.id === editingMessageId);
    if (!msg) return;

    // If the message has TipTap formatting, load the JSON
    if (msg.contentType === "tiptap" && msg.formatting) {
      editor.commands.setContent(msg.formatting);
    } else {
      editor.commands.setContent(`<p>${msg.text}</p>`);
    }
    editor.commands.focus("end");
  }, [editor, editingMessageId]);

  const handleSend = useCallback(async () => {
    if (!editor || sending) return;

    const text = editor.getText().trim();
    const hasPendingFiles = useChatStore.getState().pendingUploads.length > 0;
    // editor.getText() returns "" for atom nodes (custom emoji), so also check !editor.isEmpty
    if (!text && !hasPendingFiles && editor.isEmpty) return;

    if (text.length > 4000) return;

    setSending(true);
    try {
      // Editing mode
      if (editingMessageId) {
        const json = editor.getJSON();
        const hasFormatting = checkHasFormatting(json);
        const formatting = hasFormatting
          ? { contentType: "tiptap" as const, data: json }
          : undefined;
        await submitEdit(editingMessageId, text, formatting);
        editor.commands.clearContent();
        return;
      }

      // Normal send
      const attachments = await uploadPendingFiles();

      // Check if content has any rich formatting
      const json = editor.getJSON();
      const hasFormatting = checkHasFormatting(json);
      const formatting = hasFormatting
        ? { contentType: "tiptap" as const, data: json }
        : undefined;

      await sendMessage(
        text,
        attachments.length > 0 ? attachments : undefined,
        formatting,
      );

      editor.commands.clearContent();
      if (currentChannelId2) clearDraft(currentChannelId2);
    } finally {
      setSending(false);
    }
  }, [editor, sending, sendMessage, uploadPendingFiles, editingMessageId, submitEdit]);

  // Listen for custom send event from the keyboard shortcut
  useCustomEvent("haven:send", handleSend);

  // Escape to cancel editing or reply
  useEffect(() => {
    if (!editingMessageId && !replyingToId) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingMessageId) {
          cancelEditing();
          editor?.commands.clearContent();
        } else if (replyingToId) {
          cancelReply();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [editingMessageId, replyingToId, cancelEditing, cancelReply, editor]);

  function handleEmojiSelect(emoji: string) {
    if (!editor) return;
    // Check for custom emoji format :uuid:
    const customMatch = emoji.match(/^:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):$/i);
    if (customMatch && selectedServerId) {
      const emojiId = customMatch[1];
      const serverEmojis = customEmojis[selectedServerId] ?? [];
      const found = serverEmojis.find((e) => e.id === emojiId);
      if (found) {
        editor.chain().focus().insertContent({
          type: "customEmoji",
          attrs: { id: found.id, name: found.name, src: found.image_url },
        }).run();
        return;
      }
    }
    editor.chain().focus().insertContent(emoji).run();
  }

  function handleFileSelect() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      addFiles(Array.from(files));
    }
    e.target.value = "";
  }

  // Find replying-to message for the banner
  const replyingToMsg = replyingToId && currentChannelId2
    ? (allMessages[currentChannelId2] ?? []).find((m) => m.id === replyingToId)
    : null;
  const replyingSenderName = replyingToMsg
    ? userNames[replyingToMsg.senderId] ?? replyingToMsg.senderId.slice(0, 8)
    : null;

  return (
    <div className="message-input-wrapper">
      {replyingToId && (
        <div className="reply-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="reply-banner-icon">
            <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
          </svg>
          <span>
            {t("messageInput.replyingTo")} <strong>{replyingSenderName ?? "..."}</strong>
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={cancelReply}
          >
            {t("messageInput.cancel")}
          </button>
        </div>
      )}
      {editingMessageId && (
        <div className="editing-banner">
          <span>{t("messageInput.editingMessage")}</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              cancelEditing();
              editor?.commands.clearContent();
            }}
          >
            {t("messageInput.cancel")}
          </button>
        </div>
      )}
      {pendingUploads.length > 0 && (
        <div className="pending-uploads-grid">
          {pendingUploads.map((upload, i) => {
            const isImage = upload.file.type.startsWith("image/");
            return (
              <div key={i} className={`pending-upload-card${upload.spoiler ? " spoiler-marked" : ""}`}>
                {isImage ? (
                  <img
                    className={`upload-thumbnail${upload.spoiler ? " upload-spoiler-blur" : ""}`}
                    src={URL.createObjectURL(upload.file)}
                    alt={upload.file.name}
                  />
                ) : (
                  <div className="upload-file-icon">
                    {getFileIcon(upload.file.type)}
                  </div>
                )}
                {upload.spoiler && isImage && (
                  <div className="upload-spoiler-label">{t("messageInput.upload.spoilerLabel")}</div>
                )}
                <div className="pending-upload-info">
                  <span className="pending-upload-name" title={upload.file.name}>
                    {upload.file.name.length > 20 ? upload.file.name.slice(0, 17) + "..." : upload.file.name}
                  </span>
                  <span className="pending-upload-size">{formatFileSize(upload.file.size)}</span>
                </div>
                {upload.status === "uploading" && (
                  <>
                    <div className="upload-progress-bar">
                      <div className="upload-progress-fill" style={{ width: `${upload.progress}%` }} />
                    </div>
                    <span className="pending-upload-status">
                      {upload.progress === 0 ? t("messageInput.upload.encrypting") : t("messageInput.upload.uploading", { progress: upload.progress })}
                    </span>
                  </>
                )}
                {upload.status === "error" && (
                  <span className="pending-upload-status error">{t("messageInput.upload.failed")}</span>
                )}
                {isImage && (
                  <button
                    type="button"
                    className={`pending-upload-spoiler${upload.spoiler ? " active" : ""}`}
                    onClick={() => togglePendingUploadSpoiler(i)}
                    title={upload.spoiler ? t("messageInput.upload.removeSpoiler") : t("messageInput.upload.markAsSpoiler")}
                    aria-label={upload.spoiler ? t("messageInput.upload.removeSpoiler") : t("messageInput.upload.markAsSpoiler")}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                      {upload.spoiler && <line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" strokeWidth="2" />}
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  className="pending-upload-remove"
                  onClick={() => removePendingUpload(i)}
                  title={t("messageInput.upload.removeTitle")}
                  aria-label={t("messageInput.upload.removeAriaLabel")}
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="message-input" onContextMenu={(e) => { e.preventDefault(); setInputCtx({ x: e.clientX, y: e.clientY }); }}>
        <button
          type="button"
          className="attach-btn"
          onClick={handleFileSelect}
          title={t("messageInput.attachFileTitle")}
          aria-label={t("messageInput.attachFileAriaLabel")}
        >
          +
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <EditorContent editor={editor} className="tiptap-editor" aria-label={t("messageInput.editorAriaLabel")} />
        <div className="gif-trigger-wrap">
          <button
            type="button"
            className="gif-trigger-btn"
            onClick={() => { setGifOpen(!gifOpen); if (!gifOpen) setEmojiOpen(false); }}
            title={t("messageInput.gifTitle")}
            aria-label={t("messageInput.gifAriaLabel")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M11.5 9H13v6h-1.5zM9 9H6c-.6 0-1 .5-1 1v4c0 .5.4 1 1 1h3c.6 0 1-.5 1-1v-2H8.5v1.5h-2v-3H10V10c0-.5-.4-1-1-1zm10 1.5V9h-4.5v6H16v-2h2v-1.5h-2v-1z" />
            </svg>
          </button>
          {gifOpen && (
            <Suspense fallback={null}>
              <GifPicker
                onSelect={(gifUrl) => {
                  sendMessage(gifUrl);
                  setGifOpen(false);
                }}
                onClose={() => setGifOpen(false)}
              />
            </Suspense>
          )}
        </div>
        <div className="emoji-trigger-wrap">
          <button
            type="button"
            className="emoji-trigger-btn"
            onClick={() => { setEmojiOpen(!emojiOpen); if (!emojiOpen) setGifOpen(false); }}
            title={t("messageInput.emojiTitle")}
            aria-label={t("messageInput.emojiAriaLabel")}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
            </svg>
          </button>
          {emojiOpen && (
            <EmojiPicker
              onSelect={handleEmojiSelect}
              onClose={() => setEmojiOpen(false)}
              serverId={selectedServerId ?? undefined}
            />
          )}
        </div>
        {showSendButton && (
          <button
            type="button"
            className="send-btn"
            onClick={() => document.dispatchEvent(new CustomEvent("haven:send"))}
            title={t("messageInput.sendTitle")}
            aria-label={t("messageInput.sendAriaLabel")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
          </button>
        )}
        {editor && (
          <BubbleMenu
            editor={editor}
            options={{
              placement: "top",
            }}
            className="bubble-toolbar"
          >
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={editor.isActive("bold") ? "active" : ""}
              title={t("messageInput.bubble.boldTitle")}
              aria-label={t("messageInput.bubble.boldAriaLabel")}
            >
              B
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={editor.isActive("italic") ? "active" : ""}
              title={t("messageInput.bubble.italicTitle")}
              aria-label={t("messageInput.bubble.italicAriaLabel")}
            >
              <em>I</em>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={editor.isActive("underline") ? "active" : ""}
              title={t("messageInput.bubble.underlineTitle")}
              aria-label={t("messageInput.bubble.underlineAriaLabel")}
            >
              <u>U</u>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={editor.isActive("strike") ? "active" : ""}
              title={t("messageInput.bubble.strikethroughTitle")}
              aria-label={t("messageInput.bubble.strikethroughAriaLabel")}
            >
              <s>S</s>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={editor.isActive("code") ? "active" : ""}
              title={t("messageInput.bubble.inlineCodeTitle")}
              aria-label={t("messageInput.bubble.inlineCodeAriaLabel")}
            >
              {"<>"}
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              className={editor.isActive("codeBlock") ? "active" : ""}
              title={t("messageInput.bubble.codeBlockTitle")}
              aria-label={t("messageInput.bubble.codeBlockAriaLabel")}
            >
              {"```"}
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleMark("spoiler").run()}
              className={editor.isActive("spoiler") ? "active" : ""}
              title={t("messageInput.bubble.spoilerTitle")}
              aria-label={t("messageInput.bubble.spoilerAriaLabel")}
            >
              {"||"}
            </button>
          </BubbleMenu>
        )}
      </div>
      {charCount >= 3800 && (
        <div className={`char-counter ${charCount > 4000 ? "over-limit" : ""}`}>
          {charCount}/4000
        </div>
      )}
      {inputCtx && (
        <div
          ref={inputCtxRef}
          className="message-context-menu input-context-menu"
          style={inputCtxStyle}
          role="menu"
          aria-label={t("messageInput.contextMenu.ariaLabel")}
        >
          <button type="button" role="menuitem" className="context-menu-item context-menu-toggle" onClick={() => { setShowSendButton(!showSendButton); setInputCtx(null); }}>
            {t("messageInput.contextMenu.sendMessageButton")}
            <span className={`context-menu-check ${showSendButton ? "checked" : ""}`} />
          </button>
          <button type="button" role="menuitem" className="context-menu-item context-menu-toggle" onClick={() => { setSpellcheck(!spellcheck); setInputCtx(null); }}>
            {t("messageInput.contextMenu.spellcheck")}
            <span className={`context-menu-check ${spellcheck ? "checked" : ""}`} />
          </button>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="context-menu-item" onClick={() => { document.execCommand("cut"); setInputCtx(null); }}>
            {t("messageInput.contextMenu.cut")}
            <span className="context-menu-shortcut">{navigator.platform.includes("Mac") ? "\u2318X" : "Ctrl+X"}</span>
          </button>
          <button type="button" role="menuitem" className="context-menu-item" onClick={() => { document.execCommand("copy"); setInputCtx(null); }}>
            {t("messageInput.contextMenu.copy")}
            <span className="context-menu-shortcut">{navigator.platform.includes("Mac") ? "\u2318C" : "Ctrl+C"}</span>
          </button>
          <button type="button" role="menuitem" className="context-menu-item" onClick={() => { navigator.clipboard.readText().then((clipText) => editor?.commands.insertContent(clipText)); setInputCtx(null); }}>
            {t("messageInput.contextMenu.paste")}
            <span className="context-menu-shortcut">{navigator.platform.includes("Mac") ? "\u2318V" : "Ctrl+V"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Hook to listen for a custom DOM event. */
function useCustomEvent(event: string, handler: () => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = () => handlerRef.current();
    document.addEventListener(event, listener);
    return () => document.removeEventListener(event, listener);
  }, [event]);
}

/** Check if TipTap JSON has any rich formatting beyond plain text paragraphs. */
function checkHasFormatting(json: Record<string, unknown>): boolean {
  const content = json.content as Array<Record<string, unknown>> | undefined;
  if (!content) return false;

  for (const node of content) {
    // Non-paragraph nodes (headings, code blocks, lists, etc.)
    if (node.type !== "paragraph") return true;

    // Check paragraph children for marks (bold, italic, links, etc.)
    const children = node.content as Array<Record<string, unknown>> | undefined;
    if (children) {
      for (const child of children) {
        if (child.marks && (child.marks as unknown[]).length > 0) return true;
        if (child.type !== "text") return true;
      }
    }
  }
  return false;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith("video/")) return "\u{1F3AC}";
  if (mimeType.startsWith("audio/")) return "\u{1F3B5}";
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("rar") || mimeType.includes("7z"))
    return "\u{1F4E6}";
  if (mimeType.includes("pdf")) return "\u{1F4C4}";
  return "\u{1F4CE}";
}
