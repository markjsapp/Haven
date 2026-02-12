import { useMemo, useCallback, useState } from "react";
import { generateHTML } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TiptapUnderline from "@tiptap/extension-underline";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import Mention from "@tiptap/extension-mention";
import { Spoiler } from "../lib/tiptap-spoiler.js";
import { Subtext } from "../lib/tiptap-subtext.js";
import LinkWarningModal from "./LinkWarningModal.js";

const lowlight = createLowlight(common);

const extensions = [
  StarterKit.configure({ codeBlock: false, link: false, underline: false }),
  CodeBlockLowlight.configure({ lowlight }),
  Link.configure({ openOnClick: false }),
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
  const [warningUrl, setWarningUrl] = useState<string | null>(null);

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

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // Handle spoiler reveals
    if (target.classList.contains("spoiler")) {
      target.classList.toggle("spoiler-revealed");
      return;
    }

    // Intercept anchor clicks for external link warning
    const anchor = target.closest("a") as HTMLAnchorElement | null;
    if (anchor && anchor.href) {
      try {
        const linkUrl = new URL(anchor.href);
        // Allow same-origin links to pass through
        if (linkUrl.hostname === window.location.hostname) return;
      } catch {
        // If URL parsing fails, still show warning
      }
      e.preventDefault();
      e.stopPropagation();
      setWarningUrl(anchor.href);
    }
  }, []);

  const handleConfirmLink = useCallback(() => {
    if (warningUrl) {
      window.open(warningUrl, "_blank", "noopener,noreferrer");
      setWarningUrl(null);
    }
  }, [warningUrl]);

  if (html) {
    return (
      <>
        <div
          className="message-body message-rich"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={handleClick}
        />
        {warningUrl && (
          <LinkWarningModal
            url={warningUrl}
            onConfirm={handleConfirmLink}
            onCancel={() => setWarningUrl(null)}
          />
        )}
      </>
    );
  }

  return <div className="message-body">{text}</div>;
}
