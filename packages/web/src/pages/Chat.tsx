import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { useUiStore } from "../store/ui.js";
import ServerBar from "../components/ServerBar.js";
import ChannelSidebar from "../components/ChannelSidebar.js";
import MemberSidebar from "../components/MemberSidebar.js";
import MessageList from "../components/MessageList.js";
import MessageInput from "../components/MessageInput.js";
import FriendsList from "../components/FriendsList.js";
import DmRequestBanner from "../components/DmRequestBanner.js";
const UserSettings = lazy(() => import("../components/UserSettings.js"));
import DmMemberSidebar from "../components/DmMemberSidebar.js";
import PinnedMessagesPanel from "../components/PinnedMessagesPanel.js";
import SearchPanel from "../components/SearchPanel.js";
import VoiceRoom from "../components/VoiceRoom.js";
import { parseChannelDisplay } from "../lib/channel-utils.js";
import SecurityPhraseSetup from "../components/SecurityPhraseSetup.js";
import SecurityPhraseRestore from "../components/SecurityPhraseRestore.js";
import ProfilePopup from "../components/ProfilePopup.js";

export default function Chat() {
  const user = useAuthStore((s) => s.user);
  const backupPending = useAuthStore((s) => s.backupPending);
  const backupAvailable = useAuthStore((s) => s.backupAvailable);
  const connect = useChatStore((s) => s.connect);
  const disconnect = useChatStore((s) => s.disconnect);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const wsState = useChatStore((s) => s.wsState);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const channels = useChatStore((s) => s.channels);
  const addFiles = useChatStore((s) => s.addFiles);

  const selectedServerId = useUiStore((s) => s.selectedServerId);
  const memberSidebarOpen = useUiStore((s) => s.memberSidebarOpen);
  const showUserSettings = useUiStore((s) => s.showUserSettings);
  const toggleMemberSidebar = useUiStore((s) => s.toggleMemberSidebar);
  const pinnedPanelOpen = useUiStore((s) => s.pinnedPanelOpen);
  const searchPanelOpen = useUiStore((s) => s.searchPanelOpen);
  const togglePinnedPanel = useUiStore((s) => s.togglePinnedPanel);
  const toggleSearchPanel = useUiStore((s) => s.toggleSearchPanel);
  const mentionPopup = useUiStore((s) => s.mentionPopup);
  const setMentionPopup = useUiStore((s) => s.setMentionPopup);

  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);

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
        const ui = useUiStore.getState();
        if (ui.showUserSettings) { ui.setShowUserSettings(false); return; }
        if (ui.searchPanelOpen) { ui.toggleSearchPanel(); return; }
        if (ui.pinnedPanelOpen) { ui.togglePinnedPanel(); return; }
      }

      if (isEditable) return;

      // Ctrl/Cmd+K — toggle search panel
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        useUiStore.getState().toggleSearchPanel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Start WS connection and HTTP data loading in parallel.
  // loadChannels() is pure HTTP — no reason to wait for WS handshake.
  useEffect(() => {
    connect();
    loadChannels();
    return () => disconnect();
  }, [connect, disconnect, loadChannels]);

  // Once WS connects, subscribe to any channels already loaded via HTTP
  useEffect(() => {
    if (wsState === "connected") {
      const { channels: chs, ws } = useChatStore.getState();
      if (ws) {
        for (const ch of chs) {
          ws.subscribe(ch.id);
        }
      }
    }
  }, [wsState]);

  const currentChannel = channels.find((c) => c.id === currentChannelId);
  const channelDisplay = currentChannel
    ? parseChannelDisplay(currentChannel.encrypted_meta, user?.id ?? "")
    : null;

  const isServerChannel = currentChannel && currentChannel.server_id !== null;
  const isVoiceChannel = currentChannel?.channel_type === "voice";
  const isDmOrGroupChannel = currentChannel && (currentChannel.channel_type === "dm" || currentChannel.channel_type === "group");
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
      ? `Message @${channelDisplay.name}`
      : channelDisplay.isGroup
        ? `Message ${channelDisplay.name}`
        : `Message #${channelDisplay.name}`
    : "Type a message...";

  return (
    <div className="chat-layout">
      <a href="#chat-body" className="skip-nav">Skip to chat</a>
      <ServerBar />
      <ChannelSidebar />

      <div className="chat-main" role="main">
        <header className="chat-header">
          <div className="chat-header-left">
            {showFriends && selectedServerId === null ? (
              <h2>Friends</h2>
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
              <h2>Select a channel</h2>
            )}
          </div>
          <div className="chat-header-right">
            {(isServerChannel || isDmOrGroupChannel) && !(showFriends && selectedServerId === null) && (
              <>
                <button
                  className={`chat-header-btn ${searchPanelOpen ? "active" : ""}`}
                  onClick={toggleSearchPanel}
                  title="Search Messages"
                  aria-label="Search Messages"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 001.48-5.34c-.47-2.78-2.79-5-5.59-5.34A6.505 6.505 0 003.03 10.5c0 3.59 2.91 6.5 6.5 6.5 1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 20l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                  </svg>
                </button>
                <button
                  className={`chat-header-btn ${pinnedPanelOpen ? "active" : ""}`}
                  onClick={togglePinnedPanel}
                  title="Pinned Messages"
                  aria-label="Pinned Messages"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                  </svg>
                </button>
                <button
                  className={`chat-header-btn ${memberSidebarOpen ? "active" : ""}`}
                  onClick={toggleMemberSidebar}
                  title="Member List"
                  aria-label="Member List"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M14 8.01c0 2.21-1.79 4-4 4s-4-1.79-4-4 1.79-4 4-4 4 1.79 4 4zm-4 6c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm9-3v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z" />
                  </svg>
                </button>
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
                <span>Drop files to upload</span>
              </div>
            </div>
          )}
          {showFriends && selectedServerId === null ? (
            <FriendsList />
          ) : currentChannelId && isVoiceChannel ? (
            <VoiceRoom channelId={currentChannelId} channelName={channelDisplay?.name ?? "Voice"} serverId={selectedServerId!} />
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
                      ? `${typingNames[0]} is typing...`
                      : typingNames.length === 2
                        ? `${typingNames[0]} and ${typingNames[1]} are typing...`
                        : `${typingNames[0]} and ${typingNames.length - 1} others are typing...`}
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
              <p>Select a channel from the sidebar to start chatting.</p>
            </div>
          )}
        </div>
      </div>

      {memberSidebarOpen && isServerChannel && currentChannel && selectedServerId !== null && (
        <MemberSidebar serverId={currentChannel.server_id!} />
      )}

      {memberSidebarOpen && isDmOrGroupChannel && currentChannel && !(showFriends && selectedServerId === null) && (
        <DmMemberSidebar channelId={currentChannel.id} channelType={currentChannel.channel_type} />
      )}

      {pinnedPanelOpen && currentChannelId && <PinnedMessagesPanel channelId={currentChannelId} />}
      {searchPanelOpen && <SearchPanel />}

      {showUserSettings && <Suspense fallback={null}><UserSettings /></Suspense>}

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
    </div>
  );
}
