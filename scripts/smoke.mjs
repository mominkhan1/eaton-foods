/**
 * Smoke test for the ordering and admin logic.
 *
 * Covers the rules that are easy to get quietly wrong: late-night trading
 * hours, the manual open/close override, the delivery geofence, the
 * surcharge/promo/free-delivery maths, image handling, and revenue bucketing.
 *
 *   node scripts/smoke.mjs
 *
 * WHAT THIS DOES NOT COVER. The catalog, banners, hours and coupon are stored
 * in MySQL and written through the API, so the rules about *persistence* —
 * refusing to delete a category that still has items, replacing an item's
 * sizes wholesale, renumbering slides — are enforced in PHP and cannot be
 * exercised from Node. This file drives the client-side snapshot directly with
 * `applyCatalog` and friends, which is what the API responses feed, and tests
 * the reasoning layered on top of it.
 */

import assert from 'node:assert/strict';

import { ORDER_TYPE, orderSetup, storeConfig } from '../src/data/store.js';
import {
  isStoreOpen,
  isScheduledOpen,
  nextOpenAt,
  scheduleSlots,
  fromStoreWallTime,
  storeParts,
  prepMinutes,
} from '../src/lib/hours.js';
import {
  checkDeliveryArea,
  normalisePostcode,
  postcodeDistrict,
  distanceKm,
} from '../src/lib/geo.js';
import { calculateTotals, buildLine, lineUnitPence, evaluatePromo } from '../src/lib/pricing.js';
import { toPence, formatPence } from '../src/lib/money.js';
import {
  seedMenuItems,
  seedCategories,
  seedModifierGroups,
  resolveModifierGroups,
  isItemAvailableFor,
  isPublished,
  describeGroupRule,
  MEAL_UPCHARGE,
} from '../src/data/menu.js';
import { slugify } from '../src/lib/slug.js';
import {
  fitWithin,
  validateSourceFile,
  formatBytes,
  registerImageUrls,
  getImageUrl,
  clearImageUrls,
  IMAGE_ERRORS,
  MAX_SOURCE_BYTES,
} from '../src/lib/images.js';
import {
  getCatalog,
  getHours,
  getBanners,
  getPromo,
  applyCatalog,
  applyHours,
  applyBanners,
  applyPromo,
  itemsUsingModifierGroup,
  allReferencedImageIds,
  resetToSeed,
  MANUAL_STATUS,
} from '../src/lib/repository.js';
import {
  isBannerRenderable,
  clampAutoplaySeconds,
  clampIntensity,
  AUTOPLAY_MIN_SECONDS,
  AUTOPLAY_MAX_SECONDS,
} from '../src/data/banners.js';
import { isBrowserHref, isExternalHref, hasLink } from '../src/lib/links.js';
import { statusStepsFor, nextStatusFor, statusPosition } from '../src/lib/orders.js';
import { buildReport, reportRange, GRANULARITY } from '../src/lib/reports.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const findSeedItem = (id) => seedMenuItems.find((item) => item.id === id);

/** Put the store into a known state, the way an API response would. */
function setManualStatus(manualStatus) {
  applyHours({ ...getHours(), manualStatus });
}

// ── Trading hours ──────────────────────────────────────────────────────────
section('Trading hours');

test('closed at 9am, open at 1pm', () => {
  // 2026-08-12 is a Wednesday.
  const morning = fromStoreWallTime(2026, 8, 12, 9 * 3600);
  const afternoon = fromStoreWallTime(2026, 8, 12, 13 * 3600);

  assert.equal(isStoreOpen(morning), false, '9am should be closed');
  assert.equal(isStoreOpen(afternoon), true, '1pm should be open');
});

test('late-night shift keeps the shop open past midnight', () => {
  assert.equal(isStoreOpen(fromStoreWallTime(2026, 8, 13, 30 * 60)), true, '00:30 open');
  assert.equal(isStoreOpen(fromStoreWallTime(2026, 8, 13, 3 * 3600)), false, '03:00 closed');
});

test('weeknights stop earlier than weekends', () => {
  assert.equal(isStoreOpen(fromStoreWallTime(2026, 8, 12, 90 * 60)), false, 'Wed 01:30 shut');
  assert.equal(isStoreOpen(fromStoreWallTime(2026, 8, 15, 90 * 60)), true, 'Sat 01:30 open');
});

test('nextOpenAt returns a future instant that is actually open', () => {
  const morning = fromStoreWallTime(2026, 8, 12, 9 * 3600);
  const opens = nextOpenAt(morning);

  assert.ok(opens, 'expected an opening time');
  assert.ok(opens.getTime() > morning.getTime(), 'opening time must be in the future');
  assert.equal(isStoreOpen(opens), true, 'the store must be open at nextOpenAt');
  assert.equal(storeParts(opens).hour, 12, 'next opening should be midday');
});

test('closed dates are respected', () => {
  assert.equal(isStoreOpen(fromStoreWallTime(2026, 12, 25, 18 * 3600)), false);
});

