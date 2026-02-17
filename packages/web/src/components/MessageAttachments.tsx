import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { decryptFile, fromBase64 } from "@haven/core";
import { useAuthStore } from "../store/auth.js";
import ImageLightbox from "./ImageLightbox.js";
import type { AttachmentMeta } from "../store/chat.js";

// Cache decrypted blob URLs to avoid re-downloading
const blobCache = new Map<string, string>();

/** Pre-cache a blob URL for an attachment (used after upload to avoid re-downloading) */
export function preCacheBlobUrl(attachmentId: string, url: string) {
  blobCache.set(attachmentId, url);
}

/** Normalize MIME types for browser compatibility (e.g. video/quicktime → video/mp4) */
function normalizeMime(mime: string): string {
  if (mime === "video/quicktime") return "video/mp4";
  return mime;
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

function isVideo(mime: string) {
  return mime.startsWith("video/");
}

function isAudio(mime: string) {
  return mime.startsWith("audio/");
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
  const { t } = useTranslation();
  const [blobUrl, setBlobUrl] = useState<string | null>(
    blobCache.get(attachment.id) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  const [visible, setVisible] = useState(!!blobCache.get(attachment.id));
  const containerRef = useRef<HTMLDivElement>(null);

  const isMedia = isImage(attachment.mime_type) || isVideo(attachment.mime_type) || isAudio(attachment.mime_type);
  const isSpoiler = attachment.spoiler === true;

  // Lazy-load: only fetch/decrypt when scrolled into view
  useEffect(() => {
    if (visible || !isMedia || blobCache.has(attachment.id)) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [attachment.id, isMedia, visible]);

  useEffect(() => {
    // Auto-fetch when visible (or already cached)
    if (isMedia && visible && !blobUrl && !loading && !error) {
      fetchAndDecrypt();
    }
  }, [attachment.id, isMedia, visible]);

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

      const buf = (decrypted.buffer as ArrayBuffer).slice(
        decrypted.byteOffset,
        decrypted.byteOffset + decrypted.byteLength,
      );
      const blob = new Blob([buf], { type: normalizeMime(attachment.mime_type) });
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

    const showSpoilerOverlay = isSpoiler && !spoilerRevealed;

    return (
      <div className="attachment-image-wrap" style={aspectStyle} ref={containerRef}>
        {/* Show thumbnail as instant preview while full image loads */}
        {!blobUrl && attachment.thumbnail && (
          <>
            <img
              className="attachment-image attachment-thumb"
              src={attachment.thumbnail}
              alt={attachment.filename}
              onClick={() => { if (!loading && error) fetchAndDecrypt(); }}
              style={{ cursor: error ? "pointer" : undefined }}
            />
            {loading && (
              <div className="attachment-thumb-loading">
                <div className="attachment-spinner" />
              </div>
            )}
          </>
        )}
        {loading && !attachment.thumbnail && (
          <div className="attachment-loading">{t("messageAttachments.loading")}</div>
        )}
        {error && !attachment.thumbnail && (
          <div className="attachment-error" onClick={fetchAndDecrypt} style={{ cursor: "pointer" }}>
            {t("messageAttachments.clickToRetry")}
          </div>
        )}
        {error && attachment.thumbnail && (
          <div className="attachment-thumb-loading" onClick={fetchAndDecrypt} style={{ cursor: "pointer" }}>
            <span style={{ fontSize: 12, color: "#fff" }}>{t("messageAttachments.clickToRetry")}</span>
          </div>
        )}
        {blobUrl && (
          <img
            className={`attachment-image${showSpoilerOverlay ? " attachment-spoiler" : ""}`}
            src={blobUrl}
            alt={attachment.filename}
            onClick={() => {
              if (showSpoilerOverlay) {
                setSpoilerRevealed(true);
              } else {
                setLightboxOpen(true);
              }
            }}
          />
        )}
        {showSpoilerOverlay && blobUrl && (
          <div className="spoiler-overlay" onClick={() => setSpoilerRevealed(true)}>
            <span>{t("messageAttachments.spoiler")}</span>
          </div>
        )}
        {lightboxOpen && blobUrl && (
          <ImageLightbox
            src={blobUrl}
            alt={attachment.filename}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </div>
    );
  }

  if (isVideo(attachment.mime_type)) {
    const showSpoilerOverlay = isSpoiler && !spoilerRevealed;

    return (
      <div className="attachment-video-wrap" ref={containerRef}>
        {loading && (
          <div className="attachment-loading">
            <div className="attachment-loading-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5,3 19,12 5,21" fill="currentColor" opacity="0.3" />
              </svg>
            </div>
            <span>{attachment.filename} ({formatFileSize(attachment.size)})</span>
            <span className="attachment-loading-sub">{t("messageAttachments.decrypting")}</span>
          </div>
        )}
        {error && (
          <div className="attachment-error" onClick={fetchAndDecrypt} style={{ cursor: "pointer" }}>
            {t("messageAttachments.clickToRetry")}
          </div>
        )}
        {blobUrl && !showSpoilerOverlay && (
          <>
            <video
              className="attachment-video"
              src={blobUrl}
              controls
              preload="auto"
            />
            <a href={blobUrl} download={attachment.filename} className="attachment-download-link">
              {t("messageAttachments.downloadFile", { filename: attachment.filename })}
            </a>
          </>
        )}
        {blobUrl && showSpoilerOverlay && (
          <div className="spoiler-overlay" onClick={() => setSpoilerRevealed(true)}>
            <span>{t("messageAttachments.spoiler")}</span>
          </div>
        )}
      </div>
    );
  }

  if (isAudio(attachment.mime_type)) {
    return (
      <div ref={containerRef}>
        <AudioPlayer
          blobUrl={blobUrl}
          loading={loading}
          error={error}
          filename={attachment.filename}
          size={attachment.size}
          onRetry={fetchAndDecrypt}
        />
      </div>
    );
  }

  // Generic file
  return (
    <div className="attachment-file" ref={containerRef}>
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
        {loading ? "..." : blobUrl ? t("messageAttachments.open") : t("messageAttachments.download")}
      </button>
      {blobUrl && (
        <a href={blobUrl} download={attachment.filename} className="attachment-file-download">
          {t("messageAttachments.save")}
        </a>
      )}
      {error && <span className="attachment-error-inline">{t("messageAttachments.failed")}</span>}
    </div>
  );
}

/** Inline audio player for .mp3, .wav, .ogg, etc. */
function AudioPlayer({
  blobUrl,
  loading,
  error,
  filename,
  size,
  onRetry,
}: {
  blobUrl: string | null;
  loading: boolean;
  error: boolean;
  filename: string;
  size: number;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeWrapRef = useRef<HTMLDivElement>(null);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play();
    }
  }, [playing]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    const onTimeUpdate = () => { if (!seeking) setCurrentTime(el.currentTime); };
    const onLoaded = () => { if (el.duration && isFinite(el.duration)) setDuration(el.duration); };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("durationchange", onLoaded);

    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("durationchange", onLoaded);
    };
  }, [blobUrl, seeking]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = pct * duration;
    setCurrentTime(pct * duration);
  };

  const handleSeekStart = (e: React.MouseEvent<HTMLDivElement>) => {
    setSeeking(true);
    handleSeek(e);

    const handleMove = (ev: MouseEvent) => {
      const el = audioRef.current;
      if (!el || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      el.currentTime = pct * duration;
      setCurrentTime(pct * duration);
    };
    const handleUp = () => {
      setSeeking(false);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    setMuted(v === 0);
    if (audioRef.current) {
      audioRef.current.volume = v;
      audioRef.current.muted = false;
    }
  };

  // Close volume slider on click outside
  useEffect(() => {
    if (!volumeOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (volumeWrapRef.current && !volumeWrapRef.current.contains(e.target as Node)) {
        setVolumeOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [volumeOpen]);

  const toggleMute = () => {
    const el = audioRef.current;
    if (!el) return;
    if (muted) {
      el.muted = false;
      setMuted(false);
      if (volume === 0) {
        setVolume(0.5);
        el.volume = 0.5;
      }
    } else {
      el.muted = true;
      setMuted(true);
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const fmtTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="audio-player audio-player-loading">
        <div className="attachment-spinner" />
        <span className="audio-filename">{filename}</span>
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className="audio-player audio-player-error" onClick={onRetry} style={{ cursor: "pointer" }}>
        <div className="audio-play-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
        </div>
        <div className="audio-info">
          <span className="audio-filename">{filename}</span>
          <span className="audio-size">{formatFileSize(size)} — {t("messageAttachments.clickToRetry")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="audio-player">
      <audio ref={audioRef} src={blobUrl} preload="metadata" />
      <button className="audio-play-btn" onClick={togglePlay} aria-label={playing ? t("messageAttachments.pauseAriaLabel") : t("messageAttachments.playAriaLabel")}>
        {playing ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <div className="audio-body">
        <div className="audio-info">
          <span className="audio-filename">{filename}</span>
          <span className="audio-time">
            {fmtTime(currentTime)} / {duration > 0 ? fmtTime(duration) : "--:--"}
          </span>
        </div>
        <div className="audio-progress-track" onMouseDown={handleSeekStart}>
          <div className="audio-progress-fill" style={{ width: `${progress}%` }} />
          <div className="audio-progress-thumb" style={{ left: `${progress}%` }} />
        </div>
      </div>
      <div className={`audio-volume-wrap${volumeOpen ? " open" : ""}`} ref={volumeWrapRef}>
        <button
          className="audio-volume-btn"
          onClick={() => setVolumeOpen((v) => !v)}
          onDoubleClick={toggleMute}
          aria-label={muted ? t("messageAttachments.unmuteAriaLabel") : t("messageAttachments.muteAriaLabel")}
        >
          {muted || volume === 0 ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
            </svg>
          ) : volume < 0.5 ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          )}
        </button>
        <div className="audio-volume-slider-wrap">
          <input
            type="range"
            className="audio-volume-slider"
            min="0"
            max="1"
            step="0.01"
            value={muted ? 0 : volume}
            onChange={handleVolumeChange}
          />
        </div>
      </div>
      <a href={blobUrl} download={filename} className="audio-download-btn" aria-label={t("messageAttachments.downloadAriaLabel")} title={t("messageAttachments.download")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
        </svg>
      </a>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
