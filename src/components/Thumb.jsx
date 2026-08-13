import { useState } from 'react';
import { getImageUrl } from '../lib/images';

/**
 * Resolve a stored image id to its public URL.
 *
 * A plain lookup: the URL arrives with the catalog, so there is nothing to
 * await and no effect to run. An id the registry has never seen resolves to
 * null and the caller falls back to its emoji — which is what happens for an
 * order line whose item has since had its photo removed.
 */
export function useImageUrl(imageId) {
  return getImageUrl(imageId);
}

/**
 * Square thumbnail: the uploaded photo when there is one, the emoji otherwise.
 *
 * The emoji fallback is not a placeholder to be removed later — a shop will
 * always have items it has not photographed, and an empty grey box looks
 * broken in a way an emoji does not.
 */
export default function Thumb({
  imageId,
  emoji,
  // For placeholders that are ours rather than the shop's — a banner slide has
  // no emoji of its own, so it passes an icon instead.
  icon,
  alt = '',
  className = '',
  rounded = 'rounded-xl',
  emojiClass = 'text-3xl',
}) {
  const url = useImageUrl(imageId);
  // Remembering *which* URL failed avoids an effect to reset the flag.
  const [failedUrl, setFailedUrl] = useState(null);

  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(url)}
        className={`${className} ${rounded} object-cover`}
      />
    );
  }

  return (
    <span
      className={`${className} ${rounded} grid place-items-center bg-surface-0 ${
        icon ? 'text-ink-500/50' : emojiClass
      }`}
      aria-hidden={alt ? undefined : 'true'}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
    >
      {icon ?? emoji ?? '🍽️'}
    </span>
  );
}
