import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import Avatar from "./Avatar.js";

interface MentionItem {
  id: string;
  label: string;
  type?: "everyone" | "role";
  color?: string | null;
}

interface MentionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

export default forwardRef<{ onKeyDown: (props: { event: KeyboardEvent }) => boolean }, MentionListProps>(
  function MentionList({ items, command }, ref) {
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
      <div className="mention-list" role="listbox" aria-label="Mention suggestions">
        {items.map((item, index) => (
          <button
            role="option"
            aria-selected={index === selectedIndex}
            key={item.id}
            className={`mention-list-item ${index === selectedIndex ? "mention-list-item-active" : ""}`}
            onClick={() => selectItem(index)}
          >
            {item.type === "everyone" ? (
              <span className="mention-list-icon mention-list-icon-everyone">@</span>
            ) : item.type === "role" ? (
              <span
                className="mention-list-icon mention-list-icon-role"
                style={{ backgroundColor: item.color || "var(--text-muted)" }}
              />
            ) : (
              <Avatar name={item.label} size={24} />
            )}
            <span className="mention-list-name">{item.label}</span>
          </button>
        ))}
      </div>
    );
  }
);
