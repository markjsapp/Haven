/**
 * Signal-style safety number derivation for DM identity verification.
 *
 * Both users derive the same 60-digit numeric code from their identity keys.
 * Keys are sorted lexicographically before hashing so both parties get
 * an identical result regardless of who initiates the session.
 */

import { getSodium } from "@haven/core";

export interface SafetyNumber {
  /** 60 digits as a string, no separators */
  digits: string;
  /** 12 groups of 5 digits each */
  groups: string[];
  /** Raw 32-byte SHA-256 hash (for visual fingerprint) */
  hashBytes: Uint8Array;
}

/**
 * Compute a safety number from two identity keys (32 bytes each).
 * Deterministic: sorting ensures both parties get the same result.
 */
export function computeSafetyNumber(
  keyA: Uint8Array,
  keyB: Uint8Array,
): SafetyNumber {
  if (keyA.length !== 32 || keyB.length !== 32) {
    throw new Error("Identity keys must be 32 bytes");
  }

  // Sort lexicographically so both users get the same order
  const cmp = compareBytes(keyA, keyB);
  const first = cmp <= 0 ? keyA : keyB;
  const second = cmp <= 0 ? keyB : keyA;

  // Concatenate and hash
  const combined = new Uint8Array(64);
  combined.set(first, 0);
  combined.set(second, 32);

  const sodium = getSodium();
  const hashBytes: Uint8Array = sodium.crypto_hash_sha256(combined);

  // Convert to 60-digit numeric code
  // Take 30 bytes → 12 groups, each group uses 2.5 bytes (20 bits) → mod 100000
  const digits = bytesToDigits(hashBytes);
  const groups: string[] = [];
  for (let i = 0; i < 60; i += 5) {
    groups.push(digits.slice(i, i + 5));
  }

  return { digits, groups, hashBytes };
}

/**
 * Convert the first 30 bytes of a hash into a 60-digit string.
 * Each pair of 2.5 bytes (taken as 3 bytes per 2 groups) produces
 * two 5-digit numbers via mod 100000.
 */
function bytesToDigits(hash: Uint8Array): string {
  let result = "";
  // Process 12 groups of 5 digits. Use 2.5 bytes per group.
  // Process in pairs: 5 bytes → 2 groups (10 digits)
  for (let i = 0; i < 6; i++) {
    const offset = i * 5;
    // Read 5 bytes as a 40-bit number, split into two 20-bit halves
    const b0 = hash[offset];
    const b1 = hash[offset + 1];
    const b2 = hash[offset + 2];
    const b3 = hash[offset + 3];
    const b4 = hash[offset + 4];

    // First 20 bits (b0, b1, upper 4 of b2)
    const val1 = ((b0 << 12) | (b1 << 4) | (b2 >> 4)) % 100000;
    // Last 20 bits (lower 4 of b2, b3, b4)
    const val2 = (((b2 & 0x0f) << 16) | (b3 << 8) | b4) % 100000;

    result += val1.toString().padStart(5, "0");
    result += val2.toString().padStart(5, "0");
  }
  return result;
}

/** Lexicographic comparison of two equal-length byte arrays. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}
