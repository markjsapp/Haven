/** Parse channel name from base64-encoded encrypted_meta. */
export function parseChannelName(encryptedMeta: string): string {
  try {
    const json = JSON.parse(atob(encryptedMeta));
    return json.name || json.type || "unnamed";
  } catch {
    return "unnamed";
  }
}

/** Extract the peer user ID from a DM channel's meta. */
export function parseDmPeerId(encryptedMeta: string, myUserId: string): string | null {
  try {
    const json = JSON.parse(atob(encryptedMeta));
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
    const json = JSON.parse(atob(encryptedMeta));
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
    const decoded = atob(encryptedMeta);
    const json = JSON.parse(decoded);
    return json.name || "unnamed";
  } catch {
    try {
      return atob(encryptedMeta) || "unnamed";
    } catch {
      return "unnamed";
    }
  }
}

/** Parse a channel's display info for the chat header. */
export function parseChannelDisplay(
  encryptedMeta: string,
  myUserId: string,
): { name: string; isDm: boolean } {
  try {
    const json = JSON.parse(atob(encryptedMeta));
    if (json.type === "dm") {
      if (json.names) {
        for (const [id, name] of Object.entries(json.names)) {
          if (id !== myUserId) return { name: name as string, isDm: true };
        }
      }
      return { name: "DM", isDm: true };
    }
    return { name: json.name || "unnamed", isDm: false };
  } catch {
    return { name: "unnamed", isDm: false };
  }
}

/** Parse names map from channel encrypted_meta (for message display). */
export function parseNamesFromMeta(encryptedMeta?: string): Record<string, string> {
  if (!encryptedMeta) return {};
  try {
    const json = JSON.parse(atob(encryptedMeta));
    return json.names ?? {};
  } catch {
    return {};
  }
}