test('schedule slots are all in the future and inside trading hours', () => {
  const from = fromStoreWallTime(2026, 8, 12, 13 * 3600);
  const days = scheduleSlots(ORDER_TYPE.DELIVERY, from);

  assert.ok(days.length > 0, 'expected at least one bookable day');

  const earliest = from.getTime() + prepMinutes(ORDER_TYPE.DELIVERY) * 60000;
  for (const day of days) {
    for (const slot of day.slots) {
      assert.ok(slot.at.getTime() >= earliest, `slot ${slot.label} is before prep time`);
      assert.equal(isStoreOpen(slot.at), true, `slot ${slot.label} outside trading hours`);
    }
  }
});

// ── Manual override ────────────────────────────────────────────────────────
section('Manual open/close override');

test('force-closed beats an open schedule', () => {
  const openTime = fromStoreWallTime(2026, 8, 12, 13 * 3600);
  assert.equal(isScheduledOpen(openTime), true, 'schedule says open');

  setManualStatus(MANUAL_STATUS.CLOSED);
  assert.equal(isStoreOpen(openTime), false, 'override should shut the shop');
  assert.equal(isScheduledOpen(openTime), true, 'the schedule itself is untouched');

  setManualStatus(MANUAL_STATUS.AUTO);
  assert.equal(isStoreOpen(openTime), true, 'auto restores schedule behaviour');
});

test('force-open beats a closed schedule', () => {
  const shutTime = fromStoreWallTime(2026, 8, 12, 9 * 3600);
  assert.equal(isScheduledOpen(shutTime), false);

  setManualStatus(MANUAL_STATUS.OPEN);
  assert.equal(isStoreOpen(shutTime), true, 'override should open the shop');

  setManualStatus(MANUAL_STATUS.AUTO);
  assert.equal(isStoreOpen(shutTime), false);
});

test('edited shifts take effect immediately', () => {
  const nineAm = fromStoreWallTime(2026, 8, 12, 9 * 3600);
  assert.equal(isStoreOpen(nineAm), false, 'closed at 9am by default');

  applyHours({
    ...getHours(),
    shifts: [{ day: 3, start: 8 * 3600, end: 23 * 3600, noDelivery: false, noPickup: false }],
  });
  assert.equal(isStoreOpen(nineAm), true, 'now open at 9am on Wednesday');

  resetToSeed();
  assert.equal(isStoreOpen(nineAm), false, 'back to the seed schedule');
  assert.equal(getHours().manualStatus, MANUAL_STATUS.AUTO);
});

// ── Delivery area ──────────────────────────────────────────────────────────
section('Delivery area');

test('postcode normalisation and district extraction', () => {
  assert.equal(normalisePostcode('m145lj'), 'M14 5LJ');
  assert.equal(normalisePostcode('M14  5LJ'), 'M14 5LJ');
  assert.equal(normalisePostcode('not a postcode'), null);
  assert.equal(postcodeDistrict('M1 4BT'), 'M1');
  assert.equal(postcodeDistrict('SW1A 1AA'), 'SW1A');
});

test('a served local postcode inside the radius passes', () => {
  const result = checkDeliveryArea('AL8 6HA', storeConfig.location);
  assert.equal(result.ok, true, `expected pass, got ${result.reason}`);
});

test('a London postcode is rejected on district', () => {
  assert.equal(checkDeliveryArea('SW1A 1AA', storeConfig.location).reason, 'outside-districts');
});

test('a served district is accepted whatever the distance', () => {
  // The shop delivers to all of Hatfield, and AL9/AL10 reach past any circle
  // drawn around the shop, so the radius check is off and the district alone
  // decides. This pins that policy: a served district must not be refused on
  // distance, or half of Hatfield silently stops being able to order.
  const faraway = { lat: storeConfig.location.lat + 0.5, lng: storeConfig.location.lng };
  const result = checkDeliveryArea('AL10 8AB', faraway);

  assert.equal(orderSetup.useRadiusBasedDeliveryArea, false);
  assert.equal(result.ok, true, `expected pass, got ${result.reason}`);
  assert.ok(result.distanceKm > orderSetup.deliveryRadiusKm);
});

test('garbage input is rejected as an invalid postcode', () => {
  assert.equal(checkDeliveryArea('hello').reason, 'invalid-postcode');
});

test('haversine distance is sane', () => {
  // Charing Cross is a shade over 33km from the shop. A wide band, because
  // this guards against the formula being wrong by an order of magnitude
  // (degrees vs radians, wrong earth radius), not against small drift.
  const londonCharingCross = { lat: 51.5074, lng: -0.1278 };
  const km = distanceKm(storeConfig.location, londonCharingCross);
  assert.ok(km > 28 && km < 40, `expected ~33km, got ${km.toFixed(1)}km`);
});

// ── Pricing ────────────────────────────────────────────────────────────────
//
// The server re-prices every basket from the database before it writes an
// order, so these totals are what the customer is *shown*. They still have to
// agree with the server to the penny, or the charge will not match the screen.
section('Pricing');

