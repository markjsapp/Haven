/**
 * Local cache for decrypted messages.
 * Since E2EE sessions are ephemeral (MemoryStore), old messages can't be
 * decrypted after re-login. This cache stores the decrypted plaintext in
 * localStorage so messages remain readable across sessions.
 *
 * Also writes to IndexedDB in the background for larger capacity.
 */

import type { DecryptedMessage } from "../store/chat.js";
import { idbCacheMessage, idbUncacheMessage, idbGetMessage, idbClearAll, migrateFromLocalStorage, idbEvict } from "./indexed-message-store.js";

const CACHE_KEY = "haven:msg-cache";
const MAX_CACHED_MESSAGES = 2000;

interface CachedMsg {
  sid: string; // senderId
  txt: string; // text
  ch?: string; // channelId
  att?: unknown[]; // attachments
  lp?: unknown[]; // linkPreviews
  ct?: string; // contentType
  fmt?: unknown; // formatting
}

type Cache = Record<string, CachedMsg>;

let memCache: Cache | null = null;
let migrated = false;

function loadCache(): Cache {
  if (memCache) return memCache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    memCache = raw ? JSON.parse(raw) : {};
  } catch {
    memCache = {};
  }

  // Kick off one-time migration to IndexedDB
  if (!migrated) {
    migrated = true;
    migrateFromLocalStorage().catch(() => {});
    // Periodic eviction
    idbEvict().catch(() => {});
  }

  return memCache!;
}

function persistCache(): void {
  if (!memCache) return;
  try {
    // Evict oldest entries if over limit
    const keys = Object.keys(memCache);
    if (keys.length > MAX_CACHED_MESSAGES) {
      const toRemove = keys.slice(0, keys.length - MAX_CACHED_MESSAGES);
      for (const k of toRemove) delete memCache[k];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(memCache));
  } catch {
    // Storage full — clear and retry
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch { /* give up */ }
  }
}

/** Cache a successfully decrypted message. */
export function cacheMessage(msg: DecryptedMessage): void {
  const cache = loadCache();
  cache[msg.id] = {
    sid: msg.senderId,
    txt: msg.text,
    ch: msg.channelId,
    ...(msg.attachments?.length ? { att: msg.attachments } : {}),
    ...(msg.linkPreviews?.length ? { lp: msg.linkPreviews } : {}),
    ...(msg.contentType ? { ct: msg.contentType } : {}),
    ...(msg.formatting ? { fmt: msg.formatting } : {}),
  };
  persistCache();

  // Also write to IndexedDB (fire-and-forget)
  idbCacheMessage(msg).catch(() => {});
}

/** Try to restore a message from cache. Returns null if not cached. */
export function getCachedMessage(
  messageId: string,
  channelId: string,
  timestamp: string,
  edited: boolean,
  raw: unknown,
): DecryptedMessage | null {
  const cache = loadCache();
  const cached = cache[messageId];
  if (!cached) return null;
  // Reject if the cached message belongs to a different channel
  if (cached.ch && cached.ch !== channelId) return null;

  return {
    id: messageId,
    channelId,
    senderId: cached.sid,
    text: cached.txt,
    attachments: cached.att as DecryptedMessage["attachments"],
    linkPreviews: cached.lp as DecryptedMessage["linkPreviews"],
    contentType: cached.ct,
    formatting: cached.fmt as object | undefined,
    timestamp,
    edited,
    raw: raw as DecryptedMessage["raw"],
  };
}

/**
 * Try to restore a message from IndexedDB (async fallback when localStorage misses).
 * Returns null if not found in IndexedDB either.
 */
export async function getCachedMessageAsync(
  messageId: string,
  channelId: string,
  timestamp: string,
  edited: boolean,
  raw: unknown,
): Promise<DecryptedMessage | null> {
  // Try sync cache first
  const syncResult = getCachedMessage(messageId, channelId, timestamp, edited, raw);
  if (syncResult) return syncResult;

  // Fall back to IndexedDB
  const idbResult = await idbGetMessage(messageId);
  if (!idbResult) return null;

  // Merge with provided context
  return {
    ...idbResult,
    channelId,
    timestamp,
    edited,
    raw: raw as DecryptedMessage["raw"],
  };
}

/** Clear all cached messages (used on logout). */
export function clearMessageCache(): void {
  memCache = {};
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  idbClearAll().catch(() => {});
}

/** Remove a message from cache (e.g. on delete). */
export function uncacheMessage(messageId: string): void {
  const cache = loadCache();
  delete cache[messageId];
  persistCache();

  // Also remove from IndexedDB (fire-and-forget)
  idbUncacheMessage(messageId).catch(() => {});
}
