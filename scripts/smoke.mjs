/**
 * Smoke test for the ordering and admin logic.
 *
 * Covers the rules that are easy to get quietly wrong: late-night trading
 * hours, the manual open/close override, the delivery geofence, the
 * surcharge/promo/free-delivery maths, catalog edits, and revenue bucketing.
 *
 *   node scripts/smoke.mjs
 *
 * The repository falls back to an in-memory store when `localStorage` is
 * absent, so this runs in plain Node with no shims.
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
  generateImageId,
  formatBytes,
  putImageBlob,
  getImageBlob,
  deleteImage,
  listImageIds,
  pruneImages,
  IMAGE_ERRORS,
  MAX_SOURCE_BYTES,
} from '../src/lib/images.js';
import {
  getCatalog,
  saveCategory,
  deleteCategory,
  saveItem,
  deleteItem,
  setItemPublished,
  saveModifierGroup,
  deleteModifierGroup,
  itemsUsingModifierGroup,
  resetCatalog,
  setManualStatus,
  saveShifts,
  resetHours,
  getHours,
  MANUAL_STATUS,
  getBanners,
  saveBanner,
  deleteBanner,
  setBannerPublished,
  moveBanner,
  saveBannerSettings,
  resetBanners,
  allReferencedImageIds,
  getPromo,
  savePromo,
  resetPromo,
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
import { buildReport, topItems, GRANULARITY } from '../src/lib/reports.js';

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

/** Async variant, awaited via the queue at the end of the file. */
const asyncTests = [];
function testAsync(name, fn) {
  asyncTests.push({ name, fn });
}

function section(title) {
  console.log(`\n${title}`);
}

const findSeedItem = (id) => seedMenuItems.find((item) => item.id === id);

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

  saveShifts([{ day: 3, start: 8 * 3600, end: 23 * 3600, noDelivery: false, noPickup: false }]);
  assert.equal(isStoreOpen(nineAm), true, 'now open at 9am on Wednesday');

  resetHours();
  assert.equal(isStoreOpen(nineAm), false, 'reset restores the seed schedule');
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

test('a served district too far away is rejected on radius', () => {
  // ~56km due north: the district is one we serve, so this isolates the
  // radius check from the district check.
  const faraway = { lat: storeConfig.location.lat + 0.5, lng: storeConfig.location.lng };
  const result = checkDeliveryArea('AL10 8AB', faraway);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'outside-radius');
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

// ── Catalog administration ─────────────────────────────────────────────────
section('Catalog administration');

test('a new category and item round-trip through the repository', () => {
  resetCatalog();

  saveCategory({ id: 'loaded', name: 'Loaded Fries', emoji: '🍟', description: '', displayOrder: 99 });
  assert.ok(
    getCatalog().categories.some((category) => category.id === 'loaded'),
    'category was not saved',
  );

  saveItem({
    id: 'loaded-cheese',
    categoryId: 'loaded',
    name: 'Cheese Loaded Fries',
    description: '',
    emoji: '🧀',
    sizes: [{ id: 'std', name: 'Serve', price: 5.5 }],
    modifierGroups: [],
  });

  const saved = getCatalog().items.find((item) => item.id === 'loaded-cheese');
  assert.ok(saved, 'item was not saved');
  assert.equal(saved.sizes[0].price, 5.5);
});

test('deleting a category with items is refused', () => {
  const result = deleteCategory('loaded');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'has-items');
  assert.equal(result.count, 1);

  deleteItem('loaded-cheese');
  assert.equal(deleteCategory('loaded').ok, true, 'should delete once empty');
});

test('editing an item updates it in place rather than duplicating', () => {
  const before = getCatalog().items.length;
  saveItem({ id: 'holy-smash', name: 'Holy Smash (new recipe)' });

  assert.equal(getCatalog().items.length, before, 'item count should not change');
  assert.equal(
    getCatalog().items.find((item) => item.id === 'holy-smash').name,
    'Holy Smash (new recipe)',
  );
});

test('hiding an item takes it off the menu without deleting it', () => {
  setItemPublished('holy-smash', false);

  const item = getCatalog().items.find((candidate) => candidate.id === 'holy-smash');
  assert.ok(item, 'item should still exist');
  assert.equal(isPublished(item), false, 'item should be hidden');

  setItemPublished('holy-smash', true);
  assert.equal(
    isPublished(getCatalog().items.find((candidate) => candidate.id === 'holy-smash')),
    true,
  );
});