function lineFor(itemId, sizeIndex = 0, modifierPicks = [], quantity = 1) {
  const item = findSeedItem(itemId);
  if (!item) throw new Error(`no seed item "${itemId}"`);

  const size = item.sizes[sizeIndex];
  const groups = resolveModifierGroups(item, seedModifierGroups);

  const selectedModifiers = modifierPicks.map(([groupId, optionId]) => {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) throw new Error(`${itemId} has no group "${groupId}"`);

    const option = group.options.find((candidate) => candidate.id === optionId);
    if (!option) throw new Error(`${groupId} has no option "${optionId}"`);

    return {
      groupId,
      groupName: group.name,
      optionId,
      optionName: option.name,
      pricePence: toPence(option.price),
    };
  });

  return buildLine({ item, size, selectedModifiers, quantity, notes: '' });
}

test('a line is size price plus paid modifiers', () => {
  // Holy Smash £6.99 + peri salt £0.50 + ketchup dip £0.50 = £7.99
  const line = lineFor('holy-smash', 0, [
    ['sauceChoice', 'ketchup'],
    ['extraDips', 'peri-salt'],
    ['extraDips', 'ketchup-dip'],
  ]);

  assert.equal(lineUnitPence(line), 799, formatPence(lineUnitPence(line)));
});

test('free sauce choices do not change the price', () => {
  const plain = lineFor('holy-smash', 0, []);
  const sauced = lineFor('holy-smash', 0, [['sauceChoice', 'algerian']]);

  assert.equal(lineUnitPence(plain), 699);
  assert.equal(lineUnitPence(sauced), 699, 'a choice of sauce is included');
});

test('"make it a meal" is a size worth exactly the board price', () => {
  const single = lineFor('holy-smash', 0, [['sauceChoice', 'ketchup']]);
  const meal = lineFor('holy-smash', 1, [['sauceChoice', 'ketchup']]);

  assert.equal(lineUnitPence(single), 699);
  assert.equal(lineUnitPence(meal), 948);
  assert.equal(
    lineUnitPence(meal) - lineUnitPence(single),
    toPence(MEAL_UPCHARGE),
    'the upgrade must be £2.49 on every main',
  );
});

test('every main offers the meal upgrade at the same upcharge', () => {
  const mains = seedMenuItems.filter((item) => item.sizes.some((size) => size.id === 'meal'));
  // 2 beef burgers + 2 chicken burgers + 2 club sandwiches.
  assert.equal(mains.length, 6, `expected 6 mealable mains, found ${mains.length}`);

  for (const item of mains) {
    const single = item.sizes.find((size) => size.id === 'single');
    const meal = item.sizes.find((size) => size.id === 'meal');

    assert.equal(
      toPence(meal.price) - toPence(single.price),
      toPence(MEAL_UPCHARGE),
      `${item.name} has the wrong meal upcharge`,
    );
  }
});

test('collection basket has no delivery fee and no minimum', () => {
  const totals = calculateTotals(
    [lineFor('holy-smash', 0, [['sauceChoice', 'ketchup']])],
    ORDER_TYPE.PICKUP,
  );

  assert.equal(totals.subtotal, 699);
  assert.equal(totals.delivery, 0);
  assert.equal(totals.meetsMinimum, true);
  assert.equal(totals.surcharge, Math.round(699 * 0.02) + 25);
  assert.equal(totals.total, 699 + totals.surcharge);
});

test('delivery under the minimum blocks checkout and reports the shortfall', () => {
  const totals = calculateTotals(
    [lineFor('holy-smash', 0, [['sauceChoice', 'ketchup']])],
    ORDER_TYPE.DELIVERY,
  );

  assert.equal(totals.meetsMinimum, false);
  assert.equal(totals.minimumShortfall, toPence(orderSetup.minimumDeliveryOrder) - 699);
});

test('delivery fee applies below the free threshold', () => {
  const totals = calculateTotals(
    [lineFor('holy-smash', 1, [['sauceChoice', 'ketchup']])],
    ORDER_TYPE.DELIVERY,
  );

  assert.equal(totals.subtotal, 948);
  assert.equal(totals.delivery, toPence(orderSetup.deliveryFee));
  assert.equal(totals.freeDeliveryShortfall, toPence(orderSetup.freeDeliveryThreshold) - 948);
});

test('delivery is free over the threshold', () => {
  // No single Eat On item reaches £25, so this needs a realistic multi-item
  // basket — which is the case that actually occurs.
  const totals = calculateTotals(
    [lineFor('holy-smash', 1, [['sauceChoice', 'ketchup']], 3)],
    ORDER_TYPE.DELIVERY,
  );

  assert.equal(totals.subtotal, 2844);
  assert.equal(totals.delivery, 0);
  assert.equal(totals.freeDeliveryShortfall, 0);
});

