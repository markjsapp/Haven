import Mention from "@tiptap/extension-mention";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import MentionList from "../components/MentionList.js";

export interface MemberItem {
  id: string;
  label: string;
  /** "everyone" | "role" for special mentions; undefined = normal user */
  type?: "everyone" | "role";
  /** Role color hex (only for type="role") */
  color?: string | null;
}

/** Shared flag: true when any suggestion popup (mention/channel) is visible. */
export const suggestionActiveRef = { current: false };

/**
 * Extended Mention extension that supports a `mentionType` attribute
 * for distinguishing @everyone, @role, and @user mentions.
 */
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
});

export function createMentionExtension(getMembers: () => MemberItem[]) {
  return ExtendedMention.configure({
    HTMLAttributes: {
      class: "mention",
    },
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ options, node }) => {
      const attrs: Record<string, string> = {
        ...options.HTMLAttributes,
        "data-id": node.attrs.id,
      };
      if (node.attrs.mentionType) {
        attrs["data-mention-type"] = node.attrs.mentionType;
      }
      return ["span", attrs, `@${node.attrs.label ?? node.attrs.id}`];
    },
    suggestion: {
      char: "@",
      items: ({ query }: { query: string }) => {
        const q = query.toLowerCase();
        return getMembers()
          .filter((m) => m.label.toLowerCase().includes(q))
          .slice(0, 10);
      },
      command: ({ editor, range, props }) => {
        const item = props as unknown as MemberItem;
        const nodeAttrs: Record<string, unknown> = {
          id: item.id,
          label: item.label,
        };
        if (item.type) {
          nodeAttrs.mentionType = item.type;
        }

        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: "mention", attrs: nodeAttrs },
            { type: "text", text: " " },
          ])
          .run();

        window.getSelection()?.collapseToEnd();
      },
      render: () => {
        let component: ReactRenderer | null = null;
        let popup: TippyInstance[] | null = null;

        return {
          onStart: (props: SuggestionProps<MemberItem, MentionNodeAttrs>) => {
            suggestionActiveRef.current = true;

            component = new ReactRenderer(MentionList, {
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

          onUpdate(props: SuggestionProps<MemberItem, MentionNodeAttrs>) {
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
