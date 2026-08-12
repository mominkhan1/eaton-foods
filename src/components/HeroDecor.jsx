/**
 * Hero decoration.
 *
 * Purely presentational SVG: a paint patch the product shot sits on, ink
 * splashes, and the dashed arrow that points from the headline across to the
 * food. All `aria-hidden` — none of it carries meaning, and a screen reader
 * announcing "image" three times before the offer would be worse than silence.
 *
 * The paint outline is generated rather than drawn by hand (an irregular
 * radius smoothed through Catmull-Rom), which is why it has the uneven,
 * streaked edge a symmetrical blob never gets.
 */

const BRUSH_MAIN =
  'M 407.7 190.0 C 408.2 203.6, 405.7 219.8, 396.9 231.1 C 388.2 242.5, 366.9 249.5, 355.3 258.1 ' +
  'C 343.8 266.7, 336.8 275.0, 327.5 282.9 C 318.1 290.8, 309.4 298.6, 299.3 305.6 ' +
  'C 289.3 312.5, 279.0 321.4, 267.1 324.5 C 255.3 327.5, 240.8 323.8, 228.2 323.9 ' +
  'C 215.6 324.1, 204.6 324.4, 191.6 325.5 C 178.6 326.7, 165.6 329.4, 150.2 330.7 ' +
  'C 134.8 332.1, 119.0 333.4, 99.0 333.5 C 79.1 333.7, 38.9 343.3, 30.7 331.8 ' +
  'C 22.5 320.4, 44.0 283.4, 49.9 265.0 C 55.9 246.6, 61.9 234.1, 66.3 221.6 ' +
  'C 70.8 209.1, 76.5 200.5, 76.7 190.0 C 76.8 179.5, 70.3 170.4, 67.3 158.6 ' +
  'C 64.2 146.7, 57.1 131.6, 58.3 118.9 C 59.5 106.3, 63.7 89.7, 74.4 82.7 ' +
  'C 85.1 75.7, 110.0 82.8, 122.5 76.8 C 134.9 70.8, 138.1 54.1, 149.1 46.7 ' +
  'C 160.1 39.3, 174.4 38.3, 188.6 32.4 C 202.8 26.4, 222.3 4.5, 234.4 10.9 ' +
  'C 246.4 17.2, 249.2 60.9, 260.8 70.5 C 272.4 80.1, 298.8 59.4, 303.9 68.5 ' +
  'C 309.1 77.7, 285.1 115.6, 291.6 125.4 C 298.1 135.3, 325.9 123.7, 342.9 127.7 ' +
  'C 359.9 131.7, 382.9 139.2, 393.7 149.6 C 404.5 160.0, 407.2 176.4, 407.7 190.0 Z';

const BRUSH_FLECK_A =
  'M 58.3 262.0 C 58.6 264.4, 53.3 267.9, 50.3 269.9 C 47.4 271.9, 44.4 273.3, 40.8 274.1 ' +
  'C 37.2 274.8, 31.6 275.8, 28.5 274.5 C 25.5 273.2, 23.2 269.1, 22.4 266.4 ' +
  'C 21.5 263.6, 22.2 260.6, 23.3 257.9 C 24.5 255.3, 26.2 252.0, 29.2 250.4 ' +
  'C 32.2 248.7, 38.0 247.1, 41.2 247.9 C 44.4 248.7, 45.6 253.0, 48.4 255.3 ' +
  'C 51.3 257.7, 58.0 259.6, 58.3 262.0 Z';

const BRUSH_FLECK_B =
  'M 387.7 96.0 C 388.0 98.0, 383.6 100.9, 381.3 102.6 C 379.1 104.3, 376.9 105.6, 374.1 106.3 ' +
  'C 371.4 107.0, 367.0 107.8, 364.7 106.7 C 362.4 105.6, 361.0 102.0, 360.2 99.6 ' +
  'C 359.5 97.2, 359.4 94.6, 360.2 92.4 C 361.1 90.1, 363.0 87.6, 365.3 86.2 ' +
  'C 367.7 84.9, 372.0 83.7, 374.4 84.4 C 376.9 85.1, 377.7 88.4, 379.9 90.4 ' +
  'C 382.1 92.3, 387.5 94.0, 387.7 96.0 Z';

/** The orange paint patch the product shot sits on. */
export function BrushPatch({ className = '' }) {
  return (
    <svg
      viewBox="0 0 440 360"
      className={className}
      aria-hidden="true"
      focusable="false"
      // `meet` keeps the whole ragged outline — `slice` covers the box but
      // crops the top and bottom edges flat, which is exactly the hand-painted
      // quality the shape exists for. Callers scale it up past the photo
      // instead.
      preserveAspectRatio="xMidYMid meet"
    >
      <path d={BRUSH_MAIN} fill="var(--color-brand-500)" />
      <path d={BRUSH_FLECK_A} fill="var(--color-brand-500)" opacity="0.85" />
      <path d={BRUSH_FLECK_B} fill="var(--color-brand-500)" opacity="0.7" />
    </svg>
  );
}

/**
 * Ink splash — droplets flicked off a brush.
 *
 * Built from rotated ellipses rather than drawn teardrop paths: at the sizes
 * these run (48–80px wide) a tapered path renders as a hairline sliver, and a
 * solid ellipse keeps its weight.
 */
export function Splash({ className = '', flip = false }) {
  return (
    <svg
      viewBox="0 0 80 60"
      className={className}
      aria-hidden="true"
      focusable="false"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      <g fill="var(--color-chilli-600)">
        <ellipse cx="17" cy="34" rx="5.6" ry="12.5" transform="rotate(-38 17 34)" />
        <ellipse cx="34" cy="26" rx="4.4" ry="10" transform="rotate(-32 34 26)" />
        <ellipse cx="49" cy="20" rx="3.4" ry="7.6" transform="rotate(-26 49 20)" />
        <circle cx="62" cy="14" r="3.4" />
        <circle cx="70" cy="26" r="2.4" />
        <circle cx="27" cy="49" r="2.8" />
      </g>
    </svg>
  );
}

/**
 * Dashed arrow curving from the headline across to the food, pointing right —
 * it exists to carry the eye from the copy to the product, so it has to run in
 * that direction.
 */
export function DashedArrow({ className = '' }) {
  return (
    <svg viewBox="0 0 150 90" className={className} aria-hidden="true" focusable="false">
      <path
        d="M 8 14 C 42 4, 86 14, 108 44"
        fill="none"
        stroke="var(--color-ink-700)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="1 9"
        opacity="0.7"
      />
      {/* Arrowhead built on the curve's end tangent (22, 30), so it points the
          way the tail is actually travelling — down-right, at the food. */}
      <path d="M 117.4 57 L 101.5 48.7 L 114.5 39.3 Z" fill="var(--color-chilli-600)" />
    </svg>
  );
}