test('promo applies only above its minimum spend', () => {
  const belowMinimum = calculateTotals(
    [lineFor('holy-smash', 0, [['sauceChoice', 'ketchup']])],
    ORDER_TYPE.PICKUP,
    orderSetup.promo.code,
  );
  assert.equal(belowMinimum.discount, 0);
  assert.equal(belowMinimum.promo.reason, 'below-minimum');

  const applied = calculateTotals(
    [lineFor('holy-smash', 1, [['sauceChoice', 'ketchup']], 3)],
    ORDER_TYPE.PICKUP,
    orderSetup.promo.code,
  );
  assert.equal(applied.promo.valid, true);
  assert.equal(applied.discount, 284, '10% of £28.44');
});

test('an unknown promo code is rejected', () => {
  const totals = calculateTotals(
    [lineFor('holy-smash', 1, [['sauceChoice', 'ketchup']], 3)],
    ORDER_TYPE.PICKUP,
    'NOPE',
  );
  assert.equal(totals.discount, 0);
  assert.equal(totals.promo.reason, 'unknown-code');
});

test('surcharge is charged on the discounted subtotal', () => {
  const totals = calculateTotals(
    [lineFor('holy-smash', 1, [['sauceChoice', 'ketchup']], 3)],
    ORDER_TYPE.PICKUP,
    orderSetup.promo.code,
  );

  const afterDiscount = 2844 - 284;
  assert.equal(totals.surcharge, Math.round(afterDiscount * 0.02) + 25);
  assert.equal(totals.total, afterDiscount + totals.surcharge);
});

test('a discount that crosses the free-delivery line still charges delivery', () => {
  // 3 × Chick N' Bun meal = £25.44 gross, over the £25 threshold; the 10%
  // promo drops it to £22.90, which is under it again.
  const lines = [lineFor('chick-n-bun', 1, [['sauceChoice', 'mayonnaise']], 3)];
  const withoutPromo = calculateTotals(lines, ORDER_TYPE.DELIVERY);
  const withPromo = calculateTotals(lines, ORDER_TYPE.DELIVERY, orderSetup.promo.code);

  assert.equal(withoutPromo.subtotal, 2544);
  assert.equal(withoutPromo.delivery, 0, 'gross £25.44 is over the £25 threshold');
  assert.equal(withPromo.discount, 254);
  assert.equal(withPromo.delivery, toPence(orderSetup.deliveryFee), '£22.90 net is under it');
});

test('the basket honours the shop’s current coupon, not the seeded one', () => {
  // The seeded code stops working once the shop changes it — this is the whole
  // point of the coupon being editable, and the easiest thing to get wrong is
  // leaving pricing pointed at the static seed.
  applyPromo({ isOn: true, code: 'SUMMER20', percentage: 20, minimumSpend: 10 });

  assert.equal(evaluatePromo('EATON10', 5000).valid, false, 'the old code is dead');

  const applied = evaluatePromo('summer20', 5000);
  assert.equal(applied.valid, true, 'the new code applies, case-insensitively');
  assert.equal(applied.discountPence, 1000, '20% of £50');

  const tooSmall = evaluatePromo('SUMMER20', 500);
  assert.equal(tooSmall.valid, false);
  assert.equal(tooSmall.reason, 'below-minimum');

  applyPromo({ isOn: false });
  assert.equal(evaluatePromo('SUMMER20', 5000).valid, false, 'a paused offer refuses its own code');

  resetToSeed();
  assert.equal(getPromo().code, 'EATON10');
});

// ── Availability ───────────────────────────────────────────────────────────
section('Order-type availability');

test('an item restricted to collection is blocked on delivery', () => {
  // Nothing on the current board is collection-only, so this exercises the
  // rule directly rather than depending on a menu item that may come and go.
  const inStoreOnly = { orderTypes: [ORDER_TYPE.PICKUP] };

  assert.equal(isItemAvailableFor(inStoreOnly, ORDER_TYPE.PICKUP), true);
  assert.equal(isItemAvailableFor(inStoreOnly, ORDER_TYPE.DELIVERY), false);
});

test('unrestricted items are available on both', () => {
  const burger = findSeedItem('holy-smash');
  assert.equal(isItemAvailableFor(burger, ORDER_TYPE.PICKUP), true);
  assert.equal(isItemAvailableFor(burger, ORDER_TYPE.DELIVERY), true);
});

// ── Menu data integrity ────────────────────────────────────────────────────
section('Menu data integrity');

test('every item has a valid category, a size and a price', () => {
  const categoryIds = new Set(seedCategories.map((category) => category.id));

  for (const item of seedMenuItems) {
    assert.ok(categoryIds.has(item.categoryId), `${item.id} has unknown category`);
    assert.ok(item.sizes.length > 0, `${item.id} has no sizes`);
    for (const size of item.sizes) {
      assert.ok(size.price > 0, `${item.id}/${size.id} has no price`);
    }
  }
});

test('item ids are unique', () => {
  const ids = seedMenuItems.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate item id');
});

