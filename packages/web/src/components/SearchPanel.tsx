import type React from "react";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../store/chat.js";
import { useUiStore } from "../store/ui.js";
import { parseChannelName } from "../lib/channel-utils.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

// ─── Filter Parsing ─────────────────────────────────────

interface SearchFilters {
  query: string;         // remaining text after filters extracted
  inChannel: string[];   // channel name fragments from in:...
  fromUser: string[];    // username fragments from from:...
  has: string[];         // "image" | "video" | "link" | "file" | "attachment"
  after: string | null;  // YYYY-MM-DD
  before: string | null; // YYYY-MM-DD
}

const HAS_KEYWORDS = new Set(["image", "video", "link", "file", "attachment"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseSearchQuery(raw: string): SearchFilters {
  const filters: SearchFilters = { query: "", inChannel: [], fromUser: [], has: [], after: null, before: null };
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
    } else if (prefix === "after" && DATE_RE.test(value)) {
      filters.after = value;
    } else if (prefix === "before" && DATE_RE.test(value)) {
      filters.before = value;
    } else {
      parts.push(m[0]);
    }
  }

  filters.query = parts.join(" ").trim().toLowerCase();
  return filters;
}

/** Remove a filter token from the raw query string */
function removeFilter(rawQuery: string, filterToken: string): string {
  const escaped = filterToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return rawQuery.replace(new RegExp(`\\s*${escaped}`, "i"), "").trim();
}

// ─── Component ──────────────────────────────────────────

