import { useState, useRef, useEffect } from "react";
import { useFriendsStore } from "../store/friends.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

interface Props {
  onClose: () => void;
}

export default function AddFriendModal({ onClose }: Props) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSend() {
    if (!username.trim()) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await useFriendsStore.getState().sendRequest(username.trim());
      setSuccess(`Friend request sent to ${username.trim()}!`);
      setUsername("");
    } catch (err: any) {
      setError(err.message || "Failed to send friend request");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-friend-title">
        <h3 className="modal-title" id="add-friend-title">Add Friend</h3>
        <p className="modal-subtitle">
          Enter a username to send a friend request.
        </p>

        <div className="add-friend-input-row">
          <input
            ref={inputRef}
            type="text"
            className="add-friend-input"
            placeholder="Enter a username..."
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(""); setSuccess(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
        </div>

        {error && <div className="error-small">{error}</div>}
        {success && <div className="success-small">{success}</div>}

        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary modal-submit"
            onClick={handleSend}
            disabled={loading || !username.trim()}
          >
            {loading ? "Sending..." : "Send Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