test('every referenced modifier group resolves', () => {
  for (const item of seedMenuItems) {
    assert.equal(
      resolveModifierGroups(item, seedModifierGroups).length,
      (item.modifierGroups ?? []).length,
      `${item.id} references a missing modifier group`,
    );
  }
});

test('a dangling group reference degrades quietly rather than crashing', () => {
  const item = { modifierGroups: ['sauceChoice', 'does-not-exist'] };
  const resolved = resolveModifierGroups(item, seedModifierGroups);

  assert.equal(resolved.length, 1, 'missing groups are dropped, not rendered as undefined');
  assert.equal(resolved[0].id, 'sauceChoice');
});

test('identical configurations produce the same line id', () => {
  const a = lineFor('holy-smash', 0, [['sauceChoice', 'ketchup'], ['extraDips', 'peri-salt']]);
  const b = lineFor('holy-smash', 0, [['extraDips', 'peri-salt'], ['sauceChoice', 'ketchup']]);
  assert.equal(a.lineId, b.lineId, 'modifier order should not create a separate basket line');
});

test('different configurations produce different line ids', () => {
  const a = lineFor('holy-smash', 0, [['sauceChoice', 'ketchup']]);
  const b = lineFor('holy-smash', 0, [['sauceChoice', 'chilli']]);
  const c = lineFor('holy-smash', 1, [['sauceChoice', 'ketchup']]);

  assert.notEqual(a.lineId, b.lineId);
  assert.notEqual(a.lineId, c.lineId);
});

// ── The catalog snapshot ───────────────────────────────────────────────────
//
// What the API hands back is installed wholesale. These cover the reasoning
// that runs over the installed copy, not the storage rules — those are the
// server's and are enforced in SQL.
section('Catalog snapshot');

test('a catalog response replaces the snapshot', () => {
  applyCatalog({
    categories: [{ id: 'loaded', name: 'Loaded Fries', emoji: '🍟', displayOrder: 1 }],
    items: [
      {
        id: 'loaded-cheese',
        categoryId: 'loaded',
        name: 'Cheese Loaded Fries',
        emoji: '🧀',
        sizes: [{ id: 'std', name: 'Serve', price: 5.5 }],
        modifierGroups: [],
        isPublished: true,
      },
    ],
    modifierGroups: {},
  });

  assert.equal(getCatalog().categories.length, 1);
  assert.equal(getCatalog().items[0].sizes[0].price, 5.5);

  resetToSeed();
  assert.equal(getCatalog().items.length, seedMenuItems.length, 'reset restores the seed');
});

test('hiding an item takes it off the menu without deleting it', () => {
  const hidden = getCatalog().items.map((item) =>
    item.id === 'holy-smash' ? { ...item, isPublished: false } : item,
  );
  applyCatalog({ ...getCatalog(), items: hidden });

  const item = getCatalog().items.find((candidate) => candidate.id === 'holy-smash');
  assert.ok(item, 'item should still exist');
  assert.equal(isPublished(item), false, 'item should be hidden');

  resetToSeed();
  assert.equal(
    isPublished(getCatalog().items.find((candidate) => candidate.id === 'holy-smash')),
    true,
  );
});

test('option-group usage is reported across the whole menu', () => {
  const inUse = itemsUsingModifierGroup('sauceChoice');
  assert.ok(inUse.length > 0, 'the sauce group is attached to the burgers');
  assert.ok(inUse.every((item) => item.modifierGroups.includes('sauceChoice')));

  assert.equal(itemsUsingModifierGroup('does-not-exist').length, 0);
});

// ── Hero banners ───────────────────────────────────────────────────────────
section('Hero banners');

test('seed slides are all renderable and uniquely identified', () => {
  resetToSeed();
  const { slides, settings } = getBanners();

  assert.ok(slides.length >= 2, 'a slider needs more than one slide to be a slider');
  assert.equal(new Set(slides.map((slide) => slide.id)).size, slides.length, 'duplicate slide id');

  for (const slide of slides) {
    assert.equal(isBannerRenderable(slide), true, `${slide.id} has no heading`);
  }

  assert.equal(settings.autoplaySeconds >= AUTOPLAY_MIN_SECONDS, true);
});

test('a slide with no heading is not renderable', () => {
  assert.equal(isBannerRenderable({ heading: '', headingAccent: '' }), false);
  assert.equal(isBannerRenderable({ heading: '   ' }), false);
  assert.equal(isBannerRenderable({ heading: '', headingAccent: 'Just £2.49.' }), true);
  assert.equal(isBannerRenderable(null), false);
});

test('banner settings merge over the defaults rather than replacing them', () => {
  // A shop whose stored settings predate a new field must read the default for
  // it, not `undefined` — which would render as a broken control.
  applyBanners({ slides: [], settings: { autoplaySeconds: 9 } });

  assert.equal(getBanners().settings.autoplaySeconds, 9);
  assert.equal(typeof getBanners().settings.areEmbersOn, 'boolean', 'missing key takes the default');

  resetToSeed();
});

