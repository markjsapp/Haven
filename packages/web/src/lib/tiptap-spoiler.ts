import { Mark, mergeAttributes } from "@tiptap/core";
import { InputRule } from "@tiptap/core";

/**
 * Custom TipTap Mark for spoiler text (||spoiler||).
 * Renders as <span class="spoiler"> which is styled with blur in CSS.
 */
export const Spoiler = Mark.create({
  name: "spoiler",

  parseHTML() {
    return [{ tag: 'span[data-spoiler]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-spoiler": "",
        class: "spoiler",
      }),
      0,
    ];
  },

  addInputRules() {
    // Match ||text|| and wrap in spoiler mark
    return [
      new InputRule({
        find: /\|\|([^|]+)\|\|$/,
        handler: ({ state, range, match }) => {
          const { tr } = state;
          const start = range.from;
          const end = range.to;
          const text = match[1];

          tr.replaceWith(start, end, state.schema.text(text, [this.type.create()]));
        },
      }),
    ];
  },
});
