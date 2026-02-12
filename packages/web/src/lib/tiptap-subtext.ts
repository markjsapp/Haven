import { Node, textblockTypeInputRule } from "@tiptap/core";

/**
 * Discord-style Subtext node.
 * Typing `-# ` at the start of a line converts it to small, muted text.
 */
export const Subtext = Node.create({
  name: "subtext",
  group: "block",
  content: "inline*",
  defining: true,

  parseHTML() {
    return [{ tag: "p[data-subtext]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "p",
      { ...HTMLAttributes, "data-subtext": "", class: "subtext" },
      0,
    ];
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^-#\s$/,
        type: this.type,
      }),
    ];
  },
});
