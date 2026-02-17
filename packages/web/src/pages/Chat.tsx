import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { useUiStore } from "../store/ui.js";
import { usePresenceStore } from "../store/presence.js";
import ServerBar from "../components/ServerBar.js";
import ChannelSidebar from "../components/ChannelSidebar.js";
import MemberSidebar from "../components/MemberSidebar.js";
import MessageList from "../components/MessageList.js";
import MessageInput from "../components/MessageInput.js";
import FriendsList from "../components/FriendsList.js";
import DmRequestBanner from "../components/DmRequestBanner.js";
const UserSettings = lazy(() => import("../components/UserSettings.js"));
const AdminPanel = lazy(() => import("../components/AdminPanel.js"));
const CommandPalette = lazy(() => import("../components/CommandPalette.js"));
const KeyboardShortcutsModal = lazy(() => import("../components/KeyboardShortcutsModal.js"));
import DmMemberSidebar from "../components/DmMemberSidebar.js";
import PinnedMessagesPanel from "../components/PinnedMessagesPanel.js";
const SearchPanel = lazy(() => import("../components/SearchPanel.js"));
const VoiceRoom = lazy(() => import("../components/VoiceRoom.js"));
import { parseChannelDisplay } from "../lib/channel-utils.js";
import SecurityPhraseSetup from "../components/SecurityPhraseSetup.js";
import SecurityPhraseRestore from "../components/SecurityPhraseRestore.js";
import ProfilePopup from "../components/ProfilePopup.js";