test('autoplay seconds are clamped to something readable', () => {
  assert.equal(clampAutoplaySeconds(0), AUTOPLAY_MIN_SECONDS, 'a 0s carousel is unusable');
  assert.equal(clampAutoplaySeconds(-5), AUTOPLAY_MIN_SECONDS);
  assert.equal(clampAutoplaySeconds(999), AUTOPLAY_MAX_SECONDS);
  assert.equal(clampAutoplaySeconds(8), 8);
  assert.equal(clampAutoplaySeconds(7.4), 7, 'fractional seconds round');
  assert.equal(clampAutoplaySeconds('not a number'), 6, 'falls back to the default');
});

test('effect strength is clamped to 0–1', () => {
  // Above 1 washes the hero out until the headline is unreadable; below 0
  // renders nothing while the setting still claims to be on.
  assert.equal(clampIntensity(1.8), 1);
  assert.equal(clampIntensity(-0.4), 0);
  assert.equal(clampIntensity(0.65), 0.65);
  assert.equal(clampIntensity('0.5'), 0.5, 'a range input hands over a string');
  assert.equal(clampIntensity(0.6789), 0.68, 'rounded to whole percent');
  assert.equal(clampIntensity(undefined, 0.4), 0.4, 'falls back when unset');
});

test('button links are routed to the right element type', () => {
  // Browser-handled: on-page anchors, phone, mail, absolute URLs.
  for (const href of ['#menu', 'tel:+441615550142', 'mailto:a@b.co', 'https://example.com']) {
    assert.equal(isBrowserHref(href), true, `${href} should be a plain anchor`);
  }
  // In-app routes go through the router instead.
  for (const href of ['/track', '/menu', 'checkout']) {
    assert.equal(isBrowserHref(href), false, `${href} should be a router link`);
  }

  assert.equal(isExternalHref('https://example.com'), true);
  assert.equal(isExternalHref('#menu'), false);
  assert.equal(isExternalHref('/track'), false);
});

test('a button needs both a label and a link to render', () => {
  assert.equal(hasLink('Order now', '#menu'), true);
  assert.equal(hasLink('Order now', ''), false, 'a label with no link is a dead button');
  assert.equal(hasLink('', '#menu'), false, 'a link with no label is invisible');
  assert.equal(hasLink('  ', '  '), false);
});

// ── Images ─────────────────────────────────────────────────────────────────
section('Images');

test('fitWithin preserves aspect ratio when downscaling', () => {
  const landscape = fitWithin(4000, 3000, 900);
  assert.equal(landscape.width, 900);
  assert.equal(landscape.height, 675, '4:3 must stay 4:3');
  assert.equal(landscape.scaled, true);

  const portrait = fitWithin(3000, 4000, 900);
  assert.equal(portrait.width, 675);
  assert.equal(portrait.height, 900, 'the long edge is the one that gets capped');

  const square = fitWithin(2000, 2000, 900);
  assert.equal(square.width, 900);
  assert.equal(square.height, 900);
});

test('fitWithin never upscales a small image', () => {
  const small = fitWithin(320, 240, 900);
  assert.equal(small.width, 320);
  assert.equal(small.height, 240);
  assert.equal(small.scaled, false, 'blowing up a small photo just wastes bytes');
});

test('fitWithin handles degenerate input', () => {
  assert.deepEqual(fitWithin(0, 100), { width: 0, height: 0, scaled: false });
  assert.deepEqual(fitWithin(-5, 10), { width: 0, height: 0, scaled: false });

  // An extreme panorama must not round its short edge away to zero.
  const panorama = fitWithin(9000, 3, 900);
  assert.ok(panorama.height >= 1, 'height must stay renderable');
});

test('source files are validated before decoding', () => {
  assert.equal(validateSourceFile(null).reason, 'no-file');
  assert.equal(validateSourceFile({ type: 'application/pdf', size: 100 }).reason, 'not-an-image');
  assert.equal(
    validateSourceFile({ type: 'image/jpeg', size: MAX_SOURCE_BYTES + 1 }).reason,
    'too-large',
  );
  assert.equal(validateSourceFile({ type: 'image/jpeg', size: 2_000_000 }).ok, true);
  assert.equal(validateSourceFile({ type: 'image/webp', size: 500 }).ok, true);
});

test('every validation reason has a message for the shop', () => {
  for (const reason of ['no-file', 'not-an-image', 'too-large', 'decode', 'upload']) {
    assert.ok(IMAGE_ERRORS[reason], `no message for "${reason}"`);
  }
});

test('formatBytes is readable at each scale', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
});

