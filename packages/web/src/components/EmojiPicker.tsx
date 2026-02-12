import { useRef, useEffect } from "react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

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
      <Picker
        data={data}
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
    </div>
  );
}

// Frequently used emojis for the reaction pill "+" quick-add
export const FREQUENT_EMOJIS = [
  "👍","❤️","😂","🔥","😍","👏","😭","🥺","✨","🎉",
  "💀","😏","🙏","💯","😊","🤔","👀","😅","🥰","😎",
];
