import { useState, useRef, useEffect } from "react";

const CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "Smileys",
    emojis: [
      "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😊",
      "😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋",
      "😛","😜","🤪","😝","🤑","🤗","🤭","🫢","🤫","🤔",
      "🫡","🤐","🤨","😐","😑","😶","🫥","😏","😒","🙄",
      "😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕",
      "🤢","🤮","🥴","😵","🤯","🥳","🥸","😎","🤓","🧐",
      "😕","🫤","😟","🙁","😮","😯","😲","😳","🥺","🥹",
      "😦","😧","😨","😰","😥","😢","😭","😱","😖","😣",
      "😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈",
      "👿","💀","☠️","💩","🤡","👹","👺","👻","👽","👾",
      "🤖","😺","😸","😹","😻","😼","😽","🙀","😿","😾",
    ],
  },
  {
    label: "Gestures",
    emojis: [
      "👋","🤚","🖐️","✋","🖖","🫱","🫲","🫳","🫴","👌",
      "🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉",
      "👆","🖕","👇","☝️","🫵","👍","👎","✊","👊","🤛",
      "🤜","👏","🙌","🫶","👐","🤲","🤝","🙏","💪","🦾",
    ],
  },
  {
    label: "Hearts",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔",
      "❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓","💗","💖","💘","💝",
      "💟","♥️","🫀",
    ],
  },
  {
    label: "Animals",
    emojis: [
      "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨",
      "🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐒",
      "🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗",
      "🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🪰",
    ],
  },
  {
    label: "Food",
    emojis: [
      "🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈",
      "🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🫛",
      "🥦","🥬","🌶️","🫑","🌽","🥕","🧄","🧅","🥔","🍠",
      "🍕","🍔","🍟","🌭","🍿","🧂","🥚","🍳","🧇","🥞",
      "🍩","🍪","🎂","🍰","🧁","🥧","🍫","🍬","🍭","🍮",
      "☕","🍵","🧋","🍺","🍻","🥂","🍷","🥃","🍸","🍹",
    ],
  },
  {
    label: "Activities",
    emojis: [
      "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱",
      "🏓","🏸","🏒","🥅","⛳","🏹","🎣","🤿","🥊","🥋",
      "🎿","⛷️","🏂","🎮","🕹️","🎲","🧩","🎯","🎳","🎪",
      "🎨","🎭","🎼","🎵","🎶","🎤","🎧","🎷","🪗","🎸",
      "🎹","🎺","🎻","🥁","🪘","🔥","✨","🎉","🎊","🏆",
    ],
  },
  {
    label: "Objects",
    emojis: [
      "💡","🔦","🕯️","💰","💎","🔧","🔨","⚙️","🔩","🧲",
      "📎","🖊️","✏️","📝","📁","📂","📅","📌","📍","🔑",
      "🔒","🔓","🛡️","⚔️","🔫","🪃","💣","🧨","🪓","🔪",
      "⏰","⌛","📡","🔋","💻","🖥️","📱","📷","📹","📺",
    ],
  },
  {
    label: "Flags",
    emojis: [
      "🏁","🚩","🎌","🏴","🏳️","🏳️‍🌈","🏳️‍⚧️","🏴‍☠️",
      "🇺🇸","🇬🇧","🇨🇦","🇦🇺","🇫🇷","🇩🇪","🇯🇵","🇰🇷",
      "🇨🇳","🇧🇷","🇮🇳","🇲🇽","🇮🇹","🇪🇸","🇷🇺","🇳🇱",
    ],
  },
];

// Frequently used emojis (shown at top)
const FREQUENT_EMOJIS = [
  "👍","❤️","😂","🔥","😍","👏","😭","🥺","✨","🎉",
  "💀","😏","🙏","💯","😊","🤔","👀","😅","🥰","😎",
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(-1); // -1 = frequent
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

  const filteredCategories = search
    ? CATEGORIES.map((cat) => ({
        ...cat,
        emojis: cat.emojis.filter((e) => e.includes(search)),
      })).filter((cat) => cat.emojis.length > 0)
    : CATEGORIES;

  return (
    <div className="emoji-picker" ref={ref}>
      <div className="emoji-picker-header">
        <input
          className="emoji-picker-search"
          type="text"
          placeholder="Search emojis..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="emoji-picker-categories">
        {!search && (
          <button
            type="button"
            className={`emoji-category-tab ${activeCategory === -1 ? "active" : ""}`}
            onClick={() => setActiveCategory(-1)}
            title="Frequently Used"
          >
            🕐
          </button>
        )}
        {(search ? filteredCategories : CATEGORIES).map((cat, i) => (
          <button
            key={cat.label}
            type="button"
            className={`emoji-category-tab ${activeCategory === i && !search ? "active" : ""}`}
            onClick={() => setActiveCategory(i)}
            title={cat.label}
          >
            {cat.emojis[0]}
          </button>
        ))}
      </div>
      <div className="emoji-picker-body">
        {search ? (
          filteredCategories.length === 0 ? (
            <div className="emoji-picker-empty">No emojis found</div>
          ) : (
            filteredCategories.map((cat) => (
              <div key={cat.label}>
                <div className="emoji-section-label">{cat.label}</div>
                <div className="emoji-grid">
                  {cat.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="emoji-btn"
                      onClick={() => { onSelect(emoji); onClose(); }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )
        ) : activeCategory === -1 ? (
          <div>
            <div className="emoji-section-label">Frequently Used</div>
            <div className="emoji-grid">
              {FREQUENT_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="emoji-btn"
                  onClick={() => { onSelect(emoji); onClose(); }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="emoji-section-label">{CATEGORIES[activeCategory].label}</div>
            <div className="emoji-grid">
              {CATEGORIES[activeCategory].emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="emoji-btn"
                  onClick={() => { onSelect(emoji); onClose(); }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { CATEGORIES, FREQUENT_EMOJIS };
