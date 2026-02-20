/**
 * IndexedDB-backed message store for persisting decrypted messages.
 * Replaces localStorage for larger capacity and async access.
 * Provides up to 50,000 messages (vs 2,000 in localStorage).
 */

import type { DecryptedMessage } from "../store/chat.js";

const DB_NAME = "haven-messages";
const DB_VERSION = 1;
const STORE_NAME = "messages";
const MAX_MESSAGES = 50_000;

interface StoredMessage {
  id: string;
  channelId: string;
  senderId: string;
  text: string;
  timestamp: string;
  attachments?: unknown[];
  linkPreviews?: unknown[];
  contentType?: string;
  formatting?: unknown;
  edited?: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("by-channel", "channelId", { unique: false });
        store.createIndex("by-timestamp", ["channelId", "timestamp"], { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function toStored(msg: DecryptedMessage): StoredMessage {
  return {
    id: msg.id,
    channelId: msg.channelId,
    senderId: msg.senderId,
    text: msg.text,
    timestamp: msg.timestamp,
    ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
    ...(msg.linkPreviews?.length ? { linkPreviews: msg.linkPreviews } : {}),
    ...(msg.contentType ? { contentType: msg.contentType } : {}),
    ...(msg.formatting ? { formatting: msg.formatting as unknown } : {}),
    ...(msg.edited ? { edited: true } : {}),
  };
}

function fromStored(stored: StoredMessage, raw?: unknown): DecryptedMessage {
  return {
    id: stored.id,
    channelId: stored.channelId,
    senderId: stored.senderId,
    text: stored.text,
    timestamp: stored.timestamp,
    attachments: stored.attachments as DecryptedMessage["attachments"],
    linkPreviews: stored.linkPreviews as DecryptedMessage["linkPreviews"],
    contentType: stored.contentType,
    formatting: stored.formatting as object | undefined,
    edited: stored.edited ?? false,
    raw: raw as DecryptedMessage["raw"],
  };
}

/** Store a decrypted message (fire-and-forget). */
export async function idbCacheMessage(msg: DecryptedMessage): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(toStored(msg));
  } catch {
    // IndexedDB not available or quota exceeded — silently fail
  }
}

/** Retrieve a cached message by ID. */
export async function idbGetMessage(messageId: string): Promise<DecryptedMessage | null> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(messageId);
      req.onsuccess = () => {
        const stored = req.result as StoredMessage | undefined;
        resolve(stored ? fromStored(stored) : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Remove a message from the cache. */
export async function idbUncacheMessage(messageId: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(messageId);
  } catch {
    // Silently fail
  }
}

/** Get messages for a channel, ordered by timestamp descending. */
export async function idbGetChannelMessages(
  channelId: string,
  limit = 100,
): Promise<DecryptedMessage[]> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("by-channel");
      const results: DecryptedMessage[] = [];
      const req = index.openCursor(IDBKeyRange.only(channelId), "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && results.length < limit) {
          results.push(fromStored(cursor.value as StoredMessage));
          cursor.continue();
        } else {
          resolve(results.reverse());
        }
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** Evict oldest messages when over the limit. */
export async function idbEvict(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const countReq = store.count();
    countReq.onsuccess = () => {
      const count = countReq.result;
      if (count <= MAX_MESSAGES) return;

      const toDelete = count - MAX_MESSAGES;
      let deleted = 0;
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor && deleted < toDelete) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };
    };
  } catch {
    // Silently fail
  }
}

/** Migrate existing localStorage cache into IndexedDB. */
export async function migrateFromLocalStorage(): Promise<void> {
  const CACHE_KEY = "haven:msg-cache";
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;

    const cache = JSON.parse(raw) as Record<string, {
      sid: string;
      txt: string;
      att?: unknown[];
      lp?: unknown[];
      ct?: string;
      fmt?: unknown;
    }>;

    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    for (const [id, entry] of Object.entries(cache)) {
      store.put({
        id,
        channelId: "", // unknown from old cache format
        senderId: entry.sid,
        text: entry.txt,
        timestamp: new Date().toISOString(),
        ...(entry.att?.length ? { attachments: entry.att } : {}),
        ...(entry.lp?.length ? { linkPreviews: entry.lp } : {}),
        ...(entry.ct ? { contentType: entry.ct } : {}),
        ...(entry.fmt ? { formatting: entry.fmt } : {}),
      });
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Clear old localStorage cache after successful migration
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Migration failed — no data loss, localStorage cache remains
  }
}

/** Clear all cached messages (used on logout). */
export async function idbClearAll(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
  } catch {
    // Silently fail
  }
}

/** Get total message count (for diagnostics). */
export async function idbMessageCount(): Promise<number> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}
