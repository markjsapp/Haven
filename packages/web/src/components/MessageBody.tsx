import { useMemo, useCallback, useState } from "react";
import { generateHTML } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TiptapUnderline from "@tiptap/extension-underline";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import Mention from "@tiptap/extension-mention";
import { Spoiler } from "../lib/tiptap-spoiler.js";
import { Subtext } from "../lib/tiptap-subtext.js";
import LinkWarningModal from "./LinkWarningModal.js";
import { useChatStore } from "../store/chat.js";
import { useUiStore } from "../store/ui.js";

const lowlight = createLowlight(common);

const ChannelMention = Mention.extend({
  name: "channelMention",
  renderText({ node }) {
    return `#${node.attrs.label ?? node.attrs.id}`;
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        class: "mention mention-channel",
        "data-type": "channel",
        "data-id": node.attrs.id,
      },
      `#${node.attrs.label ?? node.attrs.id}`,
    ];
  },
});

const extensions = [
  StarterKit.configure({ codeBlock: false, link: false, underline: false }),
  CodeBlockLowlight.configure({ lowlight }),
  Link.configure({ openOnClick: false }),
  TiptapUnderline,
  Mention.configure({
    HTMLAttributes: { class: "mention" },
  }),
  ChannelMention,
  Spoiler,
  Subtext,
];

// ─── Emoji-only detection ────────────────────────────

/** Matches strings composed entirely of emoji + modifiers + whitespace */
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|[\u{1F1E0}-\u{1F1FF}]|\uFE0F|\u200D|\u20E3|\s)+$/u;

/** Returns the number of visual emoji if text is emoji-only, 0 otherwise. */
function getEmojiOnlyCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (!EMOJI_ONLY_RE.test(trimmed)) return 0;
  // Count grapheme clusters for accurate visual emoji count
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    return [...segmenter.segment(trimmed)].filter((s) => s.segment.trim()).length;
  }
  // Fallback: count Extended_Pictographic code points
  const matches = trimmed.match(/\p{Extended_Pictographic}/gu);
  return matches ? matches.length : 0;
}

interface Props {
  text: string;
  contentType?: string;
  formatting?: object;
}

export default function MessageBody({ text, contentType, formatting }: Props) {
  const [warningUrl, setWarningUrl] = useState<string | null>(null);

  const html = useMemo(() => {
    if (contentType === "tiptap" && formatting) {
      try {
        return generateHTML(formatting as Parameters<typeof generateHTML>[0], extensions);
      } catch {
        return null;
      }
    }
    return null;
  }, [contentType, formatting]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // Handle spoiler reveals
    if (target.classList.contains("spoiler")) {
      target.classList.toggle("spoiler-revealed");
      return;
    }

    // Handle @user mention clicks — show profile popup
    const userMention = target.closest(".mention:not([data-type='channel'])") as HTMLElement | null;
    if (userMention) {
      const userId = userMention.getAttribute("data-id");
      if (userId) {
        e.preventDefault();
        e.stopPropagation();
        const rect = userMention.getBoundingClientRect();
        useUiStore.getState().setMentionPopup({
          userId,
          position: { top: rect.bottom + 4, left: rect.left },
        });
      }
      return;
    }

    // Handle channel mention clicks — navigate to that channel
    const channelMention = target.closest("[data-type='channel']") as HTMLElement | null;
    if (channelMention) {
      const channelId = channelMention.getAttribute("data-id");
      if (channelId) {
        e.preventDefault();
        e.stopPropagation();
        useChatStore.getState().selectChannel(channelId);
      }
      return;
    }

    // Intercept anchor clicks for external link warning
    const anchor = target.closest("a") as HTMLAnchorElement | null;
    if (anchor && anchor.href) {
      try {
        const linkUrl = new URL(anchor.href);
        // Allow same-origin links to pass through
        if (linkUrl.hostname === window.location.hostname) return;
      } catch {
        // If URL parsing fails, still show warning
      }
      e.preventDefault();
      e.stopPropagation();
      setWarningUrl(anchor.href);
    }
  }, []);

  const handleConfirmLink = useCallback(() => {
    if (warningUrl) {
      window.open(warningUrl, "_blank", "noopener,noreferrer");
      setWarningUrl(null);
    }
  }, [warningUrl]);

  if (html) {
    return (
      <>
        <div
          className="message-body message-rich"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={handleClick}
        />
        {warningUrl && (
          <LinkWarningModal
            url={warningUrl}
            onConfirm={handleConfirmLink}
            onCancel={() => setWarningUrl(null)}
          />
        )}
      </>
    );
  }

  const emojiCount = getEmojiOnlyCount(text);
  const jumbo = emojiCount > 0 && emojiCount <= 10;

  return <div className={`message-body${jumbo ? " message-body-jumbo" : ""}`}>{text}</div>;
}
