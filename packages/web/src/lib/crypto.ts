/**
 * High-level E2EE helpers that bridge @haven/core crypto with the Haven backend.
 *
 * Message wire format (encrypted_body):
 *   Byte 0: Type
 *     0x01 = initial DM (includes X3DH keys)
 *     0x02 = follow-up DM (Double Ratchet only)
 *     0x03 = group channel (Sender Keys)
 *
 *   If initial (0x01):
 *     Bytes 1-32: Sender's Ed25519 identity public key
 *     Bytes 33-64: Sender's X25519 ephemeral public key
 *     Byte 65: 0x00 (no OTP) or 0x01 (OTP used)
 *     If OTP used:
 *       Bytes 66-97: OTP public key (32 bytes)
 *       Bytes 98+: Serialized Double Ratchet message
 *     If no OTP:
 *       Bytes 66+: Serialized Double Ratchet message
 *   If follow-up (0x02):
 *     Bytes 1+: Serialized Double Ratchet message
 *   If group (0x03):
 *     Bytes 1-16: Distribution ID (UUID bytes)
 *     Bytes 17-20: Chain index (uint32 LE)
 *     Bytes 21-44: Nonce (24 bytes)
 *     Bytes 45+: Ciphertext + Poly1305 tag
 *
 * The encrypted payload (JSON):
 *   { sender_id: string, text: string, attachments?: AttachmentMeta[] }
 */

import {
  DoubleRatchetSession,
  serializeMessage,
  deserializeMessage,
  x3dhInitiate,
  x3dhRespond,
  toBase64,
  fromBase64,
  randomBytes,
  generateSenderKey,
  createSkdmPayload,
  parseSkdmPayload,
  encryptSkdm,
  decryptSkdm,
  senderKeyEncrypt,
  senderKeyDecrypt,
  GROUP_MSG_TYPE,
  type KeyBundle,
  type MessageResponse,
  type SenderKeyState,
  type ReceivedSenderKey,
} from "@haven/core";
import { useAuthStore } from "../store/auth.js";
import type { DecryptedMessage, AttachmentMeta } from "../store/chat.js";

// ─── DM Session Cache ─────────────────────────────────
// Maps peerId -> DoubleRatchetSession
const sessions = new Map<string, DoubleRatchetSession>();
// Maps peerId -> associated data (for session restore)
const sessionAD = new Map<string, Uint8Array>();
// Maps channelId -> peerId (for routing messages to the right session)
const channelPeerMap = new Map<string, string>();

const MSG_TYPE_INITIAL = 0x01;
const MSG_TYPE_FOLLOWUP = 0x02;

// ─── Sender Key Cache ─────────────────────────────────
// Our sender key per channel (for encrypting outgoing group messages)
const mySenderKeys = new Map<string, SenderKeyState>();
// Received sender keys from other members: "channelId:distIdHex" -> ReceivedSenderKey
const receivedSenderKeys = new Map<string, { fromUserId: string; key: ReceivedSenderKey }>();
// Tracks which channels we've already distributed our sender key to
const distributedChannels = new Set<string>();

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
    otpPublicKey: bundle.one_time_prekey ? fromBase64(bundle.one_time_prekey) : null,
  });
}

// Temporary storage for initial message key material
const initialMessageKeys = new Map<
  string,
  {
    identityKey: Uint8Array;
    ephemeralKey: Uint8Array;
    usedOtp: boolean;
    otpPublicKey: Uint8Array | null;
  }
>();

/**
 * Map a channel to a peer (for DM routing).
 */
export function mapChannelToPeer(channelId: string, peerId: string): void {
  channelPeerMap.set(channelId, peerId);
}

// ─── Sender Key Management ────────────────────────────

/**
 * Ensure we have a sender key for the given channel and distribute it
 * to all members. Called before sending a group message.
 */
export async function ensureSenderKeyDistributed(channelId: string): Promise<void> {
  const { api } = useAuthStore.getState();
  const { identityKeyPair } = useAuthStore.getState();
  if (!identityKeyPair) throw new Error("No identity key pair");

  // Generate sender key if we don't have one
  if (!mySenderKeys.has(channelId)) {
    mySenderKeys.set(channelId, generateSenderKey());
    distributedChannels.delete(channelId);
  }

  // Distribute if not yet done
  if (!distributedChannels.has(channelId)) {
    const senderKey = mySenderKeys.get(channelId)!;
    const skdmPayload = createSkdmPayload(senderKey);

    // Fetch all member identity keys
    const memberKeys = await api.getChannelMemberKeys(channelId);

    // Encrypt SKDM for each member
    const distributions = memberKeys.map((mk) => ({
      to_user_id: mk.user_id,
      distribution_id: uuidFromBytes(senderKey.distributionId),
      encrypted_skdm: toBase64(encryptSkdm(skdmPayload, fromBase64(mk.identity_key))),
    }));

    if (distributions.length > 0) {
      await api.distributeSenderKeys(channelId, { distributions });
    }

    distributedChannels.add(channelId);
  }
}

