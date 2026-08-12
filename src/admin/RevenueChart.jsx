import { useState } from 'react';
import { formatPence } from '../lib/money';

/**
 * Single-series revenue column chart.
 *
 * One series means one hue and no legend — the heading names it. Colour is
 * `#e2670f`, validated against the `#221a12` card surface (lightness band,
 * chroma floor and ≥3:1 contrast all pass). Grid and axes stay recessive so
 * the bars carry the reading.
 */

const VIEW = { width: 840, height: 260 };
const PAD = { top: 20, right: 12, bottom: 34, left: 56 };

const PLOT = {
  width: VIEW.width - PAD.left - PAD.right,
  height: VIEW.height - PAD.top - PAD.bottom,
};

const BAR_COLOR = '#e2670f';
const GRID = '#2c2c2a';
const AXIS = '#383835';
const MUTED = '#898781';

/** Bar with rounded data-end, square where it meets the baseline. */
function barPath(x, y, width, height, radius = 4) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return [
    `M${x},${y + height}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${y + height}`,
    'Z',
  ].join(' ');
}

/** A round number at or above `value`, for the top gridline. */
function niceCeiling(value) {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  for (const step of steps) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

export default function RevenueChart({ buckets, granularity }) {
  const [hovered, setHovered] = useState(null);

  const maxRevenue = Math.max(...buckets.map((bucket) => bucket.revenue), 0);
  const ceiling = niceCeiling(maxRevenue);

  const slot = PLOT.width / Math.max(buckets.length, 1);
  // 2px of surface between adjacent bars, per the mark spec.
  const barWidth = Math.max(4, Math.min(slot - 2, 48));

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    fraction,
    value: ceiling * fraction,
    y: PAD.top + PLOT.height * (1 - fraction),
  }));

  // Thin the x labels when the buckets outnumber the space for them.
  const labelEvery = buckets.length > 16 ? Math.ceil(buckets.length / 12) : 1;

  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        className="w-full"
        role="img"
        aria-label={`${granularity} revenue, ${buckets.length} periods. Peak ${formatPence(maxRevenue)}.`}
        onMouseLeave={() => setHovered(null)}
      >
        {ticks.map((tick) => (
          <g key={tick.fraction}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT.width}
              y1={tick.y}
              y2={tick.y}
              stroke={tick.fraction === 0 ? AXIS : GRID}
              strokeWidth={tick.fraction === 0 ? 2 : 1}
            />
            <text
              x={PAD.left - 10}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="11"
              fill={MUTED}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {tick.value === 0 ? '£0' : `£${Math.round(tick.value / 100)}`}
            </text>
          </g>
        ))}

        {buckets.map((bucket, index) => {
          const height = ceiling > 0 ? (bucket.revenue / ceiling) * PLOT.height : 0;
          const x = PAD.left + index * slot + (slot - barWidth) / 2;
          const y = PAD.top + PLOT.height - height;
          const isHovered = hovered?.key === bucket.key;

          return (
            <g key={bucket.key}>
              {/* Hit target spans the whole slot, not just the bar. */}
              <rect
                x={PAD.left + index * slot}
                y={PAD.top}
                width={slot}
                height={PLOT.height}
                fill="transparent"
                onMouseEnter={() => setHovered({ ...bucket, index })}
              />

              {bucket.revenue > 0 && (
                <path
                  d={barPath(x, y, barWidth, height)}
                  fill={BAR_COLOR}
                  opacity={hovered && !isHovered ? 0.45 : 1}
                  pointerEvents="none"
                />
              )}

              {index % labelEvery === 0 && (
                <text
                  x={PAD.left + index * slot + slot / 2}
                  y={VIEW.height - 12}
                  textAnchor="middle"
                  fontSize="11"
                  fill={MUTED}
                  pointerEvents="none"
                >
                  {bucket.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-xl border border-surface-300 bg-surface-0 px-3 py-2 shadow-xl"
          style={{
            left: `${((PAD.left + hovered.index * slot + slot / 2) / VIEW.width) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <p className="text-xs font-semibold text-ink-950">{hovered.label}</p>
          <p className="mt-1 text-sm tabular-nums text-brand-600">
            {formatPence(hovered.revenue)}
          </p>
          <p className="text-xs tabular-nums text-ink-500">
            {hovered.orders} order{hovered.orders === 1 ? '' : 's'}
            {hovered.cancelled > 0 && ` · ${hovered.cancelled} cancelled`}
          </p>
          <p className="text-xs tabular-nums text-ink-500">
            {hovered.delivery} delivery · {hovered.collection} collection
          </p>
        </div>
      )}

      <figcaption className="sr-only">
        Revenue by {granularity} period. A table with the same figures follows.
      </figcaption>
    </figure>
  );
}
