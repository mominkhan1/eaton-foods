import { useMemo } from 'react';

/**
 * Drifting embers.
 *
 * Deliberately CSS-only: no rAF loop, no canvas, no JavaScript running while
 * someone is trying to order. The browser composites these on the GPU and
 * throttles them itself when the tab is hidden.
 *
 * The layer is `fixed` and `pointer-events-none`, so it never intercepts a tap
 * on a menu card, and `aria-hidden` because it means nothing.
 */

const COUNT = 18;

/** Deterministic pseudo-random, so the layout does not reshuffle on re-render. */
function seeded(index, salt) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export default function Embers({ intensity = 0.5 }) {
  const embers = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, index) => {
        const size = 2 + seeded(index, 1) * 4;

        return {
          id: index,
          left: `${seeded(index, 2) * 100}%`,
          size: `${size}px`,
          // Bigger embers rise slower — reads as heavier, and avoids a
          // uniform "everything moves at one speed" look.
          duration: `${14 + seeded(index, 3) * 16 + size}s`,
          delay: `${-seeded(index, 4) * 30}s`,
          drift: `${(seeded(index, 5) - 0.5) * 160}px`,
          peak: 0.25 + seeded(index, 6) * 0.55,
        };
      }),
    [],
  );

  if (intensity <= 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ opacity: intensity }}
    >
      {embers.map((ember) => (
        <span
          key={ember.id}
          className="ember"
          style={{
            left: ember.left,
            width: ember.size,
            height: ember.size,
            animationDuration: ember.duration,
            animationDelay: ember.delay,
            '--ember-drift': ember.drift,
            '--ember-peak': ember.peak,
          }}
        />
      ))}
    </div>
  );
}
