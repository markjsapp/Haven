import { unicodeAtob } from "./base64.js";

/** Parse channel name from base64-encoded encrypted_meta. */
export function parseChannelName(encryptedMeta: string): string {
  try {
    const decoded = unicodeAtob(encryptedMeta);
    const json = JSON.parse(decoded);
    return json.name || json.type || "unnamed";
  } catch {
    // Not JSON — treat the raw decoded string as the channel name
    try {
      return unicodeAtob(encryptedMeta) || "unnamed";
    } catch {
      return "unnamed";
    }
  }
}

/** Extract the peer user ID from a DM channel's meta. */
export function parseDmPeerId(encryptedMeta: string, myUserId: string): string | null {
  try {
    const json = JSON.parse(unicodeAtob(encryptedMeta));
    if (json.participants) {
      return json.participants.find((p: string) => p !== myUserId) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Get the display name for the other party in a DM channel. */
export function parseDmDisplayName(encryptedMeta: string, myUserId: string): string {
  try {
    const json = JSON.parse(unicodeAtob(encryptedMeta));
    if (json.names) {
      for (const [id, name] of Object.entries(json.names)) {
        if (id !== myUserId) return name as string;
      }
    }
    if (json.participants) {
      const other = json.participants.find((p: string) => p !== myUserId);
      if (other) return other.slice(0, 8);
    }
    return "DM";
  } catch {
    return "DM";
  }
}

/** Parse server name from base64-encoded encrypted_meta. */
export function parseServerName(encryptedMeta: string): string {
  try {
    const decoded = unicodeAtob(encryptedMeta);
    const json = JSON.parse(decoded);
    return json.name || "unnamed";
  } catch {
    try {
      return unicodeAtob(encryptedMeta) || "unnamed";
    } catch {
      return "unnamed";
    }
  }
}

/** Parse a channel's display info for the chat header. */
export function parseChannelDisplay(
  encryptedMeta: string,
  myUserId: string,
): { name: string; isDm: boolean; isGroup: boolean; topic?: string } {
  try {
    const json = JSON.parse(unicodeAtob(encryptedMeta));
    if (json.type === "dm") {
      if (json.names) {
        for (const [id, name] of Object.entries(json.names)) {
          if (id !== myUserId) return { name: name as string, isDm: true, isGroup: false };
        }
      }
      return { name: "DM", isDm: true, isGroup: false };
    }
    if (json.type === "group") {
      const name = parseGroupDisplayName(json, myUserId);
      return { name, isDm: false, isGroup: true };
    }
    return { name: json.name || "unnamed", isDm: false, isGroup: false, topic: json.topic || undefined };
  } catch {
    // Not JSON — treat raw decoded string as channel name
    try {
      const raw = unicodeAtob(encryptedMeta);
      if (raw) return { name: raw, isDm: false, isGroup: false };
    } catch { /* fall through */ }
    return { name: "unnamed", isDm: false, isGroup: false };
  }
}

/** Get display name for a group DM channel. */
export function parseGroupName(encryptedMeta: string, myUserId: string): string {
  try {
    const json = JSON.parse(unicodeAtob(encryptedMeta));
    return parseGroupDisplayName(json, myUserId);
  } catch {
    return "Group";
  }
}

/** Internal helper: get group display name from parsed JSON meta. */
function parseGroupDisplayName(json: Record<string, unknown>, myUserId: string): string {
  if (json.name && typeof json.name === "string") return json.name;
  // Build name from participant names, excluding self
  if (json.names && typeof json.names === "object") {
    const names = Object.entries(json.names as Record<string, string>)
      .filter(([id]) => id !== myUserId)
      .map(([, name]) => name);
    if (names.length > 0) return names.join(", ");
  }
  // Fall back to participant count
  const participants = json.participants as string[] | undefined;
  if (participants) return `Group (${participants.length})`;
  return "Group";
}

/** Get member count from a group channel's meta. */
export function parseGroupMemberCount(encryptedMeta: string): number {
  try {
    const json = JSON.parse(unicodeAtob(encryptedMeta));
    if (Array.isArray(json.participants)) return json.participants.length;
    return 0;
  } catch {
    return 0;
  }
}

/** Parse names map from channel encrypted_meta (for message display). */
export function parseNamesFromMeta(encryptedMeta?: string): Record<string, string> {
  if (!encryptedMeta) return {};
  try {
    const json = JSON.parse(unicodeAtob(encryptedMeta));
    return json.names ?? {};
  } catch {
    return {};
  }
}