/**
 * Fetch and process any pending sender key distributions for a channel.
 * Called on channel select and when receiving SenderKeysUpdated via WS.
 */
export async function fetchSenderKeys(channelId: string): Promise<void> {
  const { api } = useAuthStore.getState();
  const { identityKeyPair } = useAuthStore.getState();
  if (!identityKeyPair) return;

  const skdms = await api.getSenderKeys(channelId);

  for (const skdm of skdms) {
    try {
      const encryptedBytes = fromBase64(skdm.encrypted_skdm);
      const payloadBytes = decryptSkdm(encryptedBytes, identityKeyPair);
      const parsed = parseSkdmPayload(payloadBytes);

      const cacheKey = senderKeyCacheId(channelId, parsed.distributionId);
      receivedSenderKeys.set(cacheKey, {
        fromUserId: skdm.from_user_id,
        key: {
          distributionId: parsed.distributionId,
          chainKey: parsed.chainKey,
          chainIndex: parsed.chainIndex,
        },
      });
    } catch (e) {
      console.warn("Failed to process SKDM from", skdm.from_user_id, e);
    }
  }
}

/**
 * Invalidate sender key for a channel (e.g., when a member leaves).
 * Forces re-generation and re-distribution on next send.
 */
export function invalidateSenderKey(channelId: string): void {
  mySenderKeys.delete(channelId);
  distributedChannels.delete(channelId);
}

// ─── Encrypt / Decrypt ────────────────────────────────

/**
 * Encrypt a message for sending.
 * Returns base64-encoded sender_token and encrypted_body.
 */
