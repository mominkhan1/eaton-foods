import { useEffect, useState } from 'react';
import { getImageUrl, peekImageUrl } from '../lib/images';

/**
 * Resolve a stored image id to an object URL.
 *
 * The cached URL is read during render rather than pushed into state by an
 * effect, so a re-render never flashes the fallback for an image that is
 * already loaded, and no cascading render is triggered.
 */
export function useImageUrl(imageId) {
  // Tagged with the id it belongs to, so a change of item can't briefly show
  // the previous item's photo.
  const [resolved, setResolved] = useState({ id: null, url: null });

  useEffect(() => {
    if (!imageId || peekImageUrl(imageId)) return undefined;

    let cancelled = false;
    getImageUrl(imageId).then((url) => {
      if (!cancelled) setResolved({ id: imageId, url });
    });

    return () => {
      cancelled = true;
    };
  }, [imageId]);

  if (!imageId) return null;
  return peekImageUrl(imageId) ?? (resolved.id === imageId ? resolved.url : null);
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
      className={`${className} ${rounded} grid place-items-center bg-surface-0 ${emojiClass}`}
      aria-hidden={alt ? undefined : 'true'}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
    >
      {emoji ?? '🍽️'}
    </span>
  );
}
