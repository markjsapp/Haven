import { useRef, useState, useCallback, useEffect } from "react";
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
import EmojiPicker from "./EmojiPicker.js";
import { saveDraft, loadDraft, clearDraft } from "../lib/draft-store.js";
import { createMentionExtension, suggestionActiveRef, type MemberItem } from "../lib/tiptap-mention.js";
import { createChannelMentionExtension, type ChannelItem } from "../lib/tiptap-channel-mention.js";
import { useUiStore } from "../store/ui.js";
import { parseChannelName } from "../lib/channel-utils.js";

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

// Create mention extensions once (stable references)
const memberListRef = { current: [] as MemberItem[] };
const channelListRef = { current: [] as ChannelItem[] };
const MentionExtension = createMentionExtension(() => memberListRef.current);
const ChannelMentionExtension = createChannelMentionExtension(() => channelListRef.current);

export default function MessageInput({ placeholder = "Type a message..." }: MessageInputProps) {
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendTyping = useChatStore((s) => s.sendTyping);
  const addFiles = useChatStore((s) => s.addFiles);
  const removePendingUpload = useChatStore((s) => s.removePendingUpload);
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
  const selectedServerId = useUiStore((s) => s.selectedServerId);

  // Keep mention member list in sync
  memberListRef.current = Object.entries(userNames).map(([id, name]) => ({ id, label: name }));

  // Keep channel mention list in sync (scoped to current server, text channels only)
  channelListRef.current = channels
    .filter((ch) => ch.server_id === selectedServerId && ch.channel_type === "text")
    .map((ch) => ({ id: ch.id, label: parseChannelName(ch.encrypted_meta) }));

  // Store placeholder in a ref so TipTap's placeholder function always reads the latest
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;

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
      ShiftEnterBreak,
    ],
    onUpdate: () => sendTyping(),
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
          const tmp = document.createElement("div");
          tmp.innerHTML = html;
          const hasRichFormatting = tmp.querySelector(
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
          addFiles(files);
          return true;
        }
        return false;
      },
    },
  });

  // Update placeholder attribute when it changes
  useEffect(() => {
    if (!editor) return;
    // Force TipTap to re-render the placeholder by triggering an update
    editor.view.dispatch(editor.state.tr);
  }, [editor, placeholder]);

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
    if (!text && !hasPendingFiles) return;

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
            Replying to <strong>{replyingSenderName ?? "..."}</strong>
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={cancelReply}
          >
            Cancel
          </button>
        </div>
      )}
      {editingMessageId && (
        <div className="editing-banner">
          <span>Editing message</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              cancelEditing();
              editor?.commands.clearContent();
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {pendingUploads.length > 0 && (
        <div className="pending-uploads-grid">
          {pendingUploads.map((upload, i) => {
            const isImage = upload.file.type.startsWith("image/");
            return (
              <div key={i} className="pending-upload-card">
                {isImage ? (
                  <img
                    className="upload-thumbnail"
                    src={URL.createObjectURL(upload.file)}
                    alt={upload.file.name}
                  />
                ) : (
                  <div className="upload-file-icon">
                    {getFileIcon(upload.file.type)}
                  </div>
                )}
                <div className="pending-upload-info">
                  <span className="pending-upload-name" title={upload.file.name}>
                    {upload.file.name.length > 20 ? upload.file.name.slice(0, 17) + "..." : upload.file.name}
                  </span>
                  <span className="pending-upload-size">{formatFileSize(upload.file.size)}</span>
                </div>
                {upload.status === "uploading" && (
                  <div className="upload-progress-bar">
                    <div className="upload-progress-fill" style={{ width: `${upload.progress}%` }} />
                  </div>
                )}
                {upload.status === "error" && (
                  <span className="pending-upload-status error">Failed</span>
                )}
                <button
                  type="button"
                  className="pending-upload-remove"
                  onClick={() => removePendingUpload(i)}
                  title="Remove"
                  aria-label="Remove"
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="message-input">
        <button
          type="button"
          className="attach-btn"
          onClick={handleFileSelect}
          title="Attach file"
          aria-label="Attach file"
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
        <EditorContent editor={editor} className="tiptap-editor" aria-label="Message editor" />
        <div className="emoji-trigger-wrap">
          <button
            type="button"
            className="emoji-trigger-btn"
            onClick={() => setEmojiOpen(!emojiOpen)}
            title="Emoji"
            aria-label="Emoji"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
            </svg>
          </button>
          {emojiOpen && (
            <EmojiPicker
              onSelect={handleEmojiSelect}
              onClose={() => setEmojiOpen(false)}
            />
          )}
        </div>
        {editor && (
          <BubbleMenu
            editor={editor}
            options={{ placement: "top" }}
            className="bubble-toolbar"
          >
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={editor.isActive("bold") ? "active" : ""}
              title="Bold"
              aria-label="Bold"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={editor.isActive("italic") ? "active" : ""}
              title="Italic"
              aria-label="Italic"
            >
              <em>I</em>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={editor.isActive("underline") ? "active" : ""}
              title="Underline"
              aria-label="Underline"
            >
              <u>U</u>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={editor.isActive("strike") ? "active" : ""}
              title="Strikethrough"
              aria-label="Strikethrough"
            >
              <s>S</s>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={editor.isActive("code") ? "active" : ""}
              title="Inline Code"
              aria-label="Inline Code"
            >
              {"<>"}
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              className={editor.isActive("codeBlock") ? "active" : ""}
              title="Code Block"
              aria-label="Code Block"
            >
              {"```"}
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleMark("spoiler").run()}
              className={editor.isActive("spoiler") ? "active" : ""}
              title="Spoiler"
              aria-label="Spoiler"
            >
              {"||"}
            </button>
          </BubbleMenu>
        )}
      </div>
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
