import { Node, mergeAttributes } from "@tiptap/core";

/**
 * TipTap atom Node for custom server emojis.
 * Renders as an inline <img> in the editor.
 * Serialises to `:uuid:` in plain text output.
 */
export const CustomEmojiNode = Node.create({
  name: "customEmoji",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      name: { default: null },
      src: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-custom-emoji]',
        getAttrs: (el) => {
          const element = el as HTMLImageElement;
          return {
            id: element.getAttribute("data-emoji-id"),
            name: element.getAttribute("alt"),
            src: element.getAttribute("src"),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(HTMLAttributes, {
        "data-custom-emoji": "",
        "data-emoji-id": HTMLAttributes.id,
        class: "custom-emoji",
        src: HTMLAttributes.src,
        alt: `:${HTMLAttributes.name}:`,
        draggable: "false",
      }),
    ];
  },

  renderText({ node }) {
    return `:${node.attrs.id}:`;
  },
});
