import { useRef, useEffect, lazy, Suspense } from "react";

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
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
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

  return (
    <div className="emoji-picker" ref={ref}>
      <Suspense fallback={<div className="emoji-picker-loading" />}>
        <LazyPicker
          onEmojiSelect={(emoji: { native: string }) => {
            onSelect(emoji.native);
            onClose();
          }}
          theme="dark"
          set="native"
          previewPosition="none"
          skinTonePosition="search"
          perLine={8}
          maxFrequentRows={2}
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
