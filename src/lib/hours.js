/**
 * Trading-hours engine.
 *
 * All reasoning happens in the store's timezone (`Europe/London`), not the
 * browser's, so a customer ordering from another timezone still sees the
 * shop's real opening state.
 */

import { storeConfig, orderSetup, ORDER_TYPE } from '../data/store.js';
import { getHours, MANUAL_STATUS } from './repository.js';

const TZ = storeConfig.timeZone;

const PART_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

const WEEKDAY_TO_ISO = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export const DAY_NAMES = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

/** Break an instant into store-local calendar parts. */
export function storeParts(date = new Date()) {
  const parts = PART_FORMATTER.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  // `hour12: false` can render midnight as "24" in some engines.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    isoDay: WEEKDAY_TO_ISO[parts.weekday] ?? 1,
    secondsOfDay: hour * 3600 + Number(parts.minute) * 60 + Number(parts.second),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Milliseconds to add to an instant's UTC value to reach store wall time. */
function tzOffsetMs(date) {
  const p = storeParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Build the instant for a given store-local wall time. */
export function fromStoreWallTime(year, month, day, secondsOfDay) {
  const naive = Date.UTC(year, month - 1, day) + secondsOfDay * 1000;
  // Two passes settle the DST boundary cases.
  let instant = new Date(naive - tzOffsetMs(new Date(naive)));
  instant = new Date(naive - tzOffsetMs(instant));
  return instant;
}

function shiftsForDay(isoDay) {
  return getHours().shifts.filter((shift) => shift.day === isoDay);
}

function isClosedDate(parts) {
  const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return getHours().closedDates.some((closed) => closed.date === key);
}

function shiftAllowsOrderType(shift, orderType) {
  if (orderType === ORDER_TYPE.DELIVERY) return !shift.noDelivery;
  if (orderType === ORDER_TYPE.PICKUP) return !shift.noPickup;
  return true;
}

/** Does the schedule say the shop is trading, ignoring any manual override? */
export function isScheduledOpen(at = new Date(), orderType = null) {
  const parts = storeParts(at);
  if (isClosedDate(parts)) return false;

  return shiftsForDay(parts.isoDay).some(
    (shift) =>
      parts.secondsOfDay >= shift.start &&
      parts.secondsOfDay <= shift.end &&
      (!orderType || shiftAllowsOrderType(shift, orderType)),
  );
}

/**
 * Is the shop trading right now?
 *
 * The manual override wins over the schedule — that is the whole point of it:
 * the shop shuts early when the fryer dies, or stays open through a rush.
 */
export function isStoreOpen(at = new Date(), orderType = null) {
  const { manualStatus } = getHours();

  if (manualStatus === MANUAL_STATUS.OPEN) return true;
  if (manualStatus === MANUAL_STATUS.CLOSED) return false;

  return isScheduledOpen(at, orderType);
}

/** The next instant the shop starts trading, searching up to 14 days ahead. */
export function nextOpenAt(from = new Date(), orderType = null) {
  const startParts = storeParts(from);

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const probe = new Date(from.getTime() + dayOffset * 86400000);
    const parts = storeParts(probe);
    if (isClosedDate(parts)) continue;

    const candidates = shiftsForDay(parts.isoDay)
      .filter((shift) => !orderType || shiftAllowsOrderType(shift, orderType))
      .sort((a, b) => a.start - b.start);

    for (const shift of candidates) {
      // On the first day only future shifts count.
      if (dayOffset === 0 && shift.start <= startParts.secondsOfDay) continue;
      return fromStoreWallTime(parts.year, parts.month, parts.day, shift.start);
    }
  }

  return null;
}

/** Human-readable opening hours, one row per day, for the footer. */
export function openingHoursSummary() {
  return [1, 2, 3, 4, 5, 6, 7].map((isoDay) => {
    const shifts = shiftsForDay(isoDay).sort((a, b) => a.start - b.start);
    const label = shifts.map((s) => `${secondsToLabel(s.start)} – ${secondsToLabel(s.end)}`).join(', ');
    return { isoDay, day: DAY_NAMES[isoDay], hours: label || 'Closed' };
  });
}

export function secondsToLabel(seconds) {
  const total = Math.round(seconds / 60);
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')}${suffix}`;
}

export function prepMinutes(orderType) {
  return orderType === ORDER_TYPE.DELIVERY
    ? Number(orderSetup.deliveryTime)
    : Number(orderSetup.pickupTime);
}

/** The "ready in ~N mins" quote shown against the ASAP option. */
export function asapQuote(orderType, at = new Date()) {
  const minutes = prepMinutes(orderType);

  if (isStoreOpen(at, orderType)) {
    return { available: true, minutes, readyAt: new Date(at.getTime() + minutes * 60000) };
  }

  const opensAt = nextOpenAt(at, orderType);
  return {
    available: false,
    minutes,
    readyAt: opensAt ? new Date(opensAt.getTime() + minutes * 60000) : null,
    opensAt,
  };
}

/**
 * Bookable slots for a scheduled order.
 *
 * Slots start once the kitchen has had its prep time and are rounded up to the
 * configured interval. Grouped by store-local day for the picker.
 */
export function scheduleSlots(orderType, from = new Date()) {
  if (!orderSetup.isPreOrderingEnabled) return [];

  const interval = orderSetup.scheduleSlotMinutes * 60;
  const earliest = from.getTime() + prepMinutes(orderType) * 60000;
  const days = [];

  for (let dayOffset = 0; dayOffset <= orderSetup.scheduleMaxDaysAhead; dayOffset += 1) {
    const probe = new Date(from.getTime() + dayOffset * 86400000);
    const parts = storeParts(probe);
    if (isClosedDate(parts)) continue;

    const slots = [];
    const shifts = shiftsForDay(parts.isoDay)
      .filter((shift) => shiftAllowsOrderType(shift, orderType))
      .sort((a, b) => a.start - b.start);

    for (const shift of shifts) {
      const first = Math.ceil(shift.start / interval) * interval;
      for (let secs = first; secs <= shift.end; secs += interval) {
        const at = fromStoreWallTime(parts.year, parts.month, parts.day, secs);
        if (at.getTime() < earliest) continue;
        slots.push({ value: at.toISOString(), label: secondsToLabel(secs), at });
      }
    }

    if (slots.length) {
      days.push({
        dateKey: parts.dateKey,
        label: dayOffset === 0 ? 'Today' : dayOffset === 1 ? 'Tomorrow' : DAY_NAMES[parts.isoDay],
        slots,
      });
    }
  }

  return days;
}

export function formatTime(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatDateTime(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
