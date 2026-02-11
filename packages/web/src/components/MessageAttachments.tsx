import { useEffect, useState } from "react";
import { decryptFile, fromBase64 } from "@haven/core";
import { useAuthStore } from "../store/auth.js";
import type { AttachmentMeta } from "../store/chat.js";

// Cache decrypted blob URLs to avoid re-downloading
const blobCache = new Map<string, string>();

function isImage(mime: string) {
  return mime.startsWith("image/");
}

function isVideo(mime: string) {
  return mime.startsWith("video/");
}

export default function MessageAttachments({ attachments }: { attachments: AttachmentMeta[] }) {
  return (
    <div className="attachment-grid">
      {attachments.map((att) => (
        <AttachmentItem key={att.id} attachment={att} />
      ))}
    </div>
  );
}

function AttachmentItem({ attachment }: { attachment: AttachmentMeta }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(
    blobCache.get(attachment.id) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const isMedia = isImage(attachment.mime_type) || isVideo(attachment.mime_type);

  useEffect(() => {
    // Auto-fetch images/videos
    if (isMedia && !blobUrl && !loading) {
      fetchAndDecrypt();
    }
  }, [attachment.id]);

  async function fetchAndDecrypt() {
    if (blobCache.has(attachment.id)) {
      setBlobUrl(blobCache.get(attachment.id)!);
      return;
    }

    setLoading(true);
    setError(false);

    try {
      const { api } = useAuthStore.getState();

      // Download encrypted blob directly from backend
      const encryptedBuf = await api.downloadAttachment(attachment.id);
      const encryptedBytes = new Uint8Array(encryptedBuf);

      // Decrypt client-side E2EE layer
      const key = fromBase64(attachment.key);
      const nonce = fromBase64(attachment.nonce);
      const decrypted = decryptFile(encryptedBytes, key, nonce);

      const decryptedBuf = (decrypted.buffer as ArrayBuffer).slice(
        decrypted.byteOffset,
        decrypted.byteOffset + decrypted.byteLength,
      );
      const blob = new Blob([decryptedBuf], { type: attachment.mime_type });
      const url = URL.createObjectURL(blob);
      blobCache.set(attachment.id, url);
      setBlobUrl(url);
    } catch (err) {
      console.error("Attachment fetch/decrypt failed:", attachment.id, err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  if (isImage(attachment.mime_type)) {
    // Compute aspect-ratio style from dimensions if available
    const aspectStyle = attachment.width && attachment.height
      ? { aspectRatio: `${attachment.width} / ${attachment.height}` }
      : undefined;

    return (
      <div className="attachment-image-wrap" style={aspectStyle}>
        {/* Show thumbnail as instant preview while full image loads */}
        {!blobUrl && attachment.thumbnail && (
          <img
            className="attachment-image attachment-thumb"
            src={attachment.thumbnail}
            alt={attachment.filename}
          />
        )}
        {loading && !attachment.thumbnail && (
          <div className="attachment-loading">Loading...</div>
        )}
        {error && <div className="attachment-error">Failed to load image</div>}
        {blobUrl && (
          <img
            className="attachment-image"
            src={blobUrl}
            alt={attachment.filename}
            loading="lazy"
          />
        )}
      </div>
    );
  }

  if (isVideo(attachment.mime_type)) {
    return (
      <div className="attachment-video-wrap">
        {loading && <div className="attachment-loading">Loading...</div>}
        {error && <div className="attachment-error">Failed to load video</div>}
        {blobUrl && (
          <video
            className="attachment-video"
            src={blobUrl}
            controls
            preload="metadata"
          />
        )}
      </div>
    );
  }

  // Generic file
  return (
    <div className="attachment-file">
      <div className="attachment-file-icon">📎</div>
      <div className="attachment-file-info">
        <span className="attachment-file-name">{attachment.filename}</span>
        <span className="attachment-file-size">{formatFileSize(attachment.size)}</span>
      </div>
      <button
        className="attachment-file-download"
        onClick={fetchAndDecrypt}
        disabled={loading}
      >
        {loading ? "..." : blobUrl ? "Open" : "Download"}
      </button>
      {blobUrl && (
        <a href={blobUrl} download={attachment.filename} className="attachment-file-download">
          Save
        </a>
      )}
      {error && <span className="attachment-error-inline">Failed</span>}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