test('resetting the catalog restores the seed data', () => {
  resetCatalog();
  assert.equal(getCatalog().items.length, seedMenuItems.length);
  assert.equal(
    getCatalog().items.find((item) => item.id === 'holy-smash').name,
    'Holy Smash',
  );
});

// ── Option groups ──────────────────────────────────────────────────────────
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

test('an admin-created group round-trips and is attachable to an item', () => {
  resetCatalog();

  saveModifierGroup({
    id: 'salad',
    name: 'Salad',
    min: 0,
    max: 2,
    options: [
      { id: 'lettuce', name: 'Lettuce', price: 0 },
      { id: 'tomato', name: 'Tomato', price: 0.3 },
      { id: 'pickles', name: 'Pickles', price: 0.4 },
    ],
  });

  assert.ok(getCatalog().modifierGroups.salad, 'group was not saved');

  saveItem({ id: 'holy-smash', modifierGroups: ['sauceChoice', 'salad'] });

  const item = getCatalog().items.find((candidate) => candidate.id === 'holy-smash');
  const resolved = resolveModifierGroups(item, getCatalog().modifierGroups);

  assert.equal(resolved.length, 2, 'both groups should resolve');
  assert.ok(resolved.some((group) => group.id === 'salad'));
});

test('a group priced above zero adds to the line total', () => {
  const item = getCatalog().items.find((candidate) => candidate.id === 'holy-smash');
  const groups = resolveModifierGroups(item, getCatalog().modifierGroups);
  const salad = groups.find((group) => group.id === 'salad');
  const tomato = salad.options.find((option) => option.id === 'tomato');

  const line = buildLine({
    item,
    size: item.sizes[0],
    selectedModifiers: [
      {
        groupId: salad.id,
        groupName: salad.name,
        optionId: tomato.id,
        optionName: tomato.name,
        pricePence: toPence(tomato.price),
      },
    ],
    quantity: 1,
    notes: '',
  });

  assert.equal(lineUnitPence(line), 729, 'Holy Smash £6.99 plus a 30p tomato');
});

test('editing a group updates it in place', () => {
  saveModifierGroup({
    id: 'salad',
    name: 'Salad & pickles',
    min: 1,
    max: 3,
    options: [{ id: 'lettuce', name: 'Lettuce', price: 0 }],
  });

  const group = getCatalog().modifierGroups.salad;
  assert.equal(group.name, 'Salad & pickles');
  assert.equal(group.min, 1);
  assert.equal(group.options.length, 1);
  assert.equal(Object.keys(getCatalog().modifierGroups).filter((id) => id === 'salad').length, 1);
});

test('deleting a group in use is refused and names the items', () => {
  const inUse = itemsUsingModifierGroup('salad');
  assert.equal(inUse.length, 1);

  const result = deleteModifierGroup('salad');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'in-use');
  assert.equal(result.count, 1);
  assert.ok(result.items.includes('Holy Smash'));
  assert.ok(getCatalog().modifierGroups.salad, 'group must survive a refused delete');
});

test('force-deleting a group detaches it from every item', () => {
  const result = deleteModifierGroup('salad', { force: true });

  assert.equal(result.ok, true);
  assert.equal(result.detachedFrom, 1);
  assert.equal(getCatalog().modifierGroups.salad, undefined, 'group should be gone');

  const item = getCatalog().items.find((candidate) => candidate.id === 'holy-smash');
  assert.ok(
    !item.modifierGroups.includes('salad'),
    'the item must not keep a reference to a deleted group',
  );
});

test('an unused group deletes without a fight', () => {
  saveModifierGroup({
    id: 'temp',
    name: 'Temp',
    min: 0,
    max: 1,
    options: [{ id: 'a', name: 'A', price: 0 }],
  });

  assert.equal(itemsUsingModifierGroup('temp').length, 0);
  assert.equal(deleteModifierGroup('temp').ok, true);
  assert.equal(getCatalog().modifierGroups.temp, undefined);
});