test('image URLs are picked up from an API payload', () => {
  clearImageUrls();

  // Shaped like a catalog response: the URL travels with the id, so the menu
  // never has to look one up.
  registerImageUrls({
    categories: [{ id: 'burgers', imageId: 'img_cat', imageUrl: '/uploads/img_cat.webp' }],
    items: [{ id: 'holy-smash', imageId: 'img_item', imageUrl: '/uploads/img_item.jpg' }],
  });

  assert.equal(getImageUrl('img_cat'), '/uploads/img_cat.webp');
  assert.equal(getImageUrl('img_item'), '/uploads/img_item.jpg');
  assert.equal(getImageUrl('img_unknown'), null, 'an unknown id falls back to the emoji');
  assert.equal(getImageUrl(null), null);
});

test('a slide registers both its photo and its backdrop', () => {
  clearImageUrls();

  // The two live on the same object under different keys; missing the second
  // would leave a banner background the shop had just uploaded unrenderable.
  registerImageUrls({
    slides: [
      {
        id: 'promo',
        imageId: 'img_slide',
        imageUrl: '/uploads/slide.webp',
        backgroundImageId: 'img_bg',
        backgroundImageUrl: '/uploads/bg.webp',
      },
    ],
  });

  assert.equal(getImageUrl('img_slide'), '/uploads/slide.webp');
  assert.equal(getImageUrl('img_bg'), '/uploads/bg.webp');
});

test('an id with no URL is not registered as one', () => {
  clearImageUrls();
  registerImageUrls({ items: [{ id: 'x', imageId: 'img_x', imageUrl: null }] });

  assert.equal(getImageUrl('img_x'), null, 'a null URL must not become a broken <img>');
});

test('every collection contributes to the in-use image list', () => {
  resetToSeed();

  applyCatalog({
    ...getCatalog(),
    items: getCatalog().items.map((item) =>
      item.id === 'holy-smash' ? { ...item, imageId: 'img_item_1' } : item,
    ),
    categories: getCatalog().categories.map((category) =>
      category.id === 'beef-burgers' ? { ...category, imageId: 'img_cat_1' } : category,
    ),
  });

  applyBanners({
    slides: [{ id: 'promo', heading: 'Hi', imageId: 'img_banner_1', backgroundImageId: 'img_bg_1' }],
    settings: {},
  });

  const referenced = allReferencedImageIds();

  // Checking the menu alone would treat every banner photo as an orphan.
  assert.ok(referenced.includes('img_item_1'), 'item photo must be counted');
  assert.ok(referenced.includes('img_cat_1'), 'category photo must be counted');
  assert.ok(referenced.includes('img_banner_1'), 'banner photo must be counted');
  assert.ok(referenced.includes('img_bg_1'), 'banner backdrop must be counted');
  assert.ok(
    referenced.every(Boolean),
    'items without a photo must not contribute null to the list',
  );

  resetToSeed();
});

test('a basket line snapshots the image id alongside the price', () => {
  const item = { ...findSeedItem('holy-smash'), imageId: 'img_test_1' };
  const line = buildLine({
    item,
    size: item.sizes[0],
    selectedModifiers: [],
    quantity: 1,
    notes: '',
  });

  assert.equal(line.imageId, 'img_test_1');
});

test('an item with no photo stores null rather than undefined', () => {
  const item = { id: 'x', categoryId: 'c', name: 'X', sizes: [{ id: 's', name: 'S', price: 1 }] };
  const line = buildLine({ item, size: item.sizes[0], selectedModifiers: [], quantity: 1, notes: '' });

  assert.equal(line.imageId, null, 'null survives JSON round-trips; undefined does not');
  assert.equal(JSON.parse(JSON.stringify(line)).imageId, null);
});

// ── Order status ───────────────────────────────────────────────────────────
section('Order status');

test('collection orders skip the driver stage', () => {
  const collection = statusStepsFor(ORDER_TYPE.PICKUP).map((step) => step.id);
  const delivery = statusStepsFor(ORDER_TYPE.DELIVERY).map((step) => step.id);

  assert.ok(!collection.includes('on-the-way'), 'collection should have no driver stage');
  assert.ok(delivery.includes('on-the-way'), 'delivery should have one');
  assert.ok(!collection.includes('cancelled'), 'cancelled is not a timeline stage');
});

test('status advances through the timeline and stops at the end', () => {
  const order = { orderType: ORDER_TYPE.PICKUP, status: 'received' };

  assert.equal(nextStatusFor(order).id, 'preparing');
  assert.equal(nextStatusFor({ ...order, status: 'preparing' }).id, 'ready');
  assert.equal(nextStatusFor({ ...order, status: 'ready' }).id, 'complete');
  assert.equal(nextStatusFor({ ...order, status: 'complete' }), null);
  assert.equal(nextStatusFor({ ...order, status: 'cancelled' }), null);
});

test('a cancelled order reports itself as cancelled', () => {
  const position = statusPosition({ orderType: ORDER_TYPE.DELIVERY, status: 'cancelled' });
  assert.equal(position.isCancelled, true);
  assert.equal(position.current.label, 'Cancelled');
});

// ── Reports ────────────────────────────────────────────────────────────────
//
// The API aggregates in SQL and returns one row per trading day. What is
// tested here is the roll-up into weeks and months, and the gap-filling that
// keeps a quiet day visible as a zero.
section('Revenue reports');

