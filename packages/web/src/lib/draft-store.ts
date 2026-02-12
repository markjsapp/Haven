const STORAGE_KEY = "haven:drafts";

export function saveDraft(channelId: string, tiptapJson: object): void {
  try {
    const drafts = loadAll();
    drafts[channelId] = tiptapJson;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch { /* storage full or unavailable */ }
}

export function loadDraft(channelId: string): object | null {
  try {
    const drafts = loadAll();
    return drafts[channelId] ?? null;
  } catch {
    return null;
  }
}

export function clearDraft(channelId: string): void {
  try {
    const drafts = loadAll();
    delete drafts[channelId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch { /* non-fatal */ }
}

function loadAll(): Record<string, object> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
