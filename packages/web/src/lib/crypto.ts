/**
 * High-level E2EE helpers that bridge @haven/core crypto with the Haven backend.
 *
 * Message wire format (encrypted_body):
 *   Byte 0: Type — 0x01 = initial (includes X3DH keys), 0x02 = follow-up
 *   If initial:
 *     Bytes 1-32: Sender's Ed25519 identity public key
 *     Bytes 33-64: Sender's X25519 ephemeral public key
 *     Byte 65: 0x01 if one-time prekey was used, 0x00 if not
 *     Bytes 66+: Serialized Double Ratchet message
 *   If follow-up:
 *     Bytes 1+: Serialized Double Ratchet message
 *
 * The Double Ratchet message internally contains the encrypted payload:
 *   JSON: { sender_id: string, text: string }
 */

import {
  DoubleRatchetSession,
  serializeMessage,
  deserializeMessage,
  x3dhInitiate,
  toBase64,
  fromBase64,
  randomBytes,
  type KeyBundle,
  type MessageResponse,
} from "@haven/core";
import { useAuthStore } from "../store/auth.js";
import type { DecryptedMessage } from "../store/chat.js";

// ─── Session Cache ─────────────────────────────────────
// Maps peerId -> DoubleRatchetSession
const sessions = new Map<string, DoubleRatchetSession>();
// Maps peerId -> associated data (for session restore)
const sessionAD = new Map<string, Uint8Array>();
// Maps channelId -> peerId (for routing messages to the right session)
const channelPeerMap = new Map<string, string>();

const MSG_TYPE_INITIAL = 0x01;
const MSG_TYPE_FOLLOWUP = 0x02;

/**
 * Establish a Double Ratchet session with a peer using their key bundle.
 */
export async function ensureSession(peerId: string, bundle: KeyBundle): Promise<void> {
  if (sessions.has(peerId)) return;

  const { identityKeyPair } = useAuthStore.getState();
  if (!identityKeyPair) throw new Error("No identity key pair");

  const bobSignedPreKeyPub = fromBase64(bundle.signed_prekey);

  const x3dhResult = x3dhInitiate(identityKeyPair, bundle);

  const session = DoubleRatchetSession.initAlice(
    x3dhResult.sharedKey,
    x3dhResult.associatedData,
    bobSignedPreKeyPub,
  );

  sessions.set(peerId, session);
  sessionAD.set(peerId, x3dhResult.associatedData);

  // Store the ephemeral key for the initial message
  initialMessageKeys.set(peerId, {
    identityKey: identityKeyPair.publicKey,
    ephemeralKey: x3dhResult.ephemeralPublicKey,
    usedOtp: bundle.one_time_prekey !== null,
  });
}

// Temporary storage for initial message key material
const initialMessageKeys = new Map<
  string,
  { identityKey: Uint8Array; ephemeralKey: Uint8Array; usedOtp: boolean }
>();

/**
 * Map a channel to a peer (for DM routing).
 */
export function mapChannelToPeer(channelId: string, peerId: string): void {
  channelPeerMap.set(channelId, peerId);
}

/**
 * Encrypt a message for sending.
 * Returns base64-encoded sender_token and encrypted_body.
 */
export async function encryptOutgoing(
  senderId: string,
  channelId: string,
  text: string,
): Promise<{ senderToken: string; encryptedBody: string }> {
  const peerId = channelPeerMap.get(channelId);

  // Generate a random sealed sender token
  const senderToken = toBase64(randomBytes(32));

  // If no peer mapped (e.g., group channel without E2EE), send plaintext-ish
  if (!peerId || !sessions.has(peerId)) {
    const payload = JSON.stringify({ sender_id: senderId, text });
    const payloadBytes = new TextEncoder().encode(payload);
    // Prefix with type byte (0x00 = unencrypted for MVP group messages)
    const body = new Uint8Array(1 + payloadBytes.length);
    body[0] = 0x00;
    body.set(payloadBytes, 1);
    return { senderToken, encryptedBody: toBase64(body) };
  }

  const session = sessions.get(peerId)!;
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ sender_id: senderId, text }),
  );

  const encrypted = session.encrypt(plaintext);
  const serialized = serializeMessage(encrypted);

  // Check if this is the initial message (we have stored X3DH keys)
  const initKeys = initialMessageKeys.get(peerId);
  let body: Uint8Array;

  if (initKeys) {
    // Initial message: include X3DH key material
    body = new Uint8Array(1 + 32 + 32 + 1 + serialized.length);
    body[0] = MSG_TYPE_INITIAL;
    body.set(initKeys.identityKey, 1);
    body.set(initKeys.ephemeralKey, 33);
    body[65] = initKeys.usedOtp ? 0x01 : 0x00;
    body.set(serialized, 66);
    initialMessageKeys.delete(peerId);
  } else {
    // Follow-up message
    body = new Uint8Array(1 + serialized.length);
    body[0] = MSG_TYPE_FOLLOWUP;
    body.set(serialized, 1);
  }

  return { senderToken, encryptedBody: toBase64(body) };
}

/**
 * Decrypt an incoming message from the server.
 */
export async function decryptIncoming(raw: MessageResponse): Promise<DecryptedMessage> {
  const bodyBytes = fromBase64(raw.encrypted_body);
  const type = bodyBytes[0];

  // Unencrypted message (group channel MVP fallback)
  if (type === 0x00) {
    const payload = JSON.parse(new TextDecoder().decode(bodyBytes.slice(1)));
    return {
      id: raw.id,
      channelId: raw.channel_id,
      senderId: payload.sender_id,
      text: payload.text,
      timestamp: raw.timestamp,
      raw,
    };
  }

  let serializedMsg: Uint8Array;

  if (type === MSG_TYPE_INITIAL) {
    // Initial message — contains X3DH key material
    // In a full implementation, Bob would:
    // 1. Extract sender's identity key + ephemeral key
    // 2. Run x3dhRespond to compute the shared secret
    // 3. Initialize DoubleRatchetSession.initBob
    // For now, we can only decrypt if we already have a session
    serializedMsg = bodyBytes.slice(66);
  } else if (type === MSG_TYPE_FOLLOWUP) {
    serializedMsg = bodyBytes.slice(1);
  } else {
    throw new Error(`Unknown message type: ${type}`);
  }

  // Find the session for this channel's peer
  const peerId = channelPeerMap.get(raw.channel_id);
  if (!peerId || !sessions.has(peerId)) {
    throw new Error("No session for this peer");
  }

  const session = sessions.get(peerId)!;
  const encrypted = deserializeMessage(serializedMsg);
  const plaintext = session.decrypt(encrypted);

  const payload = JSON.parse(new TextDecoder().decode(plaintext));

  return {
    id: raw.id,
    channelId: raw.channel_id,
    senderId: payload.sender_id,
    text: payload.text,
    timestamp: raw.timestamp,
    raw,
  };
}
