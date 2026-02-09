//! Server-side cryptographic utilities.
//!
//! IMPORTANT: The heavy cryptographic lifting (E2EE, Double Ratchet, Sender Keys)
//! happens entirely on the CLIENT. The server is intentionally a "dumb relay" for
//! encrypted blobs.
//!
//! This module handles only server-side needs:
//! - Generating cryptographically secure random tokens
//! - Hashing (for token storage, not for encryption)
//! - Validating key format/length (not the keys' cryptographic properties)

use rand::Rng;

/// Minimum acceptable key length for X25519 public keys (32 bytes).
pub const X25519_KEY_LENGTH: usize = 32;

/// Validate that a public key is the correct length for X25519.
pub fn validate_x25519_key(key: &[u8]) -> bool {
    key.len() == X25519_KEY_LENGTH
}

/// Generate a cryptographically secure random byte vector.
pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut rng = rand::thread_rng();
    (0..len).map(|_| rng.gen()).collect()
}

/// Generate a random invite code (URL-safe, 12 characters).
pub fn generate_invite_code() -> String {
    let bytes = random_bytes(9); // 9 bytes = 12 base64url chars
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &bytes)
}

/// Determine the size bucket for an attachment (for metadata obfuscation).
/// Files are padded to these fixed sizes to prevent type inference from size.
pub fn size_bucket(actual_size: u64) -> i32 {
    match actual_size {
        0..=1_048_576 => 1,         // ≤1MB → bucket 1
        1_048_577..=5_242_880 => 5,  // ≤5MB → bucket 5
        5_242_881..=26_214_400 => 25, // ≤25MB → bucket 25
        _ => 100,                     // ≤100MB → bucket 100
    }
}
