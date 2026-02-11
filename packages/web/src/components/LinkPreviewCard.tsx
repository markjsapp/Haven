import type { LinkPreview } from "../store/chat.js";

export default function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
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
