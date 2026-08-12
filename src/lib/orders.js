/**
 * Orders.
 *
 * Status is explicit and shop-controlled — the admin advances it and the
 * customer's tracking screen reads it back. Nothing infers progress from a
 * clock, because a guessed status that contradicts the kitchen is worse than
 * no status at all.
 */

import { ORDER_TYPE } from '../data/store.js';
import { prepMinutes } from './hours.js';
import { putOrder, patchOrder, findOrder, listOrders as repoListOrders } from './repository.js';

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

function generateReference() {
  // Short, readable, no ambiguous characters.
  const alphabet = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679';
  let reference = '';
  for (let index = 0; index < 6; index += 1) {
    reference += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `EF-${reference}`;
}

export function placeOrder({ lines, totals, orderType, timing, address, customer, promoCode }) {
  const now = new Date();
  const readyAt =
    timing.mode === 'scheduled' && timing.slot
      ? new Date(timing.slot)
      : new Date(now.getTime() + prepMinutes(orderType) * 60000);

  return putOrder({
    reference: generateReference(),
    placedAt: now.toISOString(),
    readyAt: readyAt.toISOString(),
    orderType,
    timing,
    address: orderType === ORDER_TYPE.DELIVERY ? address : null,
    customer,
    promoCode,
    lines,
    totals,
    status: 'received',
    // Set when the shop first opens the order — drives the "new order" alert.
    acknowledgedAt: null,
  });
}

export function setOrderStatus(reference, statusId) {
  return patchOrder(reference, { status: statusId });
}

export function acknowledgeOrder(reference) {
  return patchOrder(reference, { acknowledgedAt: new Date().toISOString() });
}

/** Orders the kitchen has not opened yet. */
export function unacknowledgedOrders() {
  return repoListOrders().filter(
    (order) => !order.acknowledgedAt && order.status !== 'cancelled',
  );
}

/** Orders still in play, oldest first — the kitchen works top-down. */
export function activeOrders() {
  return repoListOrders()
    .filter((order) => order.status !== 'complete' && order.status !== 'cancelled')
    .sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
}

export function getOrder(reference) {
  return findOrder(reference);
}

export function listOrders() {
  return repoListOrders();
}

export function mostRecentOrder() {
  return repoListOrders()[0] ?? null;
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
