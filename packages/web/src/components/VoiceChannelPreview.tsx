import { useEffect } from "react";
import { useVoiceStore } from "../store/voice.js";
import Avatar from "./Avatar.js";

interface VoiceChannelPreviewProps {
  channelId: string;
}

export default function VoiceChannelPreview({ channelId }: VoiceChannelPreviewProps) {
  const participants = useVoiceStore((s) => s.participants[channelId]) ?? [];
  const loadParticipants = useVoiceStore((s) => s.loadParticipants);

  // Load participants on mount
  useEffect(() => {
    loadParticipants(channelId);
  }, [channelId, loadParticipants]);

  if (participants.length === 0) return null;

  return (
    <ul className="voice-participants-preview">
      {participants.map((p) => (
        <li key={p.user_id} className="voice-preview-item">
          <Avatar
            avatarUrl={p.avatar_url}
            name={p.display_name || p.username}
            size={20}
          />
          <span className="voice-preview-name">{p.display_name || p.username}</span>
        </li>
      ))}
    </ul>
  );
}
