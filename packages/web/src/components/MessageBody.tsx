import { useMemo, useCallback } from "react";
import { generateHTML } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Spoiler } from "../lib/tiptap-spoiler.js";

const extensions = [
  StarterKit,
  Link.configure({ openOnClick: true }),
  Spoiler,
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
