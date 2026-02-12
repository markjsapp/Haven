import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useChatStore } from "../store/chat.js";
import { useUiStore } from "../store/ui.js";

export default function SearchPanel() {
  const [query, setQuery] = useState("");
  const messages = useChatStore((s) => s.messages);
  const userNames = useChatStore((s) => s.userNames);
  const channels = useChatStore((s) => s.channels);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const toggleSearchPanel = useUiStore((s) => s.toggleSearchPanel);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];

    const hits: Array<{
      channelId: string;
      messageId: string;
      senderId: string;
      text: string;
      timestamp: string;
    }> = [];

    for (const [channelId, msgs] of Object.entries(messages)) {
      for (const msg of msgs) {
        if (msg.messageType === "system") continue;
        if (msg.text.toLowerCase().includes(q)) {
          hits.push({
            channelId,
            messageId: msg.id,
            senderId: msg.senderId,
            text: msg.text,
            timestamp: msg.timestamp,
          });
          if (hits.length >= 50) break;
        }
      }
      if (hits.length >= 50) break;
    }

    return hits;
  }, [query, messages]);

  const jumpToResult = useCallback(async (channelId: string, messageId: string) => {
    await selectChannel(channelId);
    toggleSearchPanel();
    // Allow React to render messages, then scroll
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [selectChannel, toggleSearchPanel]);

  const getChannelName = useCallback((channelId: string) => {
    const ch = channels.find((c) => c.id === channelId);
    if (!ch) return channelId.slice(0, 8);
    try {
      const meta = JSON.parse(atob(ch.encrypted_meta));
      return meta.name ?? meta.type ?? channelId.slice(0, 8);
    } catch {
      return channelId.slice(0, 8);
    }
  }, [channels]);

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <h3>Search</h3>
        <button type="button" className="btn-ghost" onClick={toggleSearchPanel}>
          &times;
        </button>
      </div>
      <div className="search-panel-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="search-panel-input"
          placeholder="Search messages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="search-panel-results">
        {query.length >= 2 && results.length === 0 && (
          <div className="search-panel-empty">No results found.</div>
        )}
        {results.map((r) => {
          const senderName = userNames[r.senderId] ?? r.senderId.slice(0, 8);
          // Highlight match
          const lowerText = r.text.toLowerCase();
          const matchIdx = lowerText.indexOf(query.toLowerCase());
          const snippetStart = Math.max(0, matchIdx - 30);
          const snippetEnd = Math.min(r.text.length, matchIdx + query.length + 30);
          const before = r.text.slice(snippetStart, matchIdx);
          const match = r.text.slice(matchIdx, matchIdx + query.length);
          const after = r.text.slice(matchIdx + query.length, snippetEnd);

          return (
            <div
              key={r.messageId}
              className="search-result"
              onClick={() => jumpToResult(r.channelId, r.messageId)}
            >
              <div className="search-result-header">
                <span className="search-result-sender">{senderName}</span>
                <span className="search-result-channel">#{getChannelName(r.channelId)}</span>
                <span className="search-result-time">
                  {new Date(r.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>
              </div>
              <div className="search-result-text">
                {snippetStart > 0 && "..."}
                {before}
                <mark>{match}</mark>
                {after}
                {snippetEnd < r.text.length && "..."}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
