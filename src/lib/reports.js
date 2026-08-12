/**
 * Revenue reporting.
 *
 * The heavy lifting is SQL: `GET /api/admin/reports` sums and groups in the
 * database rather than shipping every order to the browser to add up. A year
 * of trading is a lot of rows to pull onto a tablet, and the totals have to be
 * the same whichever device asks.
 *
 * What is left here is presentation: the endpoint returns one row per trading
 * day, and this rolls those days up into the weekly and monthly views, filling
 * the gaps so a quiet day shows as a zero rather than vanishing from the chart.
 *
 * Buckets are cut on the shop's own dates — the endpoint groups by local date
 * for the same reason — so a 1am order on a late-night shift belongs to the
 * day the shop calls it.
 */

import { DAY_NAMES } from './hours.js';

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

/** How many buckets each granularity shows, and how many days that spans. */
export const WINDOW_DAYS = {
  [GRANULARITY.DAILY]: 14,
  [GRANULARITY.WEEKLY]: 84, // 12 weeks
  [GRANULARITY.MONTHLY]: 365,
};

function pad(value) {
  return String(value).padStart(2, '0');
}

/** 'YYYY-MM-DD' → the parts, without going near a timezone. */
function parseDateKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return { year, month, day };
}

function dateKey({ year, month, day }) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** ISO weekday, 1 = Monday. Computed from the calendar date, not a Date. */
function isoDayOf({ year, month, day }) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function addDays(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** The calendar date that starts the bucket containing `parts`. */
export function bucketStartOf(parts, granularity) {
  if (granularity === GRANULARITY.MONTHLY) return { ...parts, day: 1 };
  if (granularity === GRANULARITY.WEEKLY) return addDays(parts, -(isoDayOf(parts) - 1));
  return parts;
}

function bucketLabel(parts, granularity) {
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day)),
  );

  if (granularity === GRANULARITY.MONTHLY) return `${month} ${String(parts.year).slice(2)}`;
  if (granularity === GRANULARITY.WEEKLY) return `${parts.day} ${month}`;
  return `${DAY_NAMES[isoDayOf(parts)].slice(0, 3)} ${parts.day}`;
}

function previousBucketStart(parts, granularity) {
  if (granularity === GRANULARITY.MONTHLY) {
    return parts.month === 1
      ? { year: parts.year - 1, month: 12, day: 1 }
      : { ...parts, month: parts.month - 1 };
  }
  return addDays(parts, granularity === GRANULARITY.WEEKLY ? -7 : -1);
}

/**
 * The date range to request for a granularity, as 'YYYY-MM-DD' strings.
 *
 * Runs back from today so the newest bucket is the one in progress, which is
 * what the shop is actually looking at.
 */
export function reportRange(granularity, today = new Date()) {
  const to = {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    day: today.getDate(),
  };

  return { from: dateKey(addDays(to, -(WINDOW_DAYS[granularity] - 1))), to: dateKey(to) };
}

/**
 * Roll the endpoint's daily rows up into buckets.
 *
 * `daily` is `[{ date, orders, revenuePence }]` as returned by the API.
 */
export function buildReport({ granularity = GRANULARITY.DAILY, daily = [], today = new Date() }) {
  const bucketCount =
    granularity === GRANULARITY.DAILY ? 14 : granularity === GRANULARITY.WEEKLY ? 12 : 12;

  // Walk back from the current bucket so the range is continuous.
  const starts = [];
  let cursor = bucketStartOf(
    { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() },
    granularity,
  );

  for (let index = 0; index < bucketCount; index += 1) {
    starts.unshift(cursor);
    cursor = previousBucketStart(cursor, granularity);
  }

  const buckets = starts.map((start) => ({
    key: dateKey(start),
    label: bucketLabel(start, granularity),
    start,
    revenue: 0,
    orders: 0,
  }));

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  for (const row of daily) {
    const bucket = byKey.get(dateKey(bucketStartOf(parseDateKey(row.date), granularity)));
    if (!bucket) continue;

    bucket.revenue += row.revenuePence ?? 0;
    bucket.orders += row.orders ?? 0;
  }

  const current = buckets[buckets.length - 1];
  const previous = buckets[buckets.length - 2];
  const change =
    previous && previous.revenue > 0
      ? ((current.revenue - previous.revenue) / previous.revenue) * 100
      : null;

  return {
    granularity,
    buckets,
    current,
    previous,
    changePercent: change,
    peak: buckets.reduce(
      (best, bucket) => (bucket.revenue > best.revenue ? bucket : best),
      buckets[0],
    ),
  };
}
