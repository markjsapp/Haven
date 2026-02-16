import { useEffect, useState } from "react";
import { useVoiceStore } from "../store/voice.js";
import Avatar from "./Avatar.js";
import VoiceContextMenu from "./VoiceContextMenu.js";

interface VoiceChannelPreviewProps {
  channelId: string;
  serverId: string;
}

export default function VoiceChannelPreview({ channelId, serverId }: VoiceChannelPreviewProps) {
  const participants = useVoiceStore((s) => s.participants[channelId]) ?? [];
  const loadParticipants = useVoiceStore((s) => s.loadParticipants);

  const [contextMenu, setContextMenu] = useState<{
    userId: string;
    serverMuted: boolean;
    serverDeafened: boolean;
    position: { x: number; y: number };
  } | null>(null);

  // Load participants on mount
  useEffect(() => {
    loadParticipants(channelId);
  }, [channelId, loadParticipants]);

  if (participants.length === 0) return null;

  function handleContextMenu(
    e: React.MouseEvent,
    userId: string,
    serverMuted: boolean,
    serverDeafened: boolean,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      userId,
      serverMuted,
      serverDeafened,
      position: { x: e.clientX, y: e.clientY },
    });
  }

  return (
    <>
      <ul className="voice-participants-preview">
        {participants.map((p) => (
          <li
            key={p.user_id}
            className="voice-preview-item"
            onContextMenu={(e) => handleContextMenu(e, p.user_id, p.server_muted, p.server_deafened)}
          >
            <Avatar
              avatarUrl={p.avatar_url}
              name={p.display_name || p.username}
              size={20}
            />
            <span className="voice-preview-name">{p.display_name || p.username}</span>
          </li>
        ))}
      </ul>
      {contextMenu && (
        <VoiceContextMenu
          userId={contextMenu.userId}
          channelId={channelId}
          serverId={serverId}
          serverMuted={contextMenu.serverMuted}
          serverDeafened={contextMenu.serverDeafened}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