export default function Chat() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const backupPending = useAuthStore((s) => s.backupPending);
  const backupAvailable = useAuthStore((s) => s.backupAvailable);
  const connect = useChatStore((s) => s.connect);
  const disconnect = useChatStore((s) => s.disconnect);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const dataLoaded = useChatStore((s) => s.dataLoaded);
  const wsState = useChatStore((s) => s.wsState);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const channels = useChatStore((s) => s.channels);
  const addFiles = useChatStore((s) => s.addFiles);

  const selectedServerId = useUiStore((s) => s.selectedServerId);
  const memberSidebarOpen = useUiStore((s) => s.memberSidebarOpen);
  const showUserSettings = useUiStore((s) => s.showUserSettings);
  const showAdminPanel = useUiStore((s) => s.showAdminPanel);
  const setShowAdminPanel = useUiStore((s) => s.setShowAdminPanel);
  const toggleMemberSidebar = useUiStore((s) => s.toggleMemberSidebar);
  const pinnedPanelOpen = useUiStore((s) => s.pinnedPanelOpen);
  const searchPanelOpen = useUiStore((s) => s.searchPanelOpen);
  const togglePinnedPanel = useUiStore((s) => s.togglePinnedPanel);
  const toggleSearchPanel = useUiStore((s) => s.toggleSearchPanel);
  const mentionPopup = useUiStore((s) => s.mentionPopup);
  const setMentionPopup = useUiStore((s) => s.setMentionPopup);
  const mobileSidebarOpen = useUiStore((s) => s.mobileSidebarOpen);
  const toggleMobileSidebar = useUiStore((s) => s.toggleMobileSidebar);
  const setMobileSidebarOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const channelSidebarWidth = useUiStore((s) => s.channelSidebarWidth);
  const memberSidebarWidth = useUiStore((s) => s.memberSidebarWidth);
  const serverBarWidth = useUiStore((s) => s.serverBarWidth);
  const setChannelSidebarWidth = useUiStore((s) => s.setChannelSidebarWidth);
  const setMemberSidebarWidth = useUiStore((s) => s.setMemberSidebarWidth);
  const setServerBarWidth = useUiStore((s) => s.setServerBarWidth);

  // ─── Sidebar width sync ────────────────────────────
  useEffect(() => {
    document.documentElement.style.setProperty("--channel-sidebar-width", `${channelSidebarWidth}px`);
    document.documentElement.style.setProperty("--member-sidebar-width", `${memberSidebarWidth}px`);
    document.documentElement.style.setProperty("--server-bar-width", `${serverBarWidth}px`);
  }, [channelSidebarWidth, memberSidebarWidth, serverBarWidth]);

  function handleResizeStart(
    e: React.MouseEvent,
    cssVar: string,
    currentWidth: number,
    min: number,
    max: number,
    setter: (w: number) => void,
    direction: 1 | -1 = 1,
  ) {
    e.preventDefault();
    const startX = e.clientX;
    let width = currentWidth;
    const handleMove = (ev: MouseEvent) => {
      width = Math.min(max, Math.max(min, currentWidth + direction * (ev.clientX - startX)));
      document.documentElement.style.setProperty(cssVar, `${width}px`);
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setter(width);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }

  function handleResizeKeyDown(
    e: React.KeyboardEvent,
    cssVar: string,
    currentWidth: number,
    min: number,
    max: number,
    setter: (w: number) => void,
    direction: 1 | -1 = 1,
  ) {
    const step = 10;
    let delta = 0;
    if (e.key === "ArrowRight") delta = step * direction;
    else if (e.key === "ArrowLeft") delta = -step * direction;
    else return;
    e.preventDefault();
    const newWidth = Math.min(max, Math.max(min, currentWidth + delta));
    document.documentElement.style.setProperty(cssVar, `${newWidth}px`);
    setter(newWidth);
  }

  // ─── Mobile detection ──────────────────────────────
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Auto-close mobile sidebar when a channel is selected
  useEffect(() => {
    if (isMobile && currentChannelId) setMobileSidebarOpen(false);
  }, [currentChannelId, isMobile]);

  // ─── Invite acceptance via /invite/:code URL ───────
  const location = useLocation();
  const navigate = useNavigate();
  const inviteMatch = location.pathname.match(/^\/invite\/([A-Za-z0-9]+)$/);
  const inviteCode = inviteMatch ? inviteMatch[1] : null;
  const [inviteJoining, setInviteJoining] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  async function handleAcceptInvite() {
    if (!inviteCode || inviteJoining) return;
    setInviteJoining(true);
    setInviteError("");
    try {
      const api = useAuthStore.getState().api;
      const server = await api.joinByInvite(inviteCode);
      setInviteSuccess(t("chat.joinedSuccess"));
      // Reload channels to include the new server
      await useChatStore.getState().loadChannels();
      // Navigate to main view after a brief delay
      setTimeout(() => {
        useUiStore.getState().selectServer(server.id);
        navigate("/", { replace: true });
      }, 800);
    } catch (err: any) {
      setInviteError(err.message || t("chat.joinFailed"));
      setInviteJoining(false);
    }
  }

  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      addFiles(files);
    }
  }, [addFiles]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in inputs/textareas/contenteditable
      const tag = (e.target as HTMLElement).tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;

      // Escape — close open panels/modals (works even in inputs)
      if (e.key === "Escape") {
        if (showCommandPalette) { setShowCommandPalette(false); return; }
        const ui = useUiStore.getState();
        if (ui.showUserSettings) { ui.setShowUserSettings(false); return; }
        if (ui.searchPanelOpen) { ui.toggleSearchPanel(); return; }
        if (ui.pinnedPanelOpen) { ui.togglePinnedPanel(); return; }
      }

      // Alt+Up/Down — navigate to prev/next unread channel (works even in editable)
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        useChatStore.getState().navigateUnread(e.key === "ArrowUp" ? "up" : "down");
        return;
      }

      if (isEditable) return;

      // Ctrl/Cmd+K — toggle command palette
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      }

      // ? — keyboard shortcuts help
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowKeyboardHelp((v) => !v);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showCommandPalette]);

  // Always clear drag overlay on any drop event. Uses capture phase so it fires
  // even when child elements call stopPropagation() (e.g. TipTap editor's handleDrop).
  useEffect(() => {
    const clearDrag = () => {
      dragCounterRef.current = 0;
      setDragOver(false);
    };
    window.addEventListener("drop", clearDrag, true);
    return () => window.removeEventListener("drop", clearDrag, true);
  }, []);

  // Start WS connection and HTTP data loading in parallel.
  // loadChannels() is pure HTTP — no reason to wait for WS handshake.
  // Note: loadChannels() has an internal guard to prevent concurrent calls.
  useEffect(() => {
    connect();
    loadChannels();
    return () => disconnect();
  }, [connect, disconnect, loadChannels]);

  // Once WS connects, subscribe to any channels already loaded via HTTP
  // and re-fetch presence (server broadcasts "online" on connect, so
  // presence fetched before WS connect may be stale)
  useEffect(() => {
    if (wsState === "connected") {
      const { channels: chs, ws } = useChatStore.getState();
      if (ws) {
        for (const ch of chs) {
          ws.subscribe(ch.id);
        }
      }
      // Broadcast own status and re-fetch member presence after short delay
      // to let the server process the online broadcast first
      const ps = usePresenceStore.getState();
      ps.setOwnStatus(ps.ownStatus);
      const timer = setTimeout(() => {
        const knownIds = Object.keys(ps.statuses);
        if (user?.id && !knownIds.includes(user.id)) knownIds.push(user.id);
        if (knownIds.length > 0) {
          ps.fetchPresence(knownIds);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [wsState, user?.id]);

  const currentChannel = channels.find((c) => c.id === currentChannelId);
  const channelDisplay = currentChannel
    ? parseChannelDisplay(currentChannel.encrypted_meta, user?.id ?? "")
    : null;

  const isServerChannel = currentChannel && currentChannel.server_id !== null;
  const isVoiceChannel = currentChannel?.channel_type === "voice";
  const isDmOrGroupChannel = currentChannel && (currentChannel.channel_type === "dm" || currentChannel.channel_type === "group");
  const is1on1Dm = currentChannel?.channel_type === "dm";
  const isGroupDm = currentChannel?.channel_type === "group";
  const isDmPending = currentChannel?.dm_status === "pending";
  const showFriends = useUiStore((s) => s.showFriends);

  const typingUsers = useChatStore((s) => s.typingUsers);
  const typingNames = useMemo(() => {
    if (!currentChannelId) return [];
    const entries = (typingUsers[currentChannelId] ?? []).filter(
      (t) => t.expiry > Date.now(),
    );
    return entries.map((t) => t.username);
  }, [currentChannelId, typingUsers]);

  const inputPlaceholder = channelDisplay
    ? channelDisplay.isDm
      ? t("chat.messageDm", { name: channelDisplay.name })
      : channelDisplay.isGroup
        ? t("chat.messageGroup", { name: channelDisplay.name })
        : t("chat.messageChannel", { name: channelDisplay.name })
    : t("chat.typeMessage");

  // Show splash screen between login and app while data loads
  if (!dataLoaded) {
    return (
      <div className="splash-screen">
        <div className="splash-logo">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L19.27 7.5 12 10.82 4.73 7.5 12 4.18zM4 8.83l7 3.5V19.5l-7-3.5V8.83zm9 10.67V12.33l7-3.5V15.5l-7 3.5z"/>
          </svg>
        </div>
        <div className="splash-title">{t("chat.splashTitle")}</div>
        <div className="splash-dots">
          <span /><span /><span />
        </div>
      </div>
    );
  }

  return (
    <div className={`chat-layout${isMobile ? " mobile" : ""}`}>
      <div className="titlebar-drag-region" data-tauri-drag-region />
      <a href="#chat-body" className="skip-nav">{t("chat.skipNav")}</a>

      {/* Mobile sidebar overlay */}
      {isMobile && mobileSidebarOpen && (
        <div className="mobile-sidebar-overlay" onClick={() => setMobileSidebarOpen(false)} />
      )}
      <div className={`chat-sidebar-group${isMobile && mobileSidebarOpen ? " open" : ""}`}>
        <ServerBar />
        {!isMobile && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label={t("chat.resizeServerBar")} tabIndex={0} onMouseDown={(e) => handleResizeStart(e, "--server-bar-width", serverBarWidth, 56, 96, setServerBarWidth)} onKeyDown={(e) => handleResizeKeyDown(e, "--server-bar-width", serverBarWidth, 56, 96, setServerBarWidth)} />}
        <ChannelSidebar />
        {!isMobile && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label={t("chat.resizeChannelSidebar")} tabIndex={0} onMouseDown={(e) => handleResizeStart(e, "--channel-sidebar-width", channelSidebarWidth, 180, 380, setChannelSidebarWidth)} onKeyDown={(e) => handleResizeKeyDown(e, "--channel-sidebar-width", channelSidebarWidth, 180, 380, setChannelSidebarWidth)} />}
      </div>

      <div className="chat-main" role="main">
        {wsState === "disconnected" && dataLoaded && (
          <div className="ws-reconnect-banner" role="alert">
            <div className="ws-reconnect-spinner" />
            {t("chat.reconnecting")}
          </div>
        )}
        <header className="chat-header">
          <div className="chat-header-left">
            {isMobile && (
              <button className="mobile-hamburger" onClick={toggleMobileSidebar} aria-label={t("chat.toggleSidebar")} aria-expanded={mobileSidebarOpen}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
                </svg>
              </button>
            )}
            {showFriends && selectedServerId === null ? (
              <h2>{t("chat.friends")}</h2>
            ) : channelDisplay ? (
              <>
                <span className="chat-header-icon">
                  {channelDisplay.isDm ? "@" : channelDisplay.isGroup ? "@" : isVoiceChannel ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ verticalAlign: "middle" }}>
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                    </svg>
                  ) : "#"}
                </span>
                <h2>{channelDisplay.name}</h2>
                {channelDisplay.topic && (
                  <span className="chat-header-topic">{channelDisplay.topic}</span>
                )}
              </>
            ) : (
              <h2>{t("chat.selectChannel")}</h2>
            )}
          </div>
          <div className="chat-header-right">
            {(isServerChannel || isDmOrGroupChannel) && !(showFriends && selectedServerId === null) && (
              <>
                <button
                  className={`chat-header-btn ${searchPanelOpen ? "active" : ""}`}
                  onClick={toggleSearchPanel}
                  title={t("chat.searchMessages")}
                  aria-label={t("chat.searchMessages")}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 001.48-5.34c-.47-2.78-2.79-5-5.59-5.34A6.505 6.505 0 003.03 10.5c0 3.59 2.91 6.5 6.5 6.5 1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 20l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                  </svg>
                </button>
                <button
                  className={`chat-header-btn ${pinnedPanelOpen ? "active" : ""}`}
                  onClick={togglePinnedPanel}
                  title={t("chat.pinnedMessages")}
                  aria-label={t("chat.pinnedMessages")}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                  </svg>
                </button>
                {!is1on1Dm && (
                  <button
                    className={`chat-header-btn ${memberSidebarOpen ? "active" : ""}`}
                    onClick={toggleMemberSidebar}
                    title={t("chat.memberList")}
                    aria-label={t("chat.memberList")}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M14 8.01c0 2.21-1.79 4-4 4s-4-1.79-4-4 1.79-4 4-4 4 1.79 4 4zm-4 6c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm9-3v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z" />
                    </svg>
                  </button>
                )}
              </>
            )}
            <span className={`ws-badge ws-${wsState}`} />
          </div>
        </header>

        <div
          id="chat-body"
          className="chat-body"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {dragOver && currentChannelId && (
            <div className="drop-overlay">
              <div className="drop-overlay-content">
                <span className="drop-overlay-icon">+</span>
                <span>{t("chat.dropFilesToUpload")}</span>
              </div>
            </div>
          )}
          {showFriends && selectedServerId === null ? (
            <FriendsList />
          ) : currentChannelId && isVoiceChannel ? (
            <Suspense fallback={null}><VoiceRoom channelId={currentChannelId} channelName={channelDisplay?.name ?? t("chat.voiceDefaultName")} serverId={selectedServerId!} /></Suspense>
          ) : currentChannelId ? (
            <>
              <MessageList />
              {typingNames.length > 0 && (
                <div className="typing-indicator" aria-live="polite">
                  <span className="typing-dots">
                    <span /><span /><span />
                  </span>
                  <span className="typing-text">
                    {typingNames.length === 1
                      ? t("chat.typingOne", { name: typingNames[0] })
                      : typingNames.length === 2
                        ? t("chat.typingTwo", { name1: typingNames[0], name2: typingNames[1] })
                        : t("chat.typingMany", { name: typingNames[0], count: typingNames.length - 1 })}
                  </span>
                </div>
              )}
              {isDmPending ? (
                <DmRequestBanner channelId={currentChannelId} />
              ) : (
                <MessageInput placeholder={inputPlaceholder} />
              )}
            </>
          ) : (
            <div className="no-channel">
              <p>{t("chat.noChannelMessage")}</p>
            </div>
          )}
        </div>
      </div>

      {memberSidebarOpen && isServerChannel && currentChannel && selectedServerId !== null && (
        <>
          {!isMobile && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label={t("chat.resizeMemberSidebar")} tabIndex={0} onMouseDown={(e) => handleResizeStart(e, "--member-sidebar-width", memberSidebarWidth, 180, 380, setMemberSidebarWidth, -1)} onKeyDown={(e) => handleResizeKeyDown(e, "--member-sidebar-width", memberSidebarWidth, 180, 380, setMemberSidebarWidth, -1)} />}
          <MemberSidebar serverId={currentChannel.server_id!} />
        </>
      )}

      {/* 1-on-1 DM: always show profile card sidebar */}
      {is1on1Dm && currentChannel && !(showFriends && selectedServerId === null) && (
        <>
          {!isMobile && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label={t("chat.resizeMemberSidebar")} tabIndex={0} onMouseDown={(e) => handleResizeStart(e, "--member-sidebar-width", memberSidebarWidth, 180, 380, setMemberSidebarWidth, -1)} onKeyDown={(e) => handleResizeKeyDown(e, "--member-sidebar-width", memberSidebarWidth, 180, 380, setMemberSidebarWidth, -1)} />}
          <DmMemberSidebar channelId={currentChannel.id} channelType={currentChannel.channel_type} />
        </>
      )}

      {/* Group DM: toggle member list with button */}
      {memberSidebarOpen && isGroupDm && currentChannel && !(showFriends && selectedServerId === null) && (
        <>
          {!isMobile && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label={t("chat.resizeMemberSidebar")} tabIndex={0} onMouseDown={(e) => handleResizeStart(e, "--member-sidebar-width", memberSidebarWidth, 180, 380, setMemberSidebarWidth, -1)} onKeyDown={(e) => handleResizeKeyDown(e, "--member-sidebar-width", memberSidebarWidth, 180, 380, setMemberSidebarWidth, -1)} />}
          <DmMemberSidebar channelId={currentChannel.id} channelType={currentChannel.channel_type} />
        </>
      )}

      {pinnedPanelOpen && currentChannelId && <PinnedMessagesPanel channelId={currentChannelId} />}
      {searchPanelOpen && <Suspense fallback={null}><SearchPanel /></Suspense>}

      {showUserSettings && <Suspense fallback={null}><UserSettings /></Suspense>}
      {showAdminPanel && <Suspense fallback={null}><AdminPanel onClose={() => setShowAdminPanel(false)} /></Suspense>}
      {showCommandPalette && <Suspense fallback={null}><CommandPalette onClose={() => setShowCommandPalette(false)} /></Suspense>}
      {showKeyboardHelp && <Suspense fallback={null}><KeyboardShortcutsModal onClose={() => setShowKeyboardHelp(false)} /></Suspense>}

      {backupPending && backupAvailable && <SecurityPhraseRestore />}
      {backupPending && !backupAvailable && <SecurityPhraseSetup />}

      {mentionPopup && (
        <ProfilePopup
          userId={mentionPopup.userId}
          serverId={selectedServerId ?? undefined}
          position={mentionPopup.position}
          onClose={() => setMentionPopup(null)}
        />
      )}

      {inviteCode && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-dialog-header">
              <h3 className="modal-title">{t("chat.serverInviteTitle")}</h3>
              <button className="modal-close-btn" onClick={() => navigate("/", { replace: true })} aria-label={t("chat.serverInviteClose")}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" /></svg>
              </button>
            </div>
            <p style={{ color: "var(--text-secondary)", margin: "8px 0 16px" }}>
              {t("chat.serverInviteMessage")}
            </p>
            {inviteError && (
              <p style={{ color: "var(--red)", fontSize: "0.875rem", margin: "0 0 8px" }}>{inviteError}</p>
            )}
            {inviteSuccess && (
              <p style={{ color: "var(--green)", fontSize: "0.875rem", margin: "0 0 8px" }}>{inviteSuccess}</p>
            )}
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => navigate("/", { replace: true })}>
                {t("chat.serverInviteCancel")}
              </button>
              <button
                className="btn-primary"
                onClick={handleAcceptInvite}
                disabled={inviteJoining || !!inviteSuccess}
              >
                {inviteJoining ? t("chat.serverInviteJoining") : inviteSuccess ? t("chat.serverInviteJoined") : t("chat.serverInviteAccept")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
