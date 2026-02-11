import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
import { parseChannelDisplay } from "../lib/channel-utils.js";

export default function Chat() {
  const user = useAuthStore((s) => s.user);
  const connect = useChatStore((s) => s.connect);
  const disconnect = useChatStore((s) => s.disconnect);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const wsState = useChatStore((s) => s.wsState);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const channels = useChatStore((s) => s.channels);
  const addFiles = useChatStore((s) => s.addFiles);

  const memberSidebarOpen = useUiStore((s) => s.memberSidebarOpen);
  const toggleMemberSidebar = useUiStore((s) => s.toggleMemberSidebar);

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

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  useEffect(() => {
    if (wsState === "connected") {
      loadChannels();
    }
  }, [wsState, loadChannels]);

  const currentChannel = channels.find((c) => c.id === currentChannelId);
  const channelDisplay = currentChannel
    ? parseChannelDisplay(currentChannel.encrypted_meta, user?.id ?? "")
    : null;

  const isServerChannel = currentChannel && currentChannel.server_id !== null;
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
      : `Message #${channelDisplay.name}`
    : "Type a message...";

  return (
    <div className="chat-layout">
      <ServerBar />
      <ChannelSidebar />

      <div className="chat-main">
        <header className="chat-header">
          <div className="chat-header-left">
            {channelDisplay ? (
              <>
                <span className="chat-header-icon">{channelDisplay.isDm ? "@" : "#"}</span>
                <h2>{channelDisplay.name}</h2>
              </>
            ) : (
              <h2>Select a channel</h2>
            )}
          </div>
          <div className="chat-header-right">
            {isServerChannel && (
              <button
                className={`chat-header-btn ${memberSidebarOpen ? "active" : ""}`}
                onClick={toggleMemberSidebar}
                title="Member List"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 8.01c0 2.21-1.79 4-4 4s-4-1.79-4-4 1.79-4 4-4 4 1.79 4 4zm-4 6c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm9-3v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z" />
                </svg>
              </button>
            )}
            <span className={`ws-badge ws-${wsState}`} />
          </div>
        </header>

        <div
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
          {showFriends && !isServerChannel ? (
            <FriendsList />
          ) : currentChannelId ? (
            <>
              <MessageList />
              {typingNames.length > 0 && (
                <div className="typing-indicator">
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

      {memberSidebarOpen && isServerChannel && currentChannel && (
        <MemberSidebar serverId={currentChannel.server_id!} />
      )}
    </div>
  );
}
