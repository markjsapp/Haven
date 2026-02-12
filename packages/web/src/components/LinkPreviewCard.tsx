import type { LinkPreview } from "../store/chat.js";

type EmbedType = "youtube" | "spotify" | "default";

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

  return { type: "default" };
}

export default function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  const embed = detectEmbedType(preview.url);

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
          title="YouTube video"
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
          title="Spotify embed"
        />
      </div>
    );
  }

  // Default card
  const hasImage = !!preview.image;

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
    </a>
  );
}
