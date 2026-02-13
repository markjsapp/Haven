import type React from "react";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useChatStore } from "../store/chat.js";
import { useUiStore } from "../store/ui.js";
import { parseChannelName } from "../lib/channel-utils.js";

// ─── Filter Parsing ─────────────────────────────────────

interface SearchFilters {
  query: string;         // remaining text after filters extracted
  inChannel: string[];   // channel name fragments from in:...
  fromUser: string[];    // username fragments from from:...
  has: string[];         // "image" | "video" | "link" | "file" | "attachment"
}

const HAS_KEYWORDS = new Set(["image", "video", "link", "file", "attachment"]);

function parseSearchQuery(raw: string): SearchFilters {
  const filters: SearchFilters = { query: "", inChannel: [], fromUser: [], has: [] };
  const parts: string[] = [];

  // Tokenize, respecting quoted strings
  const regex = /(\w+):"([^"]+)"|(\w+):(\S+)|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(raw)) !== null) {
    const prefix = (m[1] || m[3] || "").toLowerCase();
    const value = m[2] || m[4] || m[5] || "";

    if (prefix === "in") {
      filters.inChannel.push(value.toLowerCase());
    } else if (prefix === "from") {
      filters.fromUser.push(value.toLowerCase());
    } else if (prefix === "has" && HAS_KEYWORDS.has(value.toLowerCase())) {
      filters.has.push(value.toLowerCase());
    } else {
      parts.push(m[0]);
    }
  }

  filters.query = parts.join(" ").trim().toLowerCase();
  return filters;
}

// ─── Component ──────────────────────────────────────────

