import { useEffect } from "react";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import Sidebar from "../components/Sidebar.js";
import MessageList from "../components/MessageList.js";
import MessageInput from "../components/MessageInput.js";

function parseChannelDisplay(encryptedMeta: string, myUserId: string): { name: string; isDm: boolean } {
  try {
    const json = JSON.parse(atob(encryptedMeta));
    if (json.type === "dm") {
      // Show the other participant's name
      if (json.names) {
        for (const [id, name] of Object.entries(json.names)) {
          if (id !== myUserId) return { name: name as string, isDm: true };
        }
      }
      return { name: "DM", isDm: true };
    }
    return { name: json.name || "unnamed", isDm: false };
  } catch {
    return { name: "unnamed", isDm: false };
  }
}

export default function Chat() {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const connect = useChatStore((s) => s.connect);
  const disconnect = useChatStore((s) => s.disconnect);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const wsState = useChatStore((s) => s.wsState);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const channels = useChatStore((s) => s.channels);

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

  return (
    <div className="chat-layout">
      <Sidebar />

      <div className="chat-main">
        <header className="chat-header">
          <div className="chat-header-left">
            {channelDisplay ? (
              <h2>{channelDisplay.isDm ? `@ ${channelDisplay.name}` : `# ${channelDisplay.name}`}</h2>
            ) : (
              <h2>Select a channel</h2>
            )}
          </div>
          <div className="chat-header-right">
            <span className={`ws-status ws-${wsState}`}>{wsState}</span>
            <span className="user-display">{user?.username}</span>
            <button className="btn-ghost" onClick={logout}>
              Sign Out
            </button>
          </div>
        </header>

        <div className="chat-body">
          {currentChannelId ? (
            <>
              <MessageList />
              <MessageInput />
            </>
          ) : (
            <div className="no-channel">
              <p>Select a channel from the sidebar to start chatting.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
