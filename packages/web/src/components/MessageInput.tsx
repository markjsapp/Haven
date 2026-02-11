import { useRef, useState, useCallback, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/react";
import { useChatStore } from "../store/chat.js";
import { Spoiler } from "../lib/tiptap-spoiler.js";
import EmojiPicker from "./EmojiPicker.js";

// Custom extension: Enter to send, Shift+Enter for newline
const SendOnEnter = Extension.create({
  name: "sendOnEnter",

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        // Trigger the send handler via a custom event
        document.dispatchEvent(new CustomEvent("haven:send"));
        return true;
      },
      "Shift-Enter": ({ editor }) => {
        editor.commands.enter();
        return true;
      },
    };
  },
});

interface MessageInputProps {
  placeholder?: string;
}

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

  // Store placeholder in a ref so TipTap's placeholder function always reads the latest
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Placeholder.configure({
        placeholder: () => placeholderRef.current,
      }),
      Spoiler,
      SendOnEnter,
    ],
    onUpdate: () => sendTyping(),
    editorProps: {
      attributes: {
        class: "tiptap-input",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          addFiles(files);
          return true;
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
    } finally {
      setSending(false);
    }
  }, [editor, sending, sendMessage, uploadPendingFiles, editingMessageId, submitEdit]);

  // Listen for custom send event from the keyboard shortcut
  useCustomEvent("haven:send", handleSend);

  // Escape to cancel editing
  useEffect(() => {
    if (!editingMessageId) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelEditing();
        editor?.commands.clearContent();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [editingMessageId, cancelEditing, editor]);

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

  return (
    <div className="message-input-wrapper">
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
        <div className="pending-uploads">
          {pendingUploads.map((upload, i) => (
            <div key={i} className="pending-upload-item">
              <span className="pending-upload-name">{upload.file.name}</span>
              <span className="pending-upload-size">
                {formatFileSize(upload.file.size)}
              </span>
              {upload.status === "uploading" && (
                <span className="pending-upload-status">Uploading...</span>
              )}
              {upload.status === "error" && (
                <span className="pending-upload-status error">Failed</span>
              )}
              <button
                type="button"
                className="pending-upload-remove"
                onClick={() => removePendingUpload(i)}
                title="Remove"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="message-input">
        <button
          type="button"
          className="attach-btn"
          onClick={handleFileSelect}
          title="Attach file"
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
        <EditorContent editor={editor} className="tiptap-editor" />
        <div className="emoji-trigger-wrap">
          <button
            type="button"
            className="emoji-trigger-btn"
            onClick={() => setEmojiOpen(!emojiOpen)}
            title="Emoji"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
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
            >
              B
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={editor.isActive("italic") ? "active" : ""}
              title="Italic"
            >
              <em>I</em>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={editor.isActive("strike") ? "active" : ""}
              title="Strikethrough"
            >
              <s>S</s>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={editor.isActive("code") ? "active" : ""}
              title="Inline Code"
            >
              {"<>"}
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              className={editor.isActive("codeBlock") ? "active" : ""}
              title="Code Block"
            >
              {"```"}
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleMark("spoiler").run()}
              className={editor.isActive("spoiler") ? "active" : ""}
              title="Spoiler"
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
