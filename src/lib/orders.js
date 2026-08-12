/**
 * Orders.
 *
 * Orders live on the server. This module holds the status vocabulary the two
 * sides share and the small amount of reasoning the browser does about it;
 * placing, reading and advancing an order all go through the API.
 *
 * Status is explicit and shop-controlled — the admin advances it and the
 * customer's tracking screen reads it back. Nothing infers progress from a
 * clock, because a guessed status that contradicts the kitchen is worse than
 * no status at all.
 */

import { ORDER_TYPE } from '../data/store.js';
import { api } from './api.js';

export const ORDER_STATUS = [
  { id: 'received', label: 'Order received', description: 'We have your order.', tone: 'new' },
  { id: 'preparing', label: 'In the kitchen', description: 'Your food is being cooked fresh.', tone: 'active' },
  { id: 'ready', label: 'Ready', description: 'Cooked and packed.', tone: 'active' },
  { id: 'on-the-way', label: 'On the way', description: 'Your driver is heading over.', tone: 'active' },
  { id: 'complete', label: 'Complete', description: 'Enjoy!', tone: 'done' },
  { id: 'cancelled', label: 'Cancelled', description: 'This order was cancelled.', tone: 'cancelled' },
];

/** The timeline a customer sees — collection skips the driver stage. */
export function statusStepsFor(orderType) {
  return ORDER_STATUS.filter(
    (step) =>
      step.id !== 'cancelled' &&
      (orderType === ORDER_TYPE.DELIVERY || step.id !== 'on-the-way'),
  );
}

export function findStatus(statusId) {
  return ORDER_STATUS.find((step) => step.id === statusId) ?? ORDER_STATUS[0];
}

/** The next status the shop would move this order to, or null at the end. */
export function nextStatusFor(order) {
  if (order.status === 'cancelled' || order.status === 'complete') return null;
  const steps = statusStepsFor(order.orderType);
  const index = steps.findIndex((step) => step.id === order.status);
  return steps[index + 1] ?? null;
}

/**
 * Place an order.
 *
 * The basket is sent as item ids, sizes and choices — never prices. The server
 * re-prices every line from the database before it writes anything, so a
 * customer who edits the JavaScript to send `price: 0.01` still gets charged
 * the real menu price. That means the totals the browser computed are for
 * display only, and the order that comes back is the authority.
 */
export function placeOrder({ lines, orderType, timing, address, customer, promoCode }) {
  return api.placeOrder({
    orderType,
    timing,
    promoCode: promoCode || null,
    customer,
    address:
      orderType === ORDER_TYPE.DELIVERY && address
        ? {
            line1: address.line1,
            line2: address.line2 ?? null,
            city: address.city ?? null,
            postcode: address.postcode,
            lat: address.coords?.lat ?? null,
            lng: address.coords?.lng ?? null,
          }
        : null,
    lines: lines.map((line) => ({
      itemId: line.itemId,
      sizeId: line.sizeId,
      quantity: line.quantity,
      notes: line.notes || null,
      modifiers: (line.modifiers ?? []).map((modifier) => ({
        groupId: modifier.groupId,
        optionId: modifier.optionId,
      })),
    })),
  });
}

export function getOrder(reference, options) {
  return api.trackOrder(reference, options);
}

export function setOrderStatus(reference, statusId) {
  return api.admin.setOrderStatus(reference, statusId);
}

export function acknowledgeOrder(reference) {
  return api.admin.acknowledgeOrder(reference);
}

/** Where this order sits on the customer-facing timeline. */
export function statusPosition(order) {
  const steps = statusStepsFor(order.orderType);
  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === order.status),
  );

  return {
    steps,
    activeIndex,
    current: findStatus(order.status),
    isCancelled: order.status === 'cancelled',
  };
}

/**
 * References this browser has placed, newest first.
 *
 * Kept locally on purpose: it is the "your recent orders" convenience on the
 * tracking page, not a source of truth. There is no customer login, and an
 * endpoint that listed somebody else's orders by phone number would be a way
 * to read them.
 */
const RECENT_KEY = 'eaton.recent-orders.v1';
const RECENT_LIMIT = 5;

export function rememberOrder(order) {
  if (!order?.reference) return;

  try {
    const existing = recentOrderRefs().filter((entry) => entry.reference !== order.reference);
    const next = [
      { reference: order.reference, placedAt: order.placedAt, total: order.totals?.total ?? 0 },
      ...existing,
    ].slice(0, RECENT_LIMIT);

    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private browsing — the customer simply has no recent list.
  }
}

export function recentOrderRefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
