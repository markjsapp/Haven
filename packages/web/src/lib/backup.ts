/**
 * Backup orchestration — bridges crypto state, haven-core backup crypto,
 * and the API to provide upload/restore/auto-backup functionality.
 */

import {
  toBase64,
  fromBase64,
  encryptBackup,
  decryptBackup,
  DoubleRatchetSession,
  type BackupPayload,
  type SerializedSessionState,
  type SenderKeyState,
  type ReceivedSenderKey,
} from "@haven/core";
import { useAuthStore } from "../store/auth.js";
import { exportCryptoState, importCryptoState } from "./crypto.js";

// ─── Security Phrase Cache ──────────────────────────────
// Held only in JS memory — never persisted to localStorage/IndexedDB.
let cachedPhrase: string | null = null;

export function cacheSecurityPhrase(phrase: string): void {
  cachedPhrase = phrase;
}

export function getCachedPhrase(): string | null {
  return cachedPhrase;
}

export function clearCachedPhrase(): void {
  cachedPhrase = null;
}

// Clear on page unload to avoid leaking into process memory longer than needed
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    cachedPhrase = null;
  });
}

// ─── Payload Builder ────────────────────────────────────

function serializeSessionState(
  state: ReturnType<DoubleRatchetSession["serialize"]>,
): SerializedSessionState {
  return {
    dhSend: {
      publicKey: toBase64(state.dhSend.publicKey),
      privateKey: toBase64(state.dhSend.privateKey),
    },
    dhRecv: state.dhRecv ? toBase64(state.dhRecv) : null,
    rootKey: toBase64(state.rootKey),
    chainKeySend: state.chainKeySend ? toBase64(state.chainKeySend) : null,
    chainKeyRecv: state.chainKeyRecv ? toBase64(state.chainKeyRecv) : null,
    sendCount: state.sendCount,
    recvCount: state.recvCount,
    prevSendCount: state.prevSendCount,
    skippedKeys: state.skippedKeys.map((sk) => ({
      dhPub: toBase64(sk.dhPub),
      n: sk.n,
      mk: toBase64(sk.mk),
    })),
  };
}

/**
 * Build a BackupPayload from the current in-memory crypto state + auth store.
 */
export function buildBackupPayload(): BackupPayload {
  const { identityKeyPair, signedPreKey } = useAuthStore.getState();
  if (!identityKeyPair || !signedPreKey) {
    throw new Error("Cannot build backup: missing identity or signed prekey");
  }

  const { sessions, sessionAD, channelPeerMap, mySenderKeys, receivedSenderKeys, distributedChannels } =
    exportCryptoState();

  // Serialize DM sessions
  const serializedSessions: Record<string, { state: SerializedSessionState; ad: string }> = {};
  for (const [peerId, session] of sessions) {
    const ad = sessionAD.get(peerId);
    if (!ad) continue;
    serializedSessions[peerId] = {
      state: serializeSessionState(session.serialize()),
      ad: toBase64(ad),
    };
  }

  // Serialize sender keys
  const serializedMySenderKeys: Record<string, { distributionId: string; chainKey: string; chainIndex: number }> = {};
  for (const [channelId, sk] of mySenderKeys) {
    serializedMySenderKeys[channelId] = {
      distributionId: toBase64(sk.distributionId),
      chainKey: toBase64(sk.chainKey),
      chainIndex: sk.chainIndex,
    };
  }

  const serializedReceivedKeys: Record<string, { fromUserId: string; key: { distributionId: string; chainKey: string; chainIndex: number } }> = {};
  for (const [cacheKey, entry] of receivedSenderKeys) {
    serializedReceivedKeys[cacheKey] = {
      fromUserId: entry.fromUserId,
      key: {
        distributionId: toBase64(entry.key.distributionId),
        chainKey: toBase64(entry.key.chainKey),
        chainIndex: entry.key.chainIndex,
      },
    };
  }

  return {
    version: 1,
    identity: {
      publicKey: toBase64(identityKeyPair.publicKey),
      privateKey: toBase64(identityKeyPair.privateKey),
    },
    signedPreKey: {
      publicKey: toBase64(signedPreKey.keyPair.publicKey),
      privateKey: toBase64(signedPreKey.keyPair.privateKey),
      signature: toBase64(signedPreKey.signature),
    },
    sessions: serializedSessions,
    mySenderKeys: serializedMySenderKeys,
    receivedSenderKeys: serializedReceivedKeys,
    distributedChannels: Array.from(distributedChannels),
    channelPeerMap: Object.fromEntries(channelPeerMap),
    timestamp: new Date().toISOString(),
  };
}

// ─── Upload / Restore ───────────────────────────────────

/**
 * Build, encrypt, and upload a key backup to the server.
 */
export async function uploadBackup(securityPhrase: string): Promise<void> {
  const payload = buildBackupPayload();
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  const { encrypted, nonce, salt } = encryptBackup(jsonBytes, securityPhrase);

  const { api } = useAuthStore.getState();
  await api.uploadKeyBackup({
    encrypted_data: toBase64(encrypted),
    nonce: toBase64(nonce),
    salt: toBase64(salt),
    version: 1,
  });
}

/**
 * Download and decrypt a backup from the server, restoring all crypto state.
 * Throws if the security phrase is wrong (Poly1305 auth failure).
 */
