/**
 * Revenue reporting.
 *
 * Buckets are cut in the *store's* timezone, not the browser's — a 1am order
 * on a late-night shift belongs to the day the shop calls it, and a report run
 * from another timezone must not shift the totals.
 *
 * Cancelled orders are excluded from revenue everywhere but still counted, so
 * the cancellation rate stays visible.
 */

import { ORDER_TYPE } from '../data/store.js';
import { storeParts, fromStoreWallTime, DAY_NAMES } from './hours.js';
import { listOrders } from './repository.js';

export const GRANULARITY = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
};

export const GRANULARITY_LABELS = {
  [GRANULARITY.DAILY]: 'Daily',
  [GRANULARITY.WEEKLY]: 'Weekly',
  [GRANULARITY.MONTHLY]: 'Monthly',
};

/** How many buckets each granularity shows by default. */
const DEFAULT_BUCKETS = {
  [GRANULARITY.DAILY]: 14,
  [GRANULARITY.WEEKLY]: 12,
  [GRANULARITY.MONTHLY]: 12,
};

const DAY_MS = 86400000;

function pad(value) {
  return String(value).padStart(2, '0');
}

/** Store-local midnight that starts the bucket containing `date`. */
function bucketStart(date, granularity) {
  const parts = storeParts(date);

  if (granularity === GRANULARITY.MONTHLY) {
    return fromStoreWallTime(parts.year, parts.month, 1, 0);
  }

  const midnight = fromStoreWallTime(parts.year, parts.month, parts.day, 0);

  if (granularity === GRANULARITY.WEEKLY) {
    // ISO weeks start Monday; `isoDay` is 1–7.
    return new Date(midnight.getTime() - (parts.isoDay - 1) * DAY_MS);
  }

  return midnight;
}

function bucketKey(date, granularity) {
  const parts = storeParts(bucketStart(date, granularity));

  if (granularity === GRANULARITY.MONTHLY) return `${parts.year}-${pad(parts.month)}`;
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function bucketLabel(date, granularity) {
  const parts = storeParts(date);
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(date);

  if (granularity === GRANULARITY.MONTHLY) return `${month} ${String(parts.year).slice(2)}`;
  if (granularity === GRANULARITY.WEEKLY) return `${parts.day} ${month}`;
  return `${DAY_NAMES[parts.isoDay].slice(0, 3)} ${parts.day}`;
}

/** Step back one bucket from a bucket-start instant. */
function previousBucket(start, granularity) {
  if (granularity === GRANULARITY.MONTHLY) {
    const parts = storeParts(start);
    const month = parts.month === 1 ? 12 : parts.month - 1;
    const year = parts.month === 1 ? parts.year - 1 : parts.year;
    return fromStoreWallTime(year, month, 1, 0);
  }

  const days = granularity === GRANULARITY.WEEKLY ? 7 : 1;
  // Re-derive from wall time so a DST shift doesn't drift the boundary.
  return bucketStart(new Date(start.getTime() - days * DAY_MS + DAY_MS / 2), granularity);
}

function emptyBucket(start, granularity) {
  return {
    key: bucketKey(start, granularity),
    label: bucketLabel(start, granularity),
    start,
    revenue: 0,
    orders: 0,
    delivery: 0,
    collection: 0,
    deliveryRevenue: 0,
    collectionRevenue: 0,
    cancelled: 0,
    discount: 0,
  };
}

export function isCounted(order) {
  return order.status !== 'cancelled';
}

/**
 * Bucketed series plus headline totals.
 *
 * `buckets` always spans a continuous range ending at the current bucket, so
 * quiet days appear as zeroes rather than vanishing from the chart.
 */
export function buildReport({
  granularity = GRANULARITY.DAILY,
  bucketCount,
  orders = listOrders(),
  now = new Date(),
} = {}) {
  const count = bucketCount ?? DEFAULT_BUCKETS[granularity];

  // Walk back from the current bucket to build the continuous range.
  const starts = [];
  let cursor = bucketStart(now, granularity);
  for (let index = 0; index < count; index += 1) {
    starts.unshift(cursor);
    cursor = previousBucket(cursor, granularity);
  }

  const buckets = starts.map((start) => emptyBucket(start, granularity));
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  const earliest = starts[0].getTime();

  const totals = {
    revenue: 0,
    orders: 0,
    delivery: 0,
    collection: 0,
    deliveryRevenue: 0,
    collectionRevenue: 0,
    cancelled: 0,
    discount: 0,
    items: 0,
  };

  for (const order of orders) {
    const placed = new Date(order.placedAt);
    if (Number.isNaN(placed.getTime()) || placed.getTime() < earliest) continue;

    const bucket = byKey.get(bucketKey(placed, granularity));
    if (!bucket) continue;

    if (!isCounted(order)) {
      bucket.cancelled += 1;
      totals.cancelled += 1;
      continue;
    }

    const revenue = order.totals?.total ?? 0;
    const isDelivery = order.orderType === ORDER_TYPE.DELIVERY;

    bucket.revenue += revenue;
    bucket.orders += 1;
    bucket.discount += order.totals?.discount ?? 0;
    totals.revenue += revenue;
    totals.orders += 1;
    totals.discount += order.totals?.discount ?? 0;
    totals.items += order.totals?.itemCount ?? 0;

    if (isDelivery) {
      bucket.delivery += 1;
      bucket.deliveryRevenue += revenue;
      totals.delivery += 1;
      totals.deliveryRevenue += revenue;
    } else {
      bucket.collection += 1;
      bucket.collectionRevenue += revenue;
      totals.collection += 1;
      totals.collectionRevenue += revenue;
    }
  }

  totals.averageOrderValue = totals.orders > 0 ? Math.round(totals.revenue / totals.orders) : 0;

  // Compare the newest complete-so-far bucket with the one before it.
  const current = buckets[buckets.length - 1];
  const previous = buckets[buckets.length - 2];
  const change =
    previous && previous.revenue > 0
      ? ((current.revenue - previous.revenue) / previous.revenue) * 100
      : null;

  return {
    granularity,
    buckets,
    totals,
    current,
    previous,
    changePercent: change,
    peak: buckets.reduce((best, bucket) => (bucket.revenue > best.revenue ? bucket : best), buckets[0]),
  };
}

/** Best sellers across the reporting window, by units sold. */
export function topItems({ orders = listOrders(), since = null, limit = 8 } = {}) {
  const tally = new Map();

  for (const order of orders) {
    if (!isCounted(order)) continue;
    if (since && new Date(order.placedAt).getTime() < since.getTime()) continue;

    for (const line of order.lines ?? []) {
      const existing = tally.get(line.itemId) ?? {
        itemId: line.itemId,
        name: line.name,
        emoji: line.emoji,
        imageId: line.imageId ?? null,
        quantity: 0,
        revenue: 0,
      };

      const unit =
        line.sizePence + (line.modifiers ?? []).reduce((sum, m) => sum + m.pricePence, 0);

      existing.quantity += line.quantity;
      existing.revenue += unit * line.quantity;
      tally.set(line.itemId, existing);
    }
  }

  return [...tally.values()].sort((a, b) => b.quantity - a.quantity).slice(0, limit);
}