export default function SearchPanel() {
  const [rawQuery, setRawQuery] = useState("");
  const messages = useChatStore((s) => s.messages);
  const userNames = useChatStore((s) => s.userNames);
  const channels = useChatStore((s) => s.channels);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const toggleSearchPanel = useUiStore((s) => s.toggleSearchPanel);
  const selectedServerId = useUiStore((s) => s.selectedServerId);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Build channel name lookup
  const channelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of channels) {
      map.set(ch.id, parseChannelName(ch.encrypted_meta).toLowerCase());
    }
    return map;
  }, [channels]);

  // Reverse: username -> userId lookup
  const userIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, name] of Object.entries(userNames)) {
      map.set(name.toLowerCase(), id);
    }
    return map;
  }, [userNames]);

  // Server channel IDs (scope search to current server)
  const serverChannelIds = useMemo(() => {
    if (!selectedServerId) return null; // DM mode — search all
    return new Set(
      channels
        .filter((ch) => ch.server_id === selectedServerId)
        .map((ch) => ch.id)
    );
  }, [channels, selectedServerId]);

  const filters = useMemo(() => parseSearchQuery(rawQuery), [rawQuery]);
  const hasAnyFilter = filters.query.length >= 2 || filters.inChannel.length > 0 || filters.fromUser.length > 0 || filters.has.length > 0;

  const results = useMemo(() => {
    if (!hasAnyFilter) return [];
    // If only filters but no text query, require at least one filter
    if (filters.query.length < 2 && filters.inChannel.length === 0 && filters.fromUser.length === 0 && filters.has.length === 0) return [];

    const hits: Array<{
      channelId: string;
      messageId: string;
      senderId: string;
      text: string;
      timestamp: string;
      hasAttachment: boolean;
    }> = [];

    // Resolve from: filters to user IDs
    const fromUserIds = new Set<string>();
    for (const name of filters.fromUser) {
      for (const [userName, userId] of userIdByName) {
        if (userName.includes(name)) fromUserIds.add(userId);
      }
    }

    for (const [channelId, msgs] of Object.entries(messages)) {
      // Skip channels outside current server
      if (serverChannelIds && !serverChannelIds.has(channelId)) continue;

      // Apply in: filter
      if (filters.inChannel.length > 0) {
        const chName = channelNameMap.get(channelId) ?? "";
        if (!filters.inChannel.some((f) => chName.includes(f))) continue;
      }

      for (const msg of msgs) {
        if (msg.messageType === "system") continue;

        // Apply from: filter
        if (filters.fromUser.length > 0 && !fromUserIds.has(msg.senderId)) continue;

        // Apply has: filter
        if (filters.has.length > 0) {
          const text = msg.text.toLowerCase();
          const hasAttach = (msg.attachments?.length ?? 0) > 0;
          let passHas = true;
          for (const h of filters.has) {
            if (h === "image" && !hasAttach && !text.includes("image")) { passHas = false; break; }
            if (h === "video" && !hasAttach && !text.includes("video")) { passHas = false; break; }
            if (h === "file" || h === "attachment") {
              if (!hasAttach) { passHas = false; break; }
            }
            if (h === "link" && !text.match(/https?:\/\//)) { passHas = false; break; }
          }
          if (!passHas) continue;
        }

        // Apply text query
        if (filters.query.length >= 2) {
          if (!msg.text.toLowerCase().includes(filters.query)) continue;
        }

        hits.push({
          channelId,
          messageId: msg.id,
          senderId: msg.senderId,
          text: msg.text,
          timestamp: msg.timestamp,
          hasAttachment: (msg.attachments?.length ?? 0) > 0,
        });
        if (hits.length >= 50) break;
      }
      if (hits.length >= 50) break;
    }

    return hits;
  }, [filters, messages, serverChannelIds, channelNameMap, userIdByName, hasAnyFilter]);

  const jumpToResult = useCallback(async (channelId: string, messageId: string) => {
    await selectChannel(channelId);
    toggleSearchPanel();
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [selectChannel, toggleSearchPanel]);

  const getChannelName = useCallback((channelId: string) => {
    return channelNameMap.get(channelId) ?? channelId.slice(0, 8);
  }, [channelNameMap]);

  // Active filters display
  const activeFilters = [
    ...filters.inChannel.map((v) => `in:${v}`),
    ...filters.fromUser.map((v) => `from:${v}`),
    ...filters.has.map((v) => `has:${v}`),
  ];

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <h3>Search</h3>
        <button type="button" className="btn-ghost" onClick={toggleSearchPanel} aria-label="Close search">
          &times;
        </button>
      </div>
      <div className="search-panel-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="search-panel-input"
          placeholder="Search... (in:channel from:user has:image)"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
        />
      </div>
      {activeFilters.length > 0 && (
        <div className="search-filters-bar">
          {activeFilters.map((f, i) => (
            <span key={i} className="search-filter-pill">{f}</span>
          ))}
        </div>
      )}
      <div className="search-panel-results">
        {hasAnyFilter && results.length === 0 && (
          <div className="search-panel-empty">No results found.</div>
        )}
        {!hasAnyFilter && rawQuery.length > 0 && rawQuery.length < 2 && (
          <div className="search-panel-empty">Type at least 2 characters to search.</div>
        )}
        {!rawQuery && (
          <div className="search-panel-hints">
            <div className="search-hint-title">Search Filters</div>
            <div className="search-hint-row"><code>in:channel-name</code> — search in a specific channel</div>
            <div className="search-hint-row"><code>from:username</code> — search by sender</div>
            <div className="search-hint-row"><code>has:image</code> — messages with images</div>
            <div className="search-hint-row"><code>has:video</code> — messages with videos</div>
            <div className="search-hint-row"><code>has:link</code> — messages with links</div>
            <div className="search-hint-row"><code>has:file</code> — messages with attachments</div>
          </div>
        )}
        {results.map((r) => {
          const senderName = userNames[r.senderId] ?? r.senderId.slice(0, 8);
          // Highlight match
          const lowerText = r.text.toLowerCase();
          const matchIdx = filters.query ? lowerText.indexOf(filters.query) : -1;

          let snippet: React.JSX.Element;
          if (matchIdx >= 0) {
            const snippetStart = Math.max(0, matchIdx - 30);
            const snippetEnd = Math.min(r.text.length, matchIdx + filters.query.length + 30);
            const before = r.text.slice(snippetStart, matchIdx);
            const match = r.text.slice(matchIdx, matchIdx + filters.query.length);
            const after = r.text.slice(matchIdx + filters.query.length, snippetEnd);
            snippet = (
              <>
                {snippetStart > 0 && "..."}
                {before}
                <mark>{match}</mark>
                {after}
                {snippetEnd < r.text.length && "..."}
              </>
            );
          } else {
            // No text match (filter-only result), show truncated text
            snippet = <>{r.text.length > 80 ? r.text.slice(0, 80) + "..." : r.text}</>;
          }

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
              <div className="search-result-text">{snippet}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