export async function downloadAndRestoreBackup(securityPhrase: string): Promise<void> {
  const { api } = useAuthStore.getState();
  const response = await api.getKeyBackup();

  const encrypted = fromBase64(response.encrypted_data);
  const nonce = fromBase64(response.nonce);
  const salt = fromBase64(response.salt);

  const plaintext = decryptBackup(encrypted, nonce, salt, securityPhrase);
  const payload: BackupPayload = JSON.parse(new TextDecoder().decode(plaintext));

  // Restore identity key pair
  const identityKeyPair = {
    publicKey: fromBase64(payload.identity.publicKey),
    privateKey: fromBase64(payload.identity.privateKey),
  };

  // Restore signed prekey
  const signedPreKey = {
    keyPair: {
      publicKey: fromBase64(payload.signedPreKey.publicKey),
      privateKey: fromBase64(payload.signedPreKey.privateKey),
    },
    signature: fromBase64(payload.signedPreKey.signature),
  };

  // Deserialize DM sessions
  const sessions = new Map<string, DoubleRatchetSession>();
  const sessionAD = new Map<string, Uint8Array>();
  for (const [peerId, entry] of Object.entries(payload.sessions)) {
    const ad = fromBase64(entry.ad);
    const state = {
      dhSend: {
        publicKey: fromBase64(entry.state.dhSend.publicKey),
        privateKey: fromBase64(entry.state.dhSend.privateKey),
      },
      dhRecv: entry.state.dhRecv ? fromBase64(entry.state.dhRecv) : null,
      rootKey: fromBase64(entry.state.rootKey),
      chainKeySend: entry.state.chainKeySend ? fromBase64(entry.state.chainKeySend) : null,
      chainKeyRecv: entry.state.chainKeyRecv ? fromBase64(entry.state.chainKeyRecv) : null,
      sendCount: entry.state.sendCount,
      recvCount: entry.state.recvCount,
      prevSendCount: entry.state.prevSendCount,
      skippedKeys: entry.state.skippedKeys.map((sk) => ({
        dhPub: fromBase64(sk.dhPub),
        n: sk.n,
        mk: fromBase64(sk.mk),
      })),
    };
    sessions.set(peerId, DoubleRatchetSession.deserialize(state, ad));
    sessionAD.set(peerId, ad);
  }

  // Deserialize channel-peer map
  const channelPeerMap = new Map<string, string>(Object.entries(payload.channelPeerMap));

  // Deserialize sender keys
  const mySenderKeys = new Map<string, SenderKeyState>();
  for (const [channelId, sk] of Object.entries(payload.mySenderKeys)) {
    mySenderKeys.set(channelId, {
      distributionId: fromBase64(sk.distributionId),
      chainKey: fromBase64(sk.chainKey),
      chainIndex: sk.chainIndex,
    });
  }

  const receivedSenderKeys = new Map<string, { fromUserId: string; key: ReceivedSenderKey }>();
  for (const [cacheKey, entry] of Object.entries(payload.receivedSenderKeys)) {
    receivedSenderKeys.set(cacheKey, {
      fromUserId: entry.fromUserId,
      key: {
        distributionId: fromBase64(entry.key.distributionId),
        chainKey: fromBase64(entry.key.chainKey),
        chainIndex: entry.key.chainIndex,
      },
    });
  }

  const distributedChannels = new Set<string>(payload.distributedChannels);

  // Import into the crypto module
  importCryptoState({
    sessions,
    sessionAD,
    channelPeerMap,
    mySenderKeys,
    receivedSenderKeys,
    distributedChannels,
  });

  // Persist identity key and update auth store
  persistIdentityKeyFromBackup(identityKeyPair);

  // Update auth store with restored keys
  useAuthStore.setState({
    identityKeyPair,
    signedPreKey,
  });
}

/**
 * Persist the identity key from a backup restore to localStorage.
 */
function persistIdentityKeyFromBackup(kp: { publicKey: Uint8Array; privateKey: Uint8Array }): void {
  const user = useAuthStore.getState().user;
  if (!user) return;
  const data = JSON.stringify({
    publicKey: toBase64(kp.publicKey),
    privateKey: toBase64(kp.privateKey),
  });
  localStorage.setItem(`haven:identity:${user.id}`, data);
}

/**
 * Check whether the server has a backup for the current user.
 */
export async function checkBackupStatus(): Promise<{ hasBackup: boolean; version: number | null }> {
  const { api } = useAuthStore.getState();
  const status = await api.getKeyBackupStatus();
  return { hasBackup: status.has_backup, version: status.version };
}

// ─── Auto-Backup ────────────────────────────────────────

let autoBackupTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_BACKUP_DELAY_MS = 5000;

/**
 * Schedule a debounced auto-backup. Only runs if a security phrase is cached.
 * Call after key material changes (new session, new sender key, etc.).
 */
export function scheduleAutoBackup(): void {
  if (!cachedPhrase) return;

  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
  }

  autoBackupTimer = setTimeout(async () => {
    autoBackupTimer = null;
    if (!cachedPhrase) return;
    try {
      await uploadBackup(cachedPhrase);
    } catch (e) {
      console.warn("Auto-backup failed:", e);
    }
  }, AUTO_BACKUP_DELAY_MS);
}
