import { useMemo, useCallback } from "react";
import { generateHTML } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TiptapUnderline from "@tiptap/extension-underline";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import Mention from "@tiptap/extension-mention";
import { Spoiler } from "../lib/tiptap-spoiler.js";
import { Subtext } from "../lib/tiptap-subtext.js";

const lowlight = createLowlight(common);

const extensions = [
  StarterKit.configure({ codeBlock: false }),
  CodeBlockLowlight.configure({ lowlight }),
  Link.configure({ openOnClick: true }),
  TiptapUnderline,
  Mention.configure({
    HTMLAttributes: { class: "mention" },
  }),
  Spoiler,
  Subtext,
];

interface Props {
  text: string;
  contentType?: string;
  formatting?: object;
}

export default function MessageBody({ text, contentType, formatting }: Props) {
  const html = useMemo(() => {
    if (contentType === "tiptap" && formatting) {
      try {
        return generateHTML(formatting as Parameters<typeof generateHTML>[0], extensions);
      } catch {
        return null;
      }
    }
    return null;
  }, [contentType, formatting]);

  const handleSpoilerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("spoiler")) {
      target.classList.toggle("spoiler-revealed");
    }
  }, []);

  if (html) {
    return (
      <div
        className="message-body message-rich"
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={handleSpoilerClick}
      />
    );
  }

  return <div className="message-body">{text}</div>;
}
