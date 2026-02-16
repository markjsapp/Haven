import { useRef, useEffect, useMemo, lazy, Suspense } from "react";
import { useChatStore } from "../store/chat.js";

const LazyPicker = lazy(() =>
  Promise.all([import("@emoji-mart/data"), import("@emoji-mart/react")]).then(
    ([dataModule, pickerModule]) => ({
      default: (props: Record<string, unknown>) => {
        const Picker = pickerModule.default;
        return <Picker data={dataModule.default} {...props} />;
      },
    })
  )
);

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  serverId?: string;
  position?: "above" | "below";
}

export default function EmojiPicker({ onSelect, onClose, serverId, position = "above" }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const customEmojis = useChatStore((s) => s.customEmojis);
  const custom = useMemo(() => {
    if (!serverId) return undefined;
    const emojis = customEmojis[serverId];
    if (!emojis || emojis.length === 0) return undefined;
    return [
      {
        id: "server-emojis",
        name: "Server Emojis",
        emojis: emojis.map((e) => ({
          id: e.id,
          name: e.name,
          keywords: [e.name],
          skins: [{ src: e.image_url }],
        })),
      },
    ];
  }, [serverId, customEmojis]);

  // When server emojis exist, put them first in category order
  const categoryOrder = useMemo(() => {
    if (!custom) return undefined;
    return ["server-emojis", "frequent", "people", "nature", "foods", "activity", "places", "objects", "symbols", "flags"];
  }, [custom]);

  return (
    <div className={`emoji-picker${position === "below" ? " emoji-picker-below" : ""}`} ref={ref} role="dialog" aria-label="Emoji picker">
      <Suspense fallback={<div className="emoji-picker-loading" />}>
        <LazyPicker
          onEmojiSelect={(emoji: { native?: string; id?: string }) => {
            if (emoji.id && !emoji.native) {
              // Custom emoji — use :uuid: format
              onSelect(`:${emoji.id}:`);
            } else if (emoji.native) {
              onSelect(emoji.native);
            }
            onClose();
          }}
          theme="dark"
          set="native"
          previewPosition="none"
          skinTonePosition="search"
          perLine={8}
          maxFrequentRows={2}
          custom={custom}
          categories={categoryOrder}
        />
      </Suspense>
    </div>
  );
}

// Frequently used emojis for the reaction pill "+" quick-add
export const FREQUENT_EMOJIS = [
  "👍","❤️","😂","🔥","😍","👏","😭","🥺","✨","🎉",
  "💀","😏","🙏","💯","😊","🤔","👀","😅","🥰","😎",
];
