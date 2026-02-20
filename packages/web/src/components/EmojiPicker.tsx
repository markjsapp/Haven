import { useRef, useEffect, useMemo, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../store/chat.js";
import { getServerUrl } from "../lib/serverUrl.js";

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
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay listener so the opening click doesn't immediately close the picker
    const id = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleClick);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const customEmojis = useChatStore((s) => s.customEmojis);
  const baseUrl = useMemo(() => getServerUrl(), []);
  const custom = useMemo(() => {
    if (!serverId) return undefined;
    const emojis = customEmojis[serverId];
    if (!emojis || emojis.length === 0) return undefined;
    return [
      {
        id: "server-emojis",
        name: t("emojiPicker.serverEmojis"),
        emojis: emojis.map((e) => ({
          id: e.id,
          name: e.name,
          keywords: [e.name],
          skins: [{ src: `${baseUrl}${e.image_url}` }],
        })),
      },
    ];
  }, [serverId, customEmojis, t, baseUrl]);

  return (
    <div className={`emoji-picker${position === "below" ? " emoji-picker-below" : ""}`} ref={ref} role="dialog" aria-label={t("emojiPicker.ariaLabel")}>
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
