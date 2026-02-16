import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import type { EmojiSuggestItem } from "../lib/tiptap-emoji-suggest.js";

interface EmojiSuggestListProps {
  items: EmojiSuggestItem[];
  command: (item: EmojiSuggestItem) => void;
}

export default forwardRef<{ onKeyDown: (props: { event: KeyboardEvent }) => boolean }, EmojiSuggestListProps>(
  function EmojiSuggestList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) return null;

    return (
      <div className="mention-list emoji-suggest-list" role="listbox" aria-label="Emoji suggestions">
        {items.map((item, index) => (
          <button
            role="option"
            aria-selected={index === selectedIndex}
            key={item.id}
            className={`mention-list-item ${index === selectedIndex ? "mention-list-item-active" : ""}`}
            onClick={() => selectItem(index)}
          >
            {item.isCustom && item.src ? (
              <img src={item.src} alt={item.name} className="custom-emoji" style={{ width: 20, height: 20 }} />
            ) : (
              <span className="emoji-suggest-native">{item.native}</span>
            )}
            <span className="mention-list-name">:{item.name}:</span>
          </button>
        ))}
      </div>
    );
  }
);