test('a dangling group reference degrades quietly rather than crashing', () => {
  const item = { modifierGroups: ['sauceChoice', 'does-not-exist'] };
  const resolved = resolveModifierGroups(item, getCatalog().modifierGroups);

  assert.equal(resolved.length, 1, 'missing groups are dropped, not rendered as undefined');
  assert.equal(resolved[0].id, 'sauceChoice');
});

// ── Hero banners ───────────────────────────────────────────────────────────
section('Hero banners');

test('seed slides are all renderable and uniquely identified', () => {
  resetBanners();
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

test('a new slide is appended and given the next position', () => {
  resetBanners();
  const before = getBanners().slides.length;

  saveBanner({
    id: 'promo',
    heading: 'Student Tuesday',
    headingAccent: '',
    description: '',
    isPublished: true,
  });

  const slides = getBanners().slides;
  assert.equal(slides.length, before + 1);
  assert.equal(slides[slides.length - 1].id, 'promo');
  assert.equal(slides[slides.length - 1].displayOrder, before + 1);
});

test('editing a slide updates it in place and keeps its position', () => {
  const positionBefore = getBanners().slides.find((s) => s.id === 'promo').displayOrder;

  saveBanner({ id: 'promo', heading: 'Student Wednesday' });

  const slides = getBanners().slides;
  assert.equal(slides.filter((slide) => slide.id === 'promo').length, 1, 'must not duplicate');
  assert.equal(slides.find((slide) => slide.id === 'promo').heading, 'Student Wednesday');
  assert.equal(slides.find((slide) => slide.id === 'promo').displayOrder, positionBefore);
});

test('reordering swaps neighbours and renumbers densely', () => {
  resetBanners();
  const original = getBanners().slides.map((slide) => slide.id);

  assert.equal(moveBanner(original[0], 1), true);

  const after = getBanners().slides.map((slide) => slide.id);
  assert.equal(after[0], original[1], 'second slide should now be first');
  assert.equal(after[1], original[0]);

  // Positions must stay 1..n with no gaps, whatever the moves were.
  assert.deepEqual(
    getBanners().slides.map((slide) => slide.displayOrder),
    after.map((_, index) => index + 1),
  );
});

test('reordering past either end is refused', () => {
  resetBanners();
  const slides = getBanners().slides;

  assert.equal(moveBanner(slides[0].id, -1), false, 'cannot move the first slide up');
  assert.equal(moveBanner(slides[slides.length - 1].id, 1), false, 'cannot move the last one down');
  assert.equal(moveBanner('does-not-exist', 1), false);
});

test('hiding a slide keeps it but takes it off the homepage', () => {
  resetBanners();
  const target = getBanners().slides[0];

  setBannerPublished(target.id, false);

  const stored = getBanners().slides.find((slide) => slide.id === target.id);
  assert.ok(stored, 'the slide should still exist');
  assert.equal(stored.isPublished, false);
  assert.equal(isPublished(stored), false, 'the storefront filter must exclude it');

  setBannerPublished(target.id, true);
  assert.equal(isPublished(getBanners().slides.find((s) => s.id === target.id)), true);
});

test('deleting a slide removes it and closes the gap', () => {
  resetBanners();
  const target = getBanners().slides[1];

  deleteBanner(target.id);

  const slides = getBanners().slides;
  assert.ok(!slides.some((slide) => slide.id === target.id));
  assert.deepEqual(
    slides.map((slide) => slide.displayOrder),
    slides.map((_, index) => index + 1),
  );
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

test('effect settings round-trip and clamp on the way in', () => {
  resetBanners();

  saveBannerSettings({ areEmbersOn: true, emberIntensity: 5 });
  assert.equal(getBanners().settings.emberIntensity, 1, 'clamped on write, not on read');
  assert.equal(getBanners().settings.areEmbersOn, true);

  saveBannerSettings({ isAutoplayOn: false });
  assert.equal(getBanners().settings.isAutoplayOn, false);
  assert.equal(getBanners().settings.emberIntensity, 1, 'unrelated setting untouched');
});

test('settings survive a save and clamp on the way in', () => {
  saveBannerSettings({ autoplaySeconds: 500, isAutoplayOn: false });

  const { settings } = getBanners();
  assert.equal(settings.autoplaySeconds, AUTOPLAY_MAX_SECONDS);
  assert.equal(settings.isAutoplayOn, false);

  saveBannerSettings({ isAutoplayOn: true });
  assert.equal(getBanners().settings.isAutoplayOn, true);
  assert.equal(getBanners().settings.autoplaySeconds, AUTOPLAY_MAX_SECONDS, 'unrelated key kept');
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

test('banner images are counted as referenced, not orphans', () => {
  resetCatalog();
  resetBanners();

  saveBanner({ id: 'promo-img', heading: 'With a photo', imageId: 'img_banner_1' });
  saveItem({ id: 'holy-smash', imageId: 'img_item_1' });
  saveCategory({ id: 'beef-burgers', name: 'Beef Burgers', imageId: 'img_cat_1' });

  const referenced = allReferencedImageIds();

  // Pruning against the menu alone would have deleted the banner's photo.
  assert.ok(referenced.includes('img_banner_1'), 'banner photo must be kept');
  assert.ok(referenced.includes('img_item_1'), 'item photo must be kept');
  assert.ok(referenced.includes('img_cat_1'), 'category photo must be kept');
  assert.ok(
    referenced.every(Boolean),
    'items without a photo must not contribute null to the keep-list',
  );
});

test('a slide background image is referenced as well as its photo', () => {
  resetCatalog();
  resetBanners();

  saveBanner({
    id: 'promo-bg',
    heading: 'With a backdrop',
    imageId: 'img_slide_1',
    backgroundImageId: 'img_bg_1',
  });

  const referenced = allReferencedImageIds();

  // The two live on the same slide, so missing the second one would prune a
  // backdrop the shop had just uploaded.
  assert.ok(referenced.includes('img_slide_1'), 'slide photo must be kept');
  assert.ok(referenced.includes('img_bg_1'), 'slide background must be kept');
});

test('the coupon is editable and clamps on the way in', () => {
  resetPromo();

  savePromo({ code: '  summer20 ', percentage: 20, minimumSpend: 15 });
  const promo = getPromo();

  assert.equal(promo.code, 'SUMMER20', 'stored trimmed and upper-case');
  assert.equal(promo.percentage, 20);
  assert.equal(promo.minimumSpend, 15);

  savePromo({ percentage: 500 });
  assert.equal(getPromo().percentage, 100, 'a discount over 100% is refused');

  savePromo({ percentage: -10 });
  assert.equal(getPromo().percentage, 0);

  savePromo({ minimumSpend: 'not a number' });
  assert.equal(getPromo().minimumSpend, 20, 'falls back to the seed minimum');

  resetPromo();
  assert.equal(getPromo().code, 'EATON10', 'reset restores the seeded coupon');
});

test('the basket honours the edited coupon, not the seeded one', () => {
  resetPromo();

  // The seeded code stops working once the shop changes it — this is the whole
  // point of the coupon being editable, and the easiest thing to get wrong is
  // leaving pricing pointed at the static seed.
  savePromo({ code: 'SUMMER20', percentage: 20, minimumSpend: 10 });

  assert.equal(evaluatePromo('EATON10', 5000).valid, false, 'the old code is dead');

  const applied = evaluatePromo('summer20', 5000);
  assert.equal(applied.valid, true, 'the new code applies, case-insensitively');
  assert.equal(applied.discountPence, 1000, '20% of £50');

  const tooSmall = evaluatePromo('SUMMER20', 500);
  assert.equal(tooSmall.valid, false);
  assert.equal(tooSmall.reason, 'below-minimum');

  savePromo({ isOn: false });
  assert.equal(evaluatePromo('SUMMER20', 5000).valid, false, 'a paused offer refuses its own code');

  resetPromo();
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
  for (const reason of ['no-file', 'not-an-image', 'too-large', 'decode', 'store']) {
    assert.ok(IMAGE_ERRORS[reason], `no message for "${reason}"`);
  }
});

test('image ids are unique', () => {
  const ids = new Set(Array.from({ length: 500 }, () => generateImageId()));
  assert.equal(ids.size, 500, 'id collision would overwrite another photo');
});

test('formatBytes is readable at each scale', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
});

test('an item keeps its image id through a save/edit cycle', () => {
  resetCatalog();
  saveItem({ id: 'holy-smash', imageId: 'img_test_1' });

  const item = getCatalog().items.find((candidate) => candidate.id === 'holy-smash');
  assert.equal(item.imageId, 'img_test_1');

  // An unrelated edit must not silently drop the photo.
  saveItem({ id: 'holy-smash', name: 'Holy Smash' });
  assert.equal(
    getCatalog().items.find((candidate) => candidate.id === 'holy-smash').imageId,
    'img_test_1',
  );
});

test('a basket line snapshots the image id alongside the price', () => {
  const item = getCatalog().items.find((candidate) => candidate.id === 'holy-smash');
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

// The blob store falls back to memory outside a browser, so the storage
// contract is still exercised here.
testAsync('blobs round-trip through the image store', async () => {
  await putImageBlob('img_a', 'fake-blob-a');
  await putImageBlob('img_b', 'fake-blob-b');

  assert.equal(await getImageBlob('img_a'), 'fake-blob-a');
  assert.equal(await getImageBlob('img_b'), 'fake-blob-b');
  assert.equal(await getImageBlob('img_missing'), null, 'a missing id must not throw');
  assert.equal(await getImageBlob(null), null);
});

testAsync('deleting an image removes only that one', async () => {
  await deleteImage('img_a');

  assert.equal(await getImageBlob('img_a'), null);
  assert.equal(await getImageBlob('img_b'), 'fake-blob-b');
});

testAsync('pruning drops orphans and keeps referenced images', async () => {
  await putImageBlob('img_keep', 'keep');
  await putImageBlob('img_orphan', 'orphan');

  // Nulls stand for items with no photo and must not break the keep-set.
  const removed = await pruneImages(['img_keep', null, undefined]);

  assert.ok(removed >= 1, 'the orphan should have been swept up');
  assert.equal(await getImageBlob('img_keep'), 'keep');
  assert.equal(await getImageBlob('img_orphan'), null);
  assert.equal(await getImageBlob('img_b'), null, 'unreferenced images go too');

  const remaining = await listImageIds();
  assert.deepEqual(remaining, ['img_keep']);
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
section('Revenue reports');

function fakeOrder({ at, total, orderType = ORDER_TYPE.PICKUP, status = 'complete', itemCount = 2 }) {
  return {
    reference: `EF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    placedAt: at.toISOString(),
    readyAt: at.toISOString(),
    orderType,
    status,
    customer: { name: 'Test' },
    lines: [
      {
        lineId: 'x',
        itemId: 'holy-smash',
        name: 'Holy Smash',
        emoji: '🍔',
        sizePence: total,
        modifiers: [],
        quantity: 1,
      },
    ],
    totals: { total, subtotal: total, discount: 0, delivery: 0, surcharge: 0, itemCount },
  };
}

const REPORT_NOW = fromStoreWallTime(2026, 8, 12, 20 * 3600); // Wed 8pm

test('daily buckets group orders by store-local day', () => {
  const orders = [
    fakeOrder({ at: fromStoreWallTime(2026, 8, 12, 13 * 3600), total: 1000 }),
    fakeOrder({ at: fromStoreWallTime(2026, 8, 12, 19 * 3600), total: 1500 }),
    fakeOrder({ at: fromStoreWallTime(2026, 8, 11, 19 * 3600), total: 2000 }),
  ];

  const report = buildReport({ granularity: GRANULARITY.DAILY, orders, now: REPORT_NOW });
  const today = report.buckets[report.buckets.length - 1];
  const yesterday = report.buckets[report.buckets.length - 2];

  assert.equal(today.orders, 2);
  assert.equal(today.revenue, 2500);
  assert.equal(yesterday.orders, 1);
  assert.equal(yesterday.revenue, 2000);
  assert.equal(report.totals.revenue, 4500);
});

test('buckets are continuous, so quiet days appear as zeroes', () => {
  const report = buildReport({ granularity: GRANULARITY.DAILY, orders: [], now: REPORT_NOW });

  assert.equal(report.buckets.length, 14);
  assert.ok(
    report.buckets.every((bucket) => bucket.revenue === 0),
    'empty window should be all zeroes, not missing buckets',
  );

  // Each bucket must be exactly one day after the previous one.
  for (let index = 1; index < report.buckets.length; index += 1) {
    const gap = report.buckets[index].start - report.buckets[index - 1].start;
    assert.ok(gap > 0, 'buckets must run forwards');
  }
});

test('cancelled orders are excluded from revenue but still counted', () => {
  const orders = [
    fakeOrder({ at: fromStoreWallTime(2026, 8, 12, 13 * 3600), total: 1000 }),
    fakeOrder({ at: fromStoreWallTime(2026, 8, 12, 14 * 3600), total: 5000, status: 'cancelled' }),
  ];

  const report = buildReport({ granularity: GRANULARITY.DAILY, orders, now: REPORT_NOW });

  assert.equal(report.totals.revenue, 1000, 'cancelled revenue must not count');
  assert.equal(report.totals.orders, 1);
  assert.equal(report.totals.cancelled, 1);
});

test('weekly buckets start on Monday and gather the whole week', () => {
  // 2026-08-10 is a Monday; the 12th is that Wednesday.
  const orders = [
    fakeOrder({ at: fromStoreWallTime(2026, 8, 10, 13 * 3600), total: 1000 }),
    fakeOrder({ at: fromStoreWallTime(2026, 8, 12, 13 * 3600), total: 2000 }),
  ];

  const report = buildReport({ granularity: GRANULARITY.WEEKLY, orders, now: REPORT_NOW });
  const current = report.buckets[report.buckets.length - 1];

  assert.equal(current.orders, 2, 'both orders fall in the same week');
  assert.equal(current.revenue, 3000);
  assert.equal(storeParts(current.start).isoDay, 1, 'week must start on Monday');
});

test('monthly buckets gather the whole month', () => {
  const orders = [
    fakeOrder({ at: fromStoreWallTime(2026, 8, 1, 13 * 3600), total: 1000 }),
    fakeOrder({ at: fromStoreWallTime(2026, 8, 12, 13 * 3600), total: 2000 }),
    fakeOrder({ at: fromStoreWallTime(2026, 7, 20, 13 * 3600), total: 4000 }),
  ];

  const report = buildReport({ granularity: GRANULARITY.MONTHLY, orders, now: REPORT_NOW });
  const august = report.buckets[report.buckets.length - 1];
  const july = report.buckets[report.buckets.length - 2];

  assert.equal(august.revenue, 3000);
  assert.equal(july.revenue, 4000);
  assert.equal(storeParts(august.start).day, 1, 'month must start on the 1st');
});

test('order-type split and average order value are computed', () => {
  const orders = [
    fakeOrder({ at: fromStoreWallTime(2026, 8, 12, 13 * 3600), total: 1000, orderType: ORDER_TYPE.DELIVERY }),
    fakeOrder({ at: fromStoreWallTime(2026, 8, 12, 14 * 3600), total: 3000, orderType: ORDER_TYPE.PICKUP }),
  ];

  const report = buildReport({ granularity: GRANULARITY.DAILY, orders, now: REPORT_NOW });

  assert.equal(report.totals.delivery, 1);
  assert.equal(report.totals.collection, 1);
  assert.equal(report.totals.deliveryRevenue, 1000);
  assert.equal(report.totals.collectionRevenue, 3000);
  assert.equal(report.totals.averageOrderValue, 2000);
});

test('orders older than the window are ignored', () => {
  const orders = [fakeOrder({ at: fromStoreWallTime(2026, 1, 1, 13 * 3600), total: 9999 })];
  const report = buildReport({ granularity: GRANULARITY.DAILY, orders, now: REPORT_NOW });

  assert.equal(report.totals.revenue, 0, 'January order is outside a 14-day window');
});

test('best sellers rank by units sold', () => {
  const orders = [
    {
      ...fakeOrder({ at: fromStoreWallTime(2026, 8, 12, 13 * 3600), total: 1000 }),
      lines: [
        { lineId: 'a', itemId: 'fries', name: 'Fries', emoji: '🍟', sizePence: 299, modifiers: [], quantity: 3 },
        { lineId: 'b', itemId: 'holy-smash', name: 'Holy Smash', emoji: '🍔', sizePence: 699, modifiers: [], quantity: 1 },
      ],
    },
  ];

  const best = topItems({ orders });

  assert.equal(best[0].itemId, 'fries');
  assert.equal(best[0].quantity, 3);
  assert.equal(best[0].revenue, 897);
});

// ── Async queue ────────────────────────────────────────────────────────────
section('Image storage (async)');

for (const { name, fn } of asyncTests) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

// ── Result ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);

if (failures.length > 0) {
  process.exitCode = 1;
}
