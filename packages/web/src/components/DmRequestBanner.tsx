import { useFriendsStore } from "../store/friends.js";
import { useChatStore } from "../store/chat.js";

export default function DmRequestBanner({ channelId }: { channelId: string }) {
  const acceptDmRequest = useFriendsStore((s) => s.acceptDmRequest);
  const declineDmRequest = useFriendsStore((s) => s.declineDmRequest);
  const loadChannels = useChatStore((s) => s.loadChannels);

  async function handleAccept() {
    await acceptDmRequest(channelId);
    await loadChannels();
  }

  async function handleDecline() {
    await declineDmRequest(channelId);
    await loadChannels();
  }

  return (
    <div className="dm-request-banner">
      <div className="dm-request-banner-text">
        This user wants to message you. Accept to start a conversation.
      </div>
      <div className="dm-request-banner-actions">
        <button className="btn-primary" onClick={handleAccept}>Accept</button>
        <button className="btn-danger" onClick={handleDecline}>Decline</button>
      </div>
    </div>
  );
}
