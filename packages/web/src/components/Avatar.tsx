import { useState } from "react";

interface AvatarProps {
  avatarUrl?: string | null;
  name: string;
  size?: number;
  className?: string;
}

export default function Avatar({ avatarUrl, name, size = 32, className = "" }: AvatarProps) {
  const [imgError, setImgError] = useState(false);

  const initial = (name || "?").charAt(0).toUpperCase();

  if (avatarUrl && !imgError) {
    return (
      <img
        className={`avatar avatar-img ${className}`}
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        onError={() => setImgError(true)}
        draggable={false}
      />
    );
  }

  return (
    <div
      className={`avatar avatar-initial ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {initial}
    </div>
  );
}