// A Wednesday.
const REPORT_TODAY = new Date(2026, 7, 12);

const day = (date, orders, revenuePence) => ({ date, orders, revenuePence });

test('daily buckets keep each day separate and fill the gaps', () => {
  const report = buildReport({
    granularity: GRANULARITY.DAILY,
    daily: [day('2026-08-12', 2, 2500), day('2026-08-11', 1, 2000)],
    today: REPORT_TODAY,
  });

  const today = report.buckets[report.buckets.length - 1];
  const yesterday = report.buckets[report.buckets.length - 2];

  assert.equal(report.buckets.length, 14);
  assert.equal(today.orders, 2);
  assert.equal(today.revenue, 2500);
  assert.equal(yesterday.orders, 1);
  assert.equal(yesterday.revenue, 2000);
  assert.equal(report.buckets[0].revenue, 0, 'a quiet day is a zero, not a missing bar');
});

test('weekly buckets start on Monday and gather the whole week', () => {
  // 2026-08-10 is a Monday; the 12th is that Wednesday.
  const report = buildReport({
    granularity: GRANULARITY.WEEKLY,
    daily: [day('2026-08-10', 1, 1000), day('2026-08-12', 1, 2000)],
    today: REPORT_TODAY,
  });

  const current = report.buckets[report.buckets.length - 1];

  assert.equal(current.orders, 2, 'both days fall in the same week');
  assert.equal(current.revenue, 3000);
  assert.equal(current.key, '2026-08-10', 'the week is keyed by its Monday');
});

test('monthly buckets gather the whole month', () => {
  const report = buildReport({
    granularity: GRANULARITY.MONTHLY,
    daily: [day('2026-08-01', 1, 1000), day('2026-08-12', 1, 2000), day('2026-07-20', 1, 4000)],
    today: REPORT_TODAY,
  });

  const august = report.buckets[report.buckets.length - 1];
  const july = report.buckets[report.buckets.length - 2];

  assert.equal(august.revenue, 3000);
  assert.equal(july.revenue, 4000);
  assert.equal(august.key, '2026-08-01', 'the month is keyed by its first');
});

test('days outside the window are ignored rather than folded into an edge bucket', () => {
  const report = buildReport({
    granularity: GRANULARITY.DAILY,
    daily: [day('2026-01-01', 3, 9999)],
    today: REPORT_TODAY,
  });

  assert.ok(
    report.buckets.every((bucket) => bucket.revenue === 0),
    'a January day must not land in an August bucket',
  );
});

test('the change figure compares the latest bucket with the one before', () => {
  const report = buildReport({
    granularity: GRANULARITY.DAILY,
    daily: [day('2026-08-12', 1, 1500), day('2026-08-11', 1, 1000)],
    today: REPORT_TODAY,
  });

  assert.equal(Math.round(report.changePercent), 50);
  assert.equal(report.peak.revenue, 1500);
});

test('a period with no prior revenue reports no change rather than infinity', () => {
  const report = buildReport({
    granularity: GRANULARITY.DAILY,
    daily: [day('2026-08-12', 1, 1500)],
    today: REPORT_TODAY,
  });

  assert.equal(report.changePercent, null, 'dividing by a zero previous period must not show ∞');
});

test('the requested range spans the window the chart will show', () => {
  const daily = reportRange(GRANULARITY.DAILY, REPORT_TODAY);
  assert.equal(daily.to, '2026-08-12');
  assert.equal(daily.from, '2026-07-30', '14 days inclusive');

  const monthly = reportRange(GRANULARITY.MONTHLY, REPORT_TODAY);
  assert.ok(monthly.from < '2025-09-01', 'a year of months needs a year of days');
});

// ── Option-group rules ─────────────────────────────────────────────────────
section('Option groups');

test('slugify makes safe ids and avoids collisions', () => {
  assert.equal(slugify('Choose your side'), 'choose-your-side');
  assert.equal(slugify('Extra Hot!! 🌶️'), 'extra-hot');
  assert.equal(slugify('Sides', ['sides']), 'sides-2');
  assert.equal(slugify('Sides', ['sides', 'sides-2']), 'sides-3');
  assert.equal(slugify('🌶️🌶️', [], 'group'), 'group', 'falls back when nothing survives');
});

test('the rule description matches what the item modal enforces', () => {
  assert.equal(describeGroupRule({ min: 1, max: 1 }), 'Required · choose 1');
  assert.equal(describeGroupRule({ min: 0, max: 1 }), 'Optional · choose 1');
  assert.equal(describeGroupRule({ min: 0, max: 5 }), 'Optional · up to 5');
  assert.equal(describeGroupRule({ min: 2, max: 2 }), 'Required · choose exactly 2');
  assert.equal(describeGroupRule({ min: 2, max: 4 }), 'Required · choose 2–4');
});

// ── Result ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);

if (failures.length > 0) {
  process.exitCode = 1;
}
