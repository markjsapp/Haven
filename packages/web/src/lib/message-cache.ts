/**
 * Local cache for decrypted messages.
 * Since E2EE sessions are ephemeral (MemoryStore), old messages can't be
 * decrypted after re-login. This cache stores the decrypted plaintext in
 * localStorage so messages remain readable across sessions.
 */

import type { DecryptedMessage } from "../store/chat.js";

const CACHE_KEY = "haven:msg-cache";
const MAX_CACHED_MESSAGES = 2000;

interface CachedMsg {
  sid: string; // senderId
  txt: string; // text
  att?: unknown[]; // attachments
  lp?: unknown[]; // linkPreviews
  ct?: string; // contentType
  fmt?: unknown; // formatting
}

type Cache = Record<string, CachedMsg>;

let memCache: Cache | null = null;

function loadCache(): Cache {
  if (memCache) return memCache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    memCache = raw ? JSON.parse(raw) : {};
  } catch {
    memCache = {};
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
    ...(msg.attachments?.length ? { att: msg.attachments } : {}),
    ...(msg.linkPreviews?.length ? { lp: msg.linkPreviews } : {}),
    ...(msg.contentType ? { ct: msg.contentType } : {}),
    ...(msg.formatting ? { fmt: msg.formatting } : {}),
  };
  persistCache();
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

/** Remove a message from cache (e.g. on delete). */
export function uncacheMessage(messageId: string): void {
  const cache = loadCache();
  delete cache[messageId];
  persistCache();
}
