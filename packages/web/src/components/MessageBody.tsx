import { useMemo, useCallback, useState } from "react";
import { getServerUrl } from "../lib/serverUrl";
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

// Extended Mention that renders data-mention-type for @everyone/@role
const ExtendedMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mentionType: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-mention-type"),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.mentionType) return {};
          return { "data-mention-type": attributes.mentionType as string };
        },
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, string> = {
      ...HTMLAttributes,
      class: "mention",
      "data-id": node.attrs.id,
    };
    if (node.attrs.mentionType) {
      attrs["data-mention-type"] = node.attrs.mentionType;
    }
    return ["span", attrs, `@${node.attrs.label ?? node.attrs.id}`];
  },
});

const extensions = [
  StarterKit.configure({ codeBlock: false, link: false, underline: false }),
  CodeBlockLowlight.configure({ lowlight }),
  Link.configure({ openOnClick: false }),
  TiptapUnderline,
  ExtendedMention.configure({
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

// ─── Custom emoji rendering ─────────────────────────

/** Matches :uuid: patterns for custom emojis */
const CUSTOM_EMOJI_RE = /:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):/gi;

/** Returns true if text contains ONLY custom emoji patterns and whitespace */
function isCustomEmojiOnly(text: string): boolean {
  return text.replace(CUSTOM_EMOJI_RE, "").trim().length === 0;
}

/** Count the number of custom emoji patterns in text */
function countCustomEmojis(text: string): number {
  return (text.match(CUSTOM_EMOJI_RE) || []).length;
}

/** Replace :uuid: patterns in HTML with <img> tags for custom emojis */
function replaceCustomEmojis(
  input: string,
  emojiMap: Map<string, { name: string; image_url: string }>,
  baseUrl: string,
): string {
  return input.replace(CUSTOM_EMOJI_RE, (match, id) => {
    const emoji = emojiMap.get(id);
    if (!emoji) return match;
    return `<img class="custom-emoji" data-custom-emoji data-emoji-id="${id}" src="${baseUrl}${emoji.image_url}" alt=":${emoji.name}:" title=":${emoji.name}:" draggable="false" />`;
  });
}

/** Check if tiptap HTML contains only custom emoji images (no other text content) */
function isHtmlCustomEmojiOnly(html: string): boolean {
  const stripped = html
    .replace(/<img\s+class="custom-emoji"[^>]*\/?\s*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return stripped.length === 0;
}

interface Props {
  text: string;
  contentType?: string;
  formatting?: object;
  /** Map of emoji ID -> { name, image_url } for custom emoji rendering */
  customEmojiMap?: Map<string, { name: string; image_url: string }>;
}

export default function MessageBody({ text, contentType, formatting, customEmojiMap }: Props) {
  const [warningUrl, setWarningUrl] = useState<string | null>(null);

  const baseUrl = useMemo(() => getServerUrl(), []);

  const html = useMemo(() => {
    if (contentType === "tiptap" && formatting) {
      try {
        let result = generateHTML(formatting as Parameters<typeof generateHTML>[0], extensions);
        if (customEmojiMap && customEmojiMap.size > 0) {
          result = replaceCustomEmojis(result, customEmojiMap, baseUrl);
        }
        return result;
      } catch {
        return null;
      }
    }
    return null;
  }, [contentType, formatting, customEmojiMap, baseUrl]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // Handle spoiler reveals
    if (target.classList.contains("spoiler")) {
      target.classList.toggle("spoiler-revealed");
      return;
    }

    // Handle @user mention clicks — show profile popup (skip @everyone and @role)
    const userMention = target.closest(".mention:not([data-type='channel']):not([data-mention-type='everyone']):not([data-mention-type='role'])") as HTMLElement | null;
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
        const serverHostname = new URL(getServerUrl()).hostname;
        if (linkUrl.hostname === serverHostname) return;
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
    const richJumbo = customEmojiMap && customEmojiMap.size > 0 && isHtmlCustomEmojiOnly(html) && countCustomEmojis(html) <= 10;
    return (
      <>
        <div
          className={`message-body message-rich${richJumbo ? " message-body-jumbo" : ""}`}
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

  // Check if plain text contains custom emojis
  const hasCustomEmoji = customEmojiMap && customEmojiMap.size > 0 && CUSTOM_EMOJI_RE.test(text);

  if (hasCustomEmoji) {
    const customOnly = isCustomEmojiOnly(text);
    const customCount = countCustomEmojis(text);
    const jumboCustom = customOnly && customCount <= 10;
    const processed = replaceCustomEmojis(text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), customEmojiMap!, baseUrl);
    return <div className={`message-body${jumboCustom ? " message-body-jumbo" : ""}`} dangerouslySetInnerHTML={{ __html: processed }} />;
  }

  const emojiCount = getEmojiOnlyCount(text);
  const jumbo = emojiCount > 0 && emojiCount <= 10;

  return <div className={`message-body${jumbo ? " message-body-jumbo" : ""}`}>{text}</div>;
}
