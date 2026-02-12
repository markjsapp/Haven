import Mention from "@tiptap/extension-mention";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import MentionList from "../components/MentionList.js";

export interface MemberItem {
  id: string;
  label: string;
}

export function createMentionExtension(getMembers: () => MemberItem[]) {
  return Mention.configure({
    HTMLAttributes: {
      class: "mention",
    },
    suggestion: {
      char: "@",
      items: ({ query }: { query: string }) => {
        const q = query.toLowerCase();
        return getMembers()
          .filter((m) => m.label.toLowerCase().includes(q))
          .slice(0, 8);
      },
      render: () => {
        let component: ReactRenderer | null = null;
        let popup: TippyInstance[] | null = null;

        return {
          onStart: (props: SuggestionProps<MemberItem, MentionNodeAttrs>) => {
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
            popup?.[0]?.destroy();
            component?.destroy();
          },
        };
      },
    },
  });
}
