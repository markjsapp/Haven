import TiptapUnderline from "@tiptap/extension-underline";
import { markInputRule } from "@tiptap/core";

/**
 * Discord-style Underline extension.
 * Uses __text__ syntax (instead of standard markdown which treats __ as bold).
 */
export const Underline = TiptapUnderline.extend({
  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|\s)__([^_]+)__$/,
        type: this.type,
      }),
    ];
  },
});
