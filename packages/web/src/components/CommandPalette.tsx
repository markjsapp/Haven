import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { useUiStore } from "../store/ui.js";
import { useFriendsStore } from "../store/friends.js";
import { parseServerName, parseChannelDisplay } from "../lib/channel-utils.js";

interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  category: "channels" | "servers" | "dms" | "actions";
  icon?: string;
  action: () => void;
}

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const servers = useChatStore((s) => s.servers);
  const channels = useChatStore((s) => s.channels);
  const selectChannel = useChatStore((s) => s.selectChannel);
  const selectServer = useUiStore((s) => s.selectServer);
  const setShowUserSettings = useUiStore((s) => s.setShowUserSettings);
  const setShowAdminPanel = useUiStore((s) => s.setShowAdminPanel);
  const toggleMemberSidebar = useUiStore((s) => s.toggleMemberSidebar);
  const setShowFriends = useUiStore((s) => s.setShowFriends);
  const selectedServerId = useUiStore((s) => s.selectedServerId);
  const user = useAuthStore((s) => s.user);
  const friends = useFriendsStore((s) => s.friends);

  const items = useMemo(() => {
    const results: PaletteItem[] = [];

    // Server channels (text)
    for (const ch of channels) {
      if (ch.channel_type === "voice") continue;
      if (ch.server_id) {
        const display = parseChannelDisplay(ch.encrypted_meta, user?.id ?? "");
        const srv = servers.find((s) => s.id === ch.server_id);
        const srvName = srv ? parseServerName(srv.encrypted_meta) : "";
        results.push({
          id: `ch-${ch.id}`,
          label: `# ${display?.name ?? "channel"}`,
          description: srvName,
          category: "channels",
          action: () => {
            if (ch.server_id) selectServer(ch.server_id);
            selectChannel(ch.id);
            onClose();
          },
        });
      } else {
        // DM channel
        const display = parseChannelDisplay(ch.encrypted_meta, user?.id ?? "");
        results.push({
          id: `dm-${ch.id}`,
          label: display?.name ?? "DM",
          category: "dms",
          action: () => {
            selectServer(null);
            selectChannel(ch.id);
            onClose();
          },
        });
      }
    }

    // Servers
    for (const srv of servers) {
      const name = parseServerName(srv.encrypted_meta);
      results.push({
        id: `srv-${srv.id}`,
        label: name,
        category: "servers",
        action: () => {
          selectServer(srv.id);
          onClose();
        },
      });
    }

    // Actions
    results.push({
      id: "act-settings",
      label: t("commandPalette.userSettings"),
      category: "actions",
      action: () => { setShowUserSettings(true); onClose(); },
    });
    results.push({
      id: "act-friends",
      label: t("commandPalette.friendsList"),
      category: "actions",
      action: () => { selectServer(null); setShowFriends(true); onClose(); },
    });
    results.push({
      id: "act-members",
      label: t("commandPalette.toggleMemberSidebar"),
      category: "actions",
      action: () => { toggleMemberSidebar(); onClose(); },
    });
    if (user?.is_instance_admin) {
      results.push({
        id: "act-admin",
        label: t("commandPalette.adminDashboard"),
        category: "actions",
        action: () => { setShowAdminPanel(true); onClose(); },
      });
    }

    return results;
  }, [channels, servers, friends, user, selectedServerId]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 20);
    const q = query.toLowerCase();
    return items
      .filter((item) =>
        item.label.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 30);
  }, [items, query]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, PaletteItem[]> = {};
    for (const item of filtered) {
      (groups[item.category] ??= []).push(item);
    }
    return groups;
  }, [filtered]);

  const flatItems = useMemo(() => filtered, [filtered]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-palette-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleSelect = useCallback((index: number) => {
    const item = flatItems[index];
    if (item) item.action();
  }, [flatItems]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(selectedIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const categoryLabels: Record<string, string> = {
    channels: t("commandPalette.categoryChannels"),
    dms: t("commandPalette.categoryDirectMessages"),
    servers: t("commandPalette.categoryServers"),
    actions: t("commandPalette.categoryActions"),
  };

  let globalIndex = 0;

  return (
    <div className="command-palette-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="command-palette" role="combobox" aria-expanded="true" aria-haspopup="listbox">
        <div className="command-palette-input-wrap">
          <svg className="command-palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            placeholder={t("commandPalette.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t("commandPalette.searchAriaLabel")}
            autoComplete="off"
          />
        </div>
        <div className="command-palette-results" ref={listRef} role="listbox">
          {flatItems.length === 0 && (
            <div className="command-palette-empty">{t("commandPalette.noResults")}</div>
          )}
          {Object.entries(grouped).map(([cat, catItems]) => (
            <div key={cat} className="command-palette-group">
              <div className="command-palette-group-label">{categoryLabels[cat] ?? cat}</div>
              {catItems.map((item) => {
                const idx = globalIndex++;
                return (
                  <div
                    key={item.id}
                    data-palette-index={idx}
                    className={`command-palette-item ${idx === selectedIndex ? "selected" : ""}`}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    onClick={() => handleSelect(idx)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="command-palette-item-label">{item.label}</span>
                    {item.description && (
                      <span className="command-palette-item-desc">{item.description}</span>
                    )}
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