export async function encryptOutgoing(
  senderId: string,
  channelId: string,
  text: string,
  attachments?: AttachmentMeta[],
  formatting?: { contentType: string; data: object },
  linkPreviews?: Array<{ url: string; title?: string; description?: string; image?: string; site_name?: string }>,
): Promise<{ senderToken: string; encryptedBody: string }> {
  const peerId = channelPeerMap.get(channelId);

  // Generate a random sealed sender token
  const senderToken = toBase64(randomBytes(32));

  // Build payload with optional attachments and formatting
  const payloadObj: Record<string, unknown> = { sender_id: senderId, text };
  if (attachments && attachments.length > 0) {
    payloadObj.attachments = attachments;
  }
  if (formatting) {
    payloadObj.content_type = formatting.contentType;
    payloadObj.formatting = formatting.data;
  }
  if (linkPreviews && linkPreviews.length > 0) {
    payloadObj.link_previews = linkPreviews;
  }

  // If no DM peer mapped — this is a group channel, use Sender Keys
  if (!peerId || !sessions.has(peerId)) {
    await ensureSenderKeyDistributed(channelId);
    const senderKey = mySenderKeys.get(channelId);
    if (!senderKey) throw new Error("Failed to establish sender key");

    const payload = JSON.stringify(payloadObj);
    const payloadBytes = new TextEncoder().encode(payload);
    const body = senderKeyEncrypt(senderKey, payloadBytes);
    return { senderToken, encryptedBody: toBase64(body) };
  }

  // DM channel — use Double Ratchet
  const session = sessions.get(peerId)!;
  const plaintext = new TextEncoder().encode(
    JSON.stringify(payloadObj),
  );

  const encrypted = session.encrypt(plaintext);
  const serialized = serializeMessage(encrypted);

  // Check if this is the initial message (we have stored X3DH keys)
  const initKeys = initialMessageKeys.get(peerId);
  let body: Uint8Array;

  if (initKeys) {
    // Initial message: include X3DH key material + optional OTP public key
    const otpLen = initKeys.otpPublicKey ? 32 : 0;
    body = new Uint8Array(1 + 32 + 32 + 1 + otpLen + serialized.length);
    body[0] = MSG_TYPE_INITIAL;
    body.set(initKeys.identityKey, 1);
    body.set(initKeys.ephemeralKey, 33);
    body[65] = initKeys.usedOtp ? 0x01 : 0x00;
    let offset = 66;
    if (initKeys.otpPublicKey) {
      body.set(initKeys.otpPublicKey, offset);
      offset += 32;
    }
    body.set(serialized, offset);
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

  // Legacy unencrypted message (backwards compatibility)
  if (type === 0x00) {
    const payload = JSON.parse(new TextDecoder().decode(bodyBytes.slice(1)));
    return buildDecryptedMessage(raw, payload);
  }

  // Group channel — Sender Keys (type 0x03)
  if (type === GROUP_MSG_TYPE) {
    // Extract distribution ID from wire format (bytes 1-16)
    const distributionId = bodyBytes.slice(1, 1 + 16);
    const cacheKey = senderKeyCacheId(raw.channel_id, distributionId);

    let entry = receivedSenderKeys.get(cacheKey);

    // If we don't have this sender's key, try fetching from server
    if (!entry) {
      await fetchSenderKeys(raw.channel_id);
      entry = receivedSenderKeys.get(cacheKey);
    }

    if (!entry) {
      throw new Error("No sender key found for this distribution ID");
    }

    const plaintext = senderKeyDecrypt(bodyBytes, entry.key);
    const payload = JSON.parse(new TextDecoder().decode(plaintext));
    return buildDecryptedMessage(raw, payload);
  }

  // DM messages — Double Ratchet (type 0x01 or 0x02)

  if (type === MSG_TYPE_INITIAL) {
    // Parse X3DH header from the initial message
    const aliceIdentityPub = bodyBytes.slice(1, 33);
    const aliceEphemeralPub = bodyBytes.slice(33, 65);
    const usedOtp = bodyBytes[65] === 0x01;

    let drOffset = 66;
    let otpPublicKey: Uint8Array | null = null;
    if (usedOtp) {
      otpPublicKey = bodyBytes.slice(66, 98);
      drOffset = 98;
    }
    const serializedMsg = bodyBytes.slice(drOffset);

    // Check if we already have a session for the peer on this channel
    const existingPeerId = channelPeerMap.get(raw.channel_id);
    if (existingPeerId && sessions.has(existingPeerId)) {
      // Already have a session — just decrypt
      const session = sessions.get(existingPeerId)!;
      const encrypted = deserializeMessage(serializedMsg);
      const plaintext = session.decrypt(encrypted);
      const payload = JSON.parse(new TextDecoder().decode(plaintext));
      return buildDecryptedMessage(raw, payload);
    }

    // No session — perform X3DH responder to establish one
    const { identityKeyPair, signedPreKey, store } = useAuthStore.getState();
    if (!identityKeyPair || !signedPreKey) {
      throw new Error("Missing identity or signed prekey for X3DH respond");
    }

    // Look up the one-time prekey if used
    let otpKeyPair = null;
    if (usedOtp && otpPublicKey) {
      otpKeyPair = await store.consumeOneTimePreKey(otpPublicKey);
    }

    // Derive the shared secret (mirror of Alice's x3dhInitiate)
    const x3dhResult = x3dhRespond(
      identityKeyPair,
      signedPreKey.keyPair,
      otpKeyPair,
      aliceIdentityPub,
      aliceEphemeralPub,
    );

    // Initialize Bob's Double Ratchet session
    const session = DoubleRatchetSession.initBob(
      x3dhResult.sharedKey,
      x3dhResult.associatedData,
      signedPreKey.keyPair,
    );

    // Decrypt the DR payload
    const encrypted = deserializeMessage(serializedMsg);
    const plaintext = session.decrypt(encrypted);
    const payload = JSON.parse(new TextDecoder().decode(plaintext));

    // Cache the session keyed by the sender's user ID (discovered from payload)
    const senderId = payload.sender_id;
    sessions.set(senderId, session);
    sessionAD.set(senderId, x3dhResult.associatedData);
    channelPeerMap.set(raw.channel_id, senderId);
    return buildDecryptedMessage(raw, payload);
  }

  if (type === MSG_TYPE_FOLLOWUP) {
    const serializedMsg = bodyBytes.slice(1);

    // Find the session for this channel's peer
    const peerId = channelPeerMap.get(raw.channel_id);
    if (!peerId || !sessions.has(peerId)) {
      throw new Error("No session for this peer — need initial message first");
    }

    const session = sessions.get(peerId)!;
    const encrypted = deserializeMessage(serializedMsg);
    const plaintext = session.decrypt(encrypted);
    const payload = JSON.parse(new TextDecoder().decode(plaintext));
    return buildDecryptedMessage(raw, payload);
  }

  throw new Error(`Unknown message type: ${type}`);
}

// ─── Helpers ───────────────────────────────────────────

/** Build a DecryptedMessage from a raw server response and decrypted JSON payload. */
function buildDecryptedMessage(
  raw: MessageResponse,
  payload: Record<string, unknown>,
): DecryptedMessage {
  return {
    id: raw.id,
    channelId: raw.channel_id,
    senderId: payload.sender_id as string,
    text: payload.text as string,
    attachments: payload.attachments as DecryptedMessage["attachments"],
    linkPreviews: payload.link_previews as DecryptedMessage["linkPreviews"],
    contentType: payload.content_type as string | undefined,
    formatting: payload.formatting as object | undefined,
    timestamp: raw.timestamp,
    raw,
  };
}

/** Build a cache key for received sender keys: "channelId:distIdHex" */
function senderKeyCacheId(channelId: string, distributionId: Uint8Array): string {
  const hex = Array.from(distributionId, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${channelId}:${hex}`;
}

/** Convert 16-byte UUID to string form (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) */
function uuidFromBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
