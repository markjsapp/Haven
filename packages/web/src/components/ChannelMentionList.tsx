import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

interface ChannelItem {
  id: string;
  label: string;
}

interface ChannelMentionListProps {
  items: ChannelItem[];
  command: (item: ChannelItem) => void;
}

export default forwardRef<{ onKeyDown: (props: { event: KeyboardEvent }) => boolean }, ChannelMentionListProps>(
  function ChannelMentionList({ items, command }, ref) {
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
      <div className="mention-list" role="listbox" aria-label="Channel suggestions">
        {items.map((item, index) => (
          <button
            role="option"
            aria-selected={index === selectedIndex}
            key={item.id}
            className={`mention-list-item ${index === selectedIndex ? "mention-list-item-active" : ""}`}
            onClick={() => selectItem(index)}
          >
            <span className="channel-mention-hash">#</span>
            <span className="mention-list-name">{item.label}</span>
          </button>
        ))}
      </div>
    );
  }
);
