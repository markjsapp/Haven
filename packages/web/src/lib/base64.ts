/** Unicode-safe btoa: encodes a JS string to base64, handling multi-byte characters. */
export function unicodeBtoa(str: string): string {
  return btoa(
    Array.from(new TextEncoder().encode(str), (b) => String.fromCharCode(b)).join("")
  );
}

/** Unicode-safe atob: decodes base64 back to a JS string, handling multi-byte characters. */
export function unicodeAtob(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
