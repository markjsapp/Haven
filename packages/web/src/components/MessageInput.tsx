import { useState, type FormEvent } from "react";
import { useChatStore } from "../store/chat.js";

export default function MessageInput() {
  const [text, setText] = useState("");
  const sendMessage = useChatStore((s) => s.sendMessage);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    await sendMessage(trimmed);
  }

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Type a message..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <button type="submit" disabled={!text.trim()}>
        Send
      </button>
    </form>
  );
}
