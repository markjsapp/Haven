import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LinkPreview } from "../store/chat.js";

type EmbedType = "youtube" | "spotify" | "image" | "gif_service" | "default";

/** Match URLs pointing directly to an image file */
const IMAGE_EXT_RE = /\.(?:gif|png|jpe?g|webp|avif|apng|svg)(?:\?[^\s]*)?$/i;

/** Known GIF/image hosting services — render their OG image as an inline embed */
const GIF_HOST_RE = /(?:tenor\.com(?:\/view)?|giphy\.com\/gifs|media[0-9]*\.giphy\.com|i\.imgur\.com)\//i;

function detectEmbedType(url: string): { type: EmbedType; id?: string; subtype?: string } {
  // YouTube
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch) return { type: "youtube", id: ytMatch[1] };

  // Spotify
  const spotifyMatch = url.match(
    /open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/
  );
  if (spotifyMatch) return { type: "spotify", subtype: spotifyMatch[1], id: spotifyMatch[2] };

  // Direct image URL (e.g., https://example.com/cat.gif)
  try {
    const { pathname } = new URL(url);
    if (IMAGE_EXT_RE.test(pathname)) return { type: "image" };
  } catch {
    if (IMAGE_EXT_RE.test(url)) return { type: "image" };
  }

  // GIF hosting services (Tenor, Giphy, Imgur)
  if (GIF_HOST_RE.test(url)) return { type: "gif_service" };

  return { type: "default" };
}

export default function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  const { t } = useTranslation();
  const embed = detectEmbedType(preview.url);
  const [imgError, setImgError] = useState(false);

  if (embed.type === "youtube" && embed.id) {
    return (
      <div className="embed-youtube">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${embed.id}`}
          width="400"
          height="225"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          title={t("linkPreview.youtubeTitle")}
        />
      </div>
    );
  }

  if (embed.type === "spotify" && embed.id && embed.subtype) {
    return (
      <div className="embed-spotify">
        <iframe
          src={`https://open.spotify.com/embed/${embed.subtype}/${embed.id}`}
          width="300"
          height={embed.subtype === "track" ? 80 : 152}
          allow="encrypted-media"
          loading="lazy"
          title={t("linkPreview.spotifyTitle")}
        />
      </div>
    );
  }

  // Direct image embed (GIF, PNG, JPG, etc.)
  if (embed.type === "image" && !imgError) {
    const imgSrc = preview.image || preview.url;
    return (
      <a
        className="embed-image"
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <img
          src={imgSrc}
          alt=""
          loading="lazy"
          onError={() => setImgError(true)}
        />
      </a>
    );
  }

  // GIF service embed (Tenor, Giphy) — show the OG image as an inline embed
  if (embed.type === "gif_service" && preview.image && !imgError) {
    return (
      <a
        className="embed-image"
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <img
          src={preview.image}
          alt={preview.title || ""}
          loading="lazy"
          onError={() => setImgError(true)}
        />
      </a>
    );
  }

  // Default card (with fallback if image embed failed)
  const hasImage = !!preview.image;
  const hasText = preview.title || preview.description || preview.site_name;

  // If there's no text metadata and no image, don't render anything
  if (!hasText && !hasImage) return null;

  return (
    <a
      className="link-preview-card"
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {hasImage && (
        <img
          className="link-preview-image"
          src={preview.image}
          alt=""
          loading="lazy"
        />
      )}
      {hasText && (
        <div className="link-preview-text">
          {preview.site_name && (
            <span className="link-preview-site">{preview.site_name}</span>
          )}
          {preview.title && (
            <span className="link-preview-title">{preview.title}</span>
          )}
          {preview.description && (
            <span className="link-preview-desc">{preview.description}</span>
          )}
        </div>
      )}
    </a>
  );
}
