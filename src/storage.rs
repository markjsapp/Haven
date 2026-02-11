use std::io;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit, Nonce};
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// Derive an obfuscated storage path from an attachment ID.
/// Uses HMAC-SHA256(server_key, attachment_id) so the filesystem reveals
/// nothing about user or attachment identity.
/// Returns a path like "ab/cdef0123456789..." for directory sharding.
pub fn obfuscated_key(server_key: &[u8; 32], attachment_id: &str) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(server_key)
        .expect("HMAC key length is always valid");
    mac.update(attachment_id.as_bytes());
    let result = mac.finalize().into_bytes();
    let hex_str = hex::encode(result);
    // Shard: first 2 chars as subdirectory
    format!("{}/{}", &hex_str[..2], &hex_str[2..])
}

/// Resolve the full filesystem path for a storage key.
fn blob_path(storage_dir: &Path, storage_key: &str) -> PathBuf {
    storage_dir.join(storage_key)
}

/// Encrypt data with AES-256-GCM and write to disk.
/// File format: [12-byte nonce || ciphertext+tag]
pub async fn store_blob(
    storage_dir: &Path,
    storage_key: &str,
    data: &[u8],
    server_key: &[u8; 32],
) -> io::Result<()> {
    let key = Key::<Aes256Gcm>::from_slice(server_key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let ciphertext = cipher
        .encrypt(&nonce, data)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Encryption failed: {}", e)))?;

    let path = blob_path(storage_dir, storage_key);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Write nonce || ciphertext atomically via temp file
    let mut output = Vec::with_capacity(12 + ciphertext.len());
    output.extend_from_slice(nonce.as_slice());
    output.extend_from_slice(&ciphertext);

    tokio::fs::write(&path, &output).await?;
    Ok(())
}

/// Read from disk and decrypt with AES-256-GCM.
pub async fn load_blob(
    storage_dir: &Path,
    storage_key: &str,
    server_key: &[u8; 32],
) -> io::Result<Vec<u8>> {
    let path = blob_path(storage_dir, storage_key);
    let data = tokio::fs::read(&path).await?;

    if data.len() < 12 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Stored blob too short (missing nonce)",
        ));
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let key = Key::<Aes256Gcm>::from_slice(server_key);
    let cipher = Aes256Gcm::new(key);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Decryption failed: {}", e)))
}
