import Mention from "@tiptap/extension-mention";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import ChannelMentionList from "../components/ChannelMentionList.js";
import { suggestionActiveRef } from "./tiptap-mention.js";

export interface ChannelItem {
  id: string;
  label: string;
}

export function createChannelMentionExtension(getChannels: () => ChannelItem[]) {
  return Mention.extend({ name: "channelMention" }).configure({
    HTMLAttributes: {
      class: "mention mention-channel",
      "data-type": "channel",
    },
    // Always render with # prefix (suggestion is null during generateHTML)
    renderText: ({ node }) => `#${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ options, node }) => [
      "span",
      { ...options.HTMLAttributes, "data-id": node.attrs.id },
      `#${node.attrs.label ?? node.attrs.id}`,
    ],
    suggestion: {
      char: "#",
      items: ({ query }: { query: string }) => {
        const q = query.toLowerCase();
        return getChannels()
          .filter((ch) => ch.label.toLowerCase().includes(q))
          .slice(0, 8);
      },
      render: () => {
        let component: ReactRenderer | null = null;
        let popup: TippyInstance[] | null = null;

        return {
          onStart: (props: SuggestionProps<ChannelItem, MentionNodeAttrs>) => {
            suggestionActiveRef.current = true;

            component = new ReactRenderer(ChannelMentionList, {
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

          onUpdate(props: SuggestionProps<ChannelItem, MentionNodeAttrs>) {
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
    },
  });
}
