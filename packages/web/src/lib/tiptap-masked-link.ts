import { Extension, InputRule } from "@tiptap/core";

/**
 * Masked link InputRule for Discord-style [text](url) syntax.
 * Converts [display text](https://example.com) into a clickable link.
 */
export const MaskedLink = Extension.create({
  name: "maskedLink",

  addInputRules() {
    return [
      new InputRule({
        find: /\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/,
        handler: ({ state, range, match }) => {
          const { tr, schema } = state;
          const [, text, url] = match;

          const linkMark = schema.marks.link;
          if (!linkMark) return;

          tr.replaceWith(
            range.from,
            range.to,
            schema.text(text, [linkMark.create({ href: url })]),
          );
        },
      }),
    ];
  },
});
