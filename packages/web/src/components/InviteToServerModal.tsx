import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getServerUrl } from "../lib/serverUrl";
import { useAuthStore } from "../store/auth.js";
import { useChatStore } from "../store/chat.js";
import { useFriendsStore } from "../store/friends.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { parseServerName } from "../lib/channel-utils.js";
import Avatar from "./Avatar.js";
import type { ServerResponse } from "@haven/core";

interface Props {
  /** Pre-select a specific server (skip picker). */
  serverId?: string;
  /** If provided, pre-filters but still shows friends list. */
  targetUsername?: string;
  onClose: () => void;
}

export default function InviteToServerModal({ serverId: preSelectedServerId, targetUsername, onClose }: Props) {
  const api = useAuthStore((s) => s.api);
  const servers = useChatStore((s) => s.servers);
  const getOrCreateDmChannel = useChatStore((s) => s.getOrCreateDmChannel);
  const sendMessageToChannel = useChatStore((s) => s.sendMessageToChannel);
  const friends = useFriendsStore((s) => s.friends);
  const loadFriends = useFriendsStore((s) => s.loadFriends);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);

  const [selectedServerId, setSelectedServerId] = useState<string | null>(preSelectedServerId ?? null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Set<string>>(new Set());
  const inviteFetchRef = useRef(false);
  const [expiresInHours, setExpiresInHours] = useState<number | undefined>(24);
  const [maxUses, setMaxUses] = useState<number | undefined>(undefined);

  // Load friends if needed
  useEffect(() => {
    if (friends.length === 0) loadFriends();
  }, []);

  // Create invite when server is selected or options change
  useEffect(() => {
    if (!selectedServerId) return;
    // Prevent StrictMode double-invoke from firing two API calls
    if (inviteFetchRef.current) return;
    inviteFetchRef.current = true;
    setLoading(true);
    setError("");
    setInviteCode(null);
    api.createInvite(selectedServerId, { expires_in_hours: expiresInHours, max_uses: maxUses }).then((invite) => {
      setInviteCode(invite.code);
    }).catch((err) => {
      setError(err.message || "Failed to create invite");
    }).finally(() => {
      setLoading(false);
      inviteFetchRef.current = false;
    });
  }, [api, selectedServerId, expiresInHours, maxUses]);

  const inviteUrl = inviteCode ? `${getServerUrl()}/invite/${inviteCode}` : "";
  const selectedServer = servers.find((s) => s.id === selectedServerId);
  const selectedServerName = selectedServer ? parseServerName(selectedServer.encrypted_meta) : "Server";

  const acceptedFriends = friends.filter((f) => f.status === "accepted");
  const filteredFriends = acceptedFriends.filter((f) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      f.username.toLowerCase().includes(q) ||
      (f.display_name?.toLowerCase().includes(q) ?? false)
    );
  });

  async function handleCopy() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  }

  async function handleInviteFriend(username: string) {
    if (!inviteCode || sending.has(username) || sentTo.has(username)) return;
    setSending((prev) => new Set(prev).add(username));
    try {
      // Get/create the DM channel WITHOUT navigating away from current view
      const dmChannel = await getOrCreateDmChannel(username);

      // Send as a structured invite message with content_type so both sides
      // render it as an invite card instead of raw text
      await sendMessageToChannel(dmChannel.id, inviteUrl, {
        contentType: "server_invite",
        data: {
          invite_code: inviteCode,
          server_name: selectedServerName,
          server_id: selectedServerId,
          server_icon_url: selectedServer?.icon_url ?? null,
        },
      });

      setSentTo((prev) => new Set(prev).add(username));
    } catch (err) {
      console.error("Failed to send invite DM:", err);
    } finally {
      setSending((prev) => {
        const next = new Set(prev);
        next.delete(username);
        return next;
      });
    }
  }

  function handleSelectServer(server: ServerResponse) {
    setSelectedServerId(server.id);
    setInviteCode(null);
    setError("");
  }

  return createPortal(
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog invite-modal" ref={ref} role="dialog" aria-label="Invite to Server">
        {/* Server picker phase */}
        {!selectedServerId && (
          <>
            <div className="modal-dialog-header">
              <h3 className="invite-modal-title">
                Invite {targetUsername ? <strong>{targetUsername}</strong> : "to Server"}
              </h3>
              <button className="modal-close-btn" onClick={onClose} aria-label="Close">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" /></svg>
              </button>
            </div>
            <p className="invite-modal-desc">Select a server:</p>
            <div className="invite-server-list">
              {servers.map((server) => (
                <button
                  key={server.id}
                  className="invite-server-item"
                  onClick={() => handleSelectServer(server)}
                >
                  <div className="invite-server-icon">
                    {server.icon_url ? (
                      <img src={server.icon_url} alt="" />
                    ) : (
                      <span>{parseServerName(server.encrypted_meta).charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span className="invite-server-name">{parseServerName(server.encrypted_meta)}</span>
                </button>
              ))}
              {servers.length === 0 && (
                <p className="invite-modal-desc">You haven't joined any servers yet.</p>
              )}
            </div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {/* Invite phase — friends list + invite link */}
        {selectedServerId && (
          <>
            <div className="modal-dialog-header">
              <h3 className="invite-modal-title">
                Invite friends to {selectedServerName}
              </h3>
              <button className="modal-close-btn" onClick={onClose} aria-label="Close">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" /></svg>
              </button>
            </div>
            <p className="invite-modal-subtitle">Recipients will land in #general</p>

            {loading && <p className="invite-modal-desc">Creating invite link...</p>}
            {error && <p className="invite-modal-desc" style={{ color: "var(--red)" }}>{error}</p>}

            {/* Invite options */}
            <div className="invite-options-row">
              <label className="invite-option">
                <span className="invite-option-label">Expire after</span>
                <select
                  className="invite-option-select"
                  value={expiresInHours === undefined ? "" : String(expiresInHours)}
                  onChange={(e) => setExpiresInHours(e.target.value ? Number(e.target.value) : undefined)}
                >
                  <option value="0.5">30 minutes</option>
                  <option value="1">1 hour</option>
                  <option value="6">6 hours</option>
                  <option value="12">12 hours</option>
                  <option value="24">1 day</option>
                  <option value="168">7 days</option>
                  <option value="">Never</option>
                </select>
              </label>
              <label className="invite-option">
                <span className="invite-option-label">Max uses</span>
                <select
                  className="invite-option-select"
                  value={maxUses === undefined ? "" : String(maxUses)}
                  onChange={(e) => setMaxUses(e.target.value ? Number(e.target.value) : undefined)}
                >
                  <option value="">No limit</option>
                  <option value="1">1 use</option>
                  <option value="5">5 uses</option>
                  <option value="10">10 uses</option>
                  <option value="25">25 uses</option>
                  <option value="50">50 uses</option>
                  <option value="100">100 uses</option>
                </select>
              </label>
            </div>

            {inviteCode && (
              <>
                {/* Search */}
                <div className="invite-search-wrap">
                  <svg className="invite-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                  </svg>
                  <input
                    className="invite-search-input"
                    type="text"
                    placeholder="Search for friends"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* Friends list */}
                <div className="invite-friend-list">
                  {filteredFriends.length === 0 && (
                    <div className="invite-friend-empty">
                      {acceptedFriends.length === 0 ? "No friends to invite." : "No matching friends."}
                    </div>
                  )}
                  {filteredFriends.map((friend) => {
                    const displayName = friend.display_name || friend.username;
                    const isSent = sentTo.has(friend.username);
                    const isSending = sending.has(friend.username);
                    return (
                      <div key={friend.id} className="invite-friend-row">
                        <div className="invite-friend-info">
                          <Avatar avatarUrl={friend.avatar_url} name={displayName} size={32} />
                          <div className="invite-friend-names">
                            <span className="invite-friend-display">{displayName}</span>
                            <span className="invite-friend-username">{friend.username}</span>
                          </div>
                        </div>
                        <button
                          className={`invite-friend-btn ${isSent ? "sent" : ""}`}
                          onClick={() => handleInviteFriend(friend.username)}
                          disabled={isSent || isSending}
                        >
                          {isSent ? "Invited" : isSending ? "..." : "Invite"}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Invite link */}
                <div className="invite-link-section">
                  <p className="invite-link-label">Or, send a server invite link to a friend</p>
                  <div className="invite-code-row">
                    <input
                      className="invite-link-input"
                      readOnly
                      value={inviteUrl}
                      onFocus={(e) => e.target.select()}
                    />
                    <button className="invite-copy-btn" onClick={handleCopy}>
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {!preSelectedServerId && !loading && (
              <button className="btn-ghost invite-back-btn" onClick={() => { setSelectedServerId(null); setInviteCode(null); setError(""); }}>
                Back
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
