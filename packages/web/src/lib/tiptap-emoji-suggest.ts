import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import EmojiSuggestList from "../components/EmojiSuggestList.js";
import { suggestionActiveRef } from "./tiptap-mention.js";

export interface EmojiSuggestItem {
  /** For unicode: emoji id (e.g. "grinning"). For custom: uuid. */
  id: string;
  /** Display name */
  name: string;
  /** The native emoji character (unicode only) */
  native?: string;
  /** Image URL (custom only) */
  src?: string;
  /** Whether this is a custom server emoji */
  isCustom?: boolean;
}

interface EmojiData {
  emojis: Record<string, {
    id: string;
    name: string;
    keywords: string[];
    skins: Array<{ native?: string; unified?: string }>;
  }>;
}

let emojiData: EmojiData | null = null;
let emojiList: Array<{ id: string; name: string; native: string; keywords: string[] }> = [];

async function loadEmojiData() {
  if (emojiData) return;
  const mod = await import("@emoji-mart/data");
  emojiData = mod.default as EmojiData;
  emojiList = Object.values(emojiData.emojis)
    .filter((e) => e.skins?.[0]?.native)
    .map((e) => ({
      id: e.id,
      name: e.name,
      native: e.skins[0].native!,
      keywords: e.keywords ?? [],
    }));
}

// Kick off preload (non-blocking)
loadEmojiData();

type CustomEmojiGetter = () => Array<{ id: string; name: string; image_url: string }>;

export function createEmojiSuggestExtension(getCustomEmojis: CustomEmojiGetter) {
  return Extension.create({
    name: "emojiSuggest",

    addProseMirrorPlugins() {
      return [
        Suggestion<EmojiSuggestItem>({
          editor: this.editor,
          char: ":",
          // Require at least 2 chars after the colon to trigger
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }: { query: string }) => {
            if (query.length < 2) return [];
            const q = query.toLowerCase();
            const results: EmojiSuggestItem[] = [];

            // Search custom server emojis first
            const customs = getCustomEmojis();
            for (const e of customs) {
              if (e.name.toLowerCase().includes(q)) {
                results.push({ id: e.id, name: e.name, src: e.image_url, isCustom: true });
              }
              if (results.length >= 8) return results;
            }

            // Search unicode emojis
            for (const e of emojiList) {
              if (
                e.id.includes(q) ||
                e.name.toLowerCase().includes(q) ||
                e.keywords.some((k) => k.includes(q))
              ) {
                results.push({ id: e.id, name: e.name, native: e.native });
              }
              if (results.length >= 8) break;
            }

            return results;
          },
          command: ({ editor, range, props: item }) => {
            if (item.isCustom && item.src) {
              // Insert custom emoji node
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent({
                  type: "customEmoji",
                  attrs: { id: item.id, name: item.name, src: item.src },
                })
                .run();
            } else if (item.native) {
              // Insert native unicode emoji
              editor.chain().focus().deleteRange(range).insertContent(item.native).run();
            }
          },
          render: () => {
            let component: ReactRenderer | null = null;
            let popup: TippyInstance[] | null = null;

            return {
              onStart: (props: SuggestionProps<EmojiSuggestItem>) => {
                suggestionActiveRef.current = true;

                component = new ReactRenderer(EmojiSuggestList, {
                  props,
                  editor: props.editor,
                });

                if (!props.clientRect) return;

                popup = tippy("body", {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: "manual",
                  placement: "bottom-start",
                });
              },

              onUpdate(props: SuggestionProps<EmojiSuggestItem>) {
                component?.updateProps(props);
                if (popup && props.clientRect) {
                  popup[0].setProps({
                    getReferenceClientRect: props.clientRect as () => DOMRect,
                  });
                }
              },

              onKeyDown(props: SuggestionKeyDownProps) {
                if (props.event.key === "Escape") {
                  popup?.[0]?.hide();
                  return true;
                }
                return (component?.ref as any)?.onKeyDown(props) ?? false;
              },

              onExit() {
                suggestionActiveRef.current = false;
                popup?.[0]?.destroy();
                component?.destroy();
              },
            };
          },
        }),
      ];
    },
  });
}
