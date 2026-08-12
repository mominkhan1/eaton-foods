/**
 * Basket pricing.
 *
 * Order of operations matches how the reference platform bills:
 *   subtotal → promo discount → delivery fee → platform surcharge → total
 *
 * The surcharge is charged on the discounted subtotal, not the gross.
 */

import { orderSetup, ORDER_TYPE } from '../data/store.js';
import { getPromo } from './repository.js';
import { toPence, percentOf } from './money.js';

/** Unit price of a configured line: size price plus any paid modifiers. */
export function lineUnitPence(line) {
  const modifierPence = (line.modifiers ?? []).reduce(
    (sum, modifier) => sum + modifier.pricePence,
    0,
  );
  return line.sizePence + modifierPence;
}

export function lineTotalPence(line) {
  return lineUnitPence(line) * line.quantity;
}

export function subtotalPence(lines) {
  return lines.reduce((sum, line) => sum + lineTotalPence(line), 0);
}

/**
 * Is the promo code valid against this basket?
 * Returns `{ valid, reason, discountPence }`.
 */
export function evaluatePromo(code, subtotal) {
  // Read live: the shop edits the coupon from the admin panel, and the basket
  // has to honour the current one rather than whatever shipped in the seed.
  const promo = getPromo();

  if (!promo.isOn || !code) {
    return { valid: false, reason: null, discountPence: 0 };
  }

  if (code.trim().toUpperCase() !== promo.code.toUpperCase()) {
    return { valid: false, reason: 'unknown-code', discountPence: 0 };
  }

  const minimum = toPence(promo.minimumSpend);
  if (subtotal < minimum) {
    return { valid: false, reason: 'below-minimum', discountPence: 0, minimum };
  }

  return {
    valid: true,
    reason: null,
    discountPence: percentOf(subtotal, promo.percentage),
  };
}

export function deliveryFeePence(orderType, subtotalAfterDiscount) {
  if (orderType !== ORDER_TYPE.DELIVERY) return 0;

  if (
    orderSetup.isDeliveryFreeOver &&
    subtotalAfterDiscount >= toPence(orderSetup.freeDeliveryThreshold)
  ) {
    return 0;
  }

  return toPence(orderSetup.deliveryFee);
}

export function surchargePence(subtotalAfterDiscount) {
  if (!orderSetup.isPlatformSurchargeLevied) return 0;
  return (
    percentOf(subtotalAfterDiscount, orderSetup.platformSurchargePercentage) +
    toPence(orderSetup.platformSurchargeAmt)
  );
}

/**
 * Full basket breakdown.
 *
 * `meetsMinimum` is false when a delivery basket is under the minimum spend —
 * checkout should be blocked on it, and the shortfall is reported so the UI
 * can say how much more is needed.
 */
export function calculateTotals(lines, orderType, promoCode = null) {
  const subtotal = subtotalPence(lines);
  const promo = evaluatePromo(promoCode, subtotal);
  const discount = promo.discountPence;
  const afterDiscount = Math.max(0, subtotal - discount);

  const delivery = deliveryFeePence(orderType, afterDiscount);
  const surcharge = surchargePence(afterDiscount);
  const total = afterDiscount + delivery + surcharge;

  const minimum = orderType === ORDER_TYPE.DELIVERY ? toPence(orderSetup.minimumDeliveryOrder) : 0;
  const freeDeliveryThreshold = toPence(orderSetup.freeDeliveryThreshold);

  return {
    subtotal,
    discount,
    promo,
    delivery,
    surcharge,
    total,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    meetsMinimum: subtotal >= minimum,
    minimumShortfall: Math.max(0, minimum - subtotal),
    // How much more spend unlocks free delivery — 0 once it already is.
    freeDeliveryShortfall:
      orderType === ORDER_TYPE.DELIVERY && orderSetup.isDeliveryFreeOver && delivery > 0
        ? Math.max(0, freeDeliveryThreshold - afterDiscount)
        : 0,
  };
}

/** Turn a menu item + selections into a basket line. */
export function buildLine({ item, size, selectedModifiers, quantity, notes }) {
  return {
    lineId: `${item.id}:${size.id}:${selectedModifiers
      .map((m) => `${m.groupId}=${m.optionId}`)
      .sort()
      .join(',')}:${(notes ?? '').trim()}`,
    itemId: item.id,
    categoryId: item.categoryId,
    name: item.name,
    emoji: item.emoji,
    // Snapshot, like the price — if the shop later deletes the photo the line
    // falls back to the emoji rather than showing a broken image.
    imageId: item.imageId ?? null,
    sizeId: size.id,
    sizeName: size.name,
    sizePence: toPence(size.price),
    modifiers: selectedModifiers,
    quantity,
    notes: (notes ?? '').trim(),
    orderTypes: item.orderTypes ?? null,
  };
}