export default function SearchPanel() {
  const { t } = useTranslation();
  const initialQuery = useUiStore((s) => s.searchQuery);
  const [rawQuery, setRawQuery] = useState(initialQuery);
  const [dateAfter, setDateAfter] = useState("");
  const [dateBefore, setDateBefore] = useState("");
  const messages = useChatStore((s) => s.messages);
  const userNames = useChatStore((s) => s.userNames);
  const channels = useChatStore((s) => s.channels);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const toggleSearchPanel = useUiStore((s) => s.toggleSearchPanel);
  const selectedServerId = useUiStore((s) => s.selectedServerId);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sync if external searchQuery changes while open
  useEffect(() => {
    if (initialQuery) setRawQuery(initialQuery);
  }, [initialQuery]);

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

  // Merge text filters with date picker filters
  const filters = useMemo(() => {
    const parsed = parseSearchQuery(rawQuery);
    if (dateAfter && DATE_RE.test(dateAfter)) parsed.after = dateAfter;
    if (dateBefore && DATE_RE.test(dateBefore)) parsed.before = dateBefore;
    return parsed;
  }, [rawQuery, dateAfter, dateBefore]);

  const hasAnyFilter = filters.query.length >= 2 || filters.inChannel.length > 0 || filters.fromUser.length > 0 || filters.has.length > 0 || filters.after !== null || filters.before !== null;

  const results = useMemo(() => {
    if (!hasAnyFilter) return [];
    if (filters.query.length < 2 && filters.inChannel.length === 0 && filters.fromUser.length === 0 && filters.has.length === 0 && !filters.after && !filters.before) return [];

    const afterTs = filters.after ? new Date(filters.after + "T00:00:00").getTime() : null;
    const beforeTs = filters.before ? new Date(filters.before + "T23:59:59").getTime() : null;

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

        // Apply date range filters
        if (afterTs || beforeTs) {
          const msgTs = new Date(msg.timestamp).getTime();
          if (afterTs && msgTs < afterTs) continue;
          if (beforeTs && msgTs > beforeTs) continue;
        }

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
        if (hits.length >= 100) break;
      }
      if (hits.length >= 100) break;
    }

    // Sort by timestamp descending (newest first)
    hits.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return hits;
  }, [filters, messages, serverChannelIds, channelNameMap, userIdByName, hasAnyFilter]);

  // Group results by channel
  const groupedResults = useMemo(() => {
    const groups = new Map<string, typeof results>();
    for (const r of results) {
      const existing = groups.get(r.channelId) ?? [];
      existing.push(r);
      groups.set(r.channelId, existing);
    }
    return groups;
  }, [results]);

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

  // Active filters for chips
  const activeFilterChips: Array<{ label: string; token: string; type: "text" | "date" }> = [
    ...filters.inChannel.map((v) => ({ label: `in:${v}`, token: `in:${v}`, type: "text" as const })),
    ...filters.fromUser.map((v) => ({ label: `from:${v}`, token: `from:${v}`, type: "text" as const })),
    ...filters.has.map((v) => ({ label: `has:${v}`, token: `has:${v}`, type: "text" as const })),
    ...(filters.after ? [{ label: `after:${filters.after}`, token: `after:${filters.after}`, type: (dateAfter ? "date" : "text") as "text" | "date" }] : []),
    ...(filters.before ? [{ label: `before:${filters.before}`, token: `before:${filters.before}`, type: (dateBefore ? "date" : "text") as "text" | "date" }] : []),
  ];

  const handleRemoveChip = (chip: typeof activeFilterChips[0]) => {
    if (chip.type === "date") {
      if (chip.label.startsWith("after:")) setDateAfter("");
      if (chip.label.startsWith("before:")) setDateBefore("");
    } else {
      setRawQuery(removeFilter(rawQuery, chip.token));
    }
  };

  return (
    <div className="modal-overlay" onClick={toggleSearchPanel}>
    <div className="search-modal" ref={dialogRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div className="search-panel-header">
        <h3>{t("search.title")}</h3>
        <button type="button" className="btn-ghost" onClick={toggleSearchPanel} aria-label={t("search.closeAriaLabel")}>
          &times;
        </button>
      </div>
      <div className="search-panel-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="search-panel-input"
          placeholder={t("search.placeholder")}
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
        />
      </div>
      <div className="search-date-row">
        <label className="search-date-label">
          {t("search.after")}
          <input
            type="date"
            className="search-date-input"
            value={dateAfter}
            onChange={(e) => setDateAfter(e.target.value)}
          />
        </label>
        <label className="search-date-label">
          {t("search.before")}
          <input
            type="date"
            className="search-date-input"
            value={dateBefore}
            onChange={(e) => setDateBefore(e.target.value)}
          />
        </label>
      </div>
      {activeFilterChips.length > 0 && (
        <div className="search-filters-bar">
          {activeFilterChips.map((chip, i) => (
            <span key={i} className="search-filter-chip">
              {chip.label}
              <button
                type="button"
                className="search-filter-chip-remove"
                onClick={() => handleRemoveChip(chip)}
                aria-label={t("search.removeFilterAriaLabel", { label: chip.label })}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="search-panel-results">
        {hasAnyFilter && results.length > 0 && (
          <div className="search-result-count">
            {results.length >= 100
              ? t("search.resultCountMore", { count: results.length })
              : results.length === 1
                ? t("search.resultCount", { count: results.length })
                : t("search.resultCountPlural", { count: results.length })}
          </div>
        )}
        {hasAnyFilter && results.length === 0 && (
          <div className="search-panel-empty">{t("search.noResults")}</div>
        )}
        {!hasAnyFilter && rawQuery.length > 0 && rawQuery.length < 2 && !dateAfter && !dateBefore && (
          <div className="search-panel-empty">{t("search.minChars")}</div>
        )}
        {!rawQuery && !dateAfter && !dateBefore && (
          <div className="search-panel-hints">
            <div className="search-hint-title">{t("search.hintsTitle")}</div>
            <div className="search-hint-row"><code>in:channel-name</code> — {t("search.hintInChannel")}</div>
            <div className="search-hint-row"><code>from:username</code> — {t("search.hintFromUser")}</div>
            <div className="search-hint-row"><code>has:image</code> — {t("search.hintHasImage")}</div>
            <div className="search-hint-row"><code>has:video</code> — {t("search.hintHasVideo")}</div>
            <div className="search-hint-row"><code>has:link</code> — {t("search.hintHasLink")}</div>
            <div className="search-hint-row"><code>has:file</code> — {t("search.hintHasFile")}</div>
            <div className="search-hint-row"><code>after:YYYY-MM-DD</code> — {t("search.hintAfterDate")}</div>
            <div className="search-hint-row"><code>before:YYYY-MM-DD</code> — {t("search.hintBeforeDate")}</div>
          </div>
        )}
        {Array.from(groupedResults.entries()).map(([channelId, channelResults]) => (
          <div key={channelId} className="search-result-group">
            <div className="search-result-group-header">
              #{getChannelName(channelId)}
              <span className="search-result-group-count">{channelResults.length}</span>
            </div>
            {channelResults.map((r) => {
              const senderName = userNames[r.senderId] ?? r.senderId.slice(0, 8);
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
                    <span className="search-result-time">
                      {new Date(r.timestamp).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                  <div className="search-result-text">{snippet}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}
