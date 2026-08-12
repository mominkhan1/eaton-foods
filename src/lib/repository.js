/**
 * Data layer.
 *
 * The catalog, trading hours, hero banners and the coupon all live in MySQL and
 * are read and written through the API. This module is the one place that
 * knows that: everything else reads a snapshot from here and subscribes for
 * changes.
 *
 * WHY A SNAPSHOT. Reads are synchronous (`getCatalog()`, `getHours()`) because
 * the whole render tree — the menu, the hero, the opening-hours engine, the
 * basket's promo check — asks for this data during render, dozens of times a
 * second. Threading a promise through all of that would turn every component
 * into a loading state for data that changed once, minutes ago. So the API
 * response is held in memory and handed out as-is; `hydrate()` fills it,
 * `subscribe()` announces a change, and the writes below are async because
 * they are the only things that actually go to the network.
 *
 * Until `hydrate()` resolves, the getters return the seed data from src/data.
 * That keeps the first paint composed rather than empty, and keeps this module
 * usable in Node (the smoke test) where there is no API to call.
 */

import { api } from './api.js';
import { registerImageUrls } from './images.js';
import {
  seedCategories,
  seedMenuItems,
  seedModifierGroups,
} from '../data/menu.js';
import { seedShifts, seedClosedDates, orderSetup } from '../data/store.js';
import { seedBanners, seedBannerSettings } from '../data/banners.js';

export const MANUAL_STATUS = {
  AUTO: 'auto',
  OPEN: 'open',
  CLOSED: 'closed',
};

// ── Snapshot ───────────────────────────────────────────────────────────────

function seedCatalog() {
  return {
    categories: structuredClone(seedCategories),
    items: structuredClone(seedMenuItems),
    modifierGroups: structuredClone(seedModifierGroups),
  };
}

function seedHours() {
  return {
    shifts: structuredClone(seedShifts),
    closedDates: structuredClone(seedClosedDates),
    // `auto` follows the schedule; the other two override it, which is what
    // the shop needs when the fryer breaks or a rush runs long.
    manualStatus: MANUAL_STATUS.AUTO,
  };
}

function seedBannerState() {
  return {
    slides: structuredClone(seedBanners),
    settings: { ...seedBannerSettings },
  };
}

const snapshot = {
  catalog: seedCatalog(),
  hours: seedHours(),
  banners: seedBannerState(),
  promo: { ...orderSetup.promo },
};

/** False until the API has answered — the UI shows this as a loading state. */
let hydrated = false;

/** The last hydrate failure, so screens can offer a retry with a reason. */
let hydrationError = null;

export function isHydrated() {
  return hydrated;
}

export function getHydrationError() {
  return hydrationError;
}

// ── Subscriptions ──────────────────────────────────────────────────────────

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event) {
  for (const listener of listeners) listener(event);
}

// ── Applying server responses ──────────────────────────────────────────────
//
// Each of these takes a payload in the API's shape and installs it. They are
// exported for the smoke test, which has no server to talk to and needs a way
// to put the store into a known state.

export function applyCatalog(catalog) {
  if (!catalog) return;
  registerImageUrls(catalog);
  snapshot.catalog = {
    categories: catalog.categories ?? [],
    items: catalog.items ?? [],
    modifierGroups: catalog.modifierGroups ?? {},
  };
  emit({ type: 'catalog' });
}

export function applyHours(hours) {
  if (!hours) return;
  snapshot.hours = {
    shifts: hours.shifts ?? [],
    closedDates: hours.closedDates ?? [],
    manualStatus: hours.manualStatus ?? MANUAL_STATUS.AUTO,
  };
  emit({ type: 'hours' });
}

export function applyBanners(banners) {
  if (!banners) return;
  registerImageUrls(banners);
  snapshot.banners = {
    slides: banners.slides ?? [],
    // Merge the seed underneath, so a setting gaining a field reads a default
    // rather than `undefined` on a shop whose stored copy predates it.
    settings: { ...seedBannerSettings, ...banners.settings },
  };
  emit({ type: 'banners' });
}

export function applyPromo(promo) {
  if (!promo) return;
  snapshot.promo = { ...orderSetup.promo, ...promo };
  emit({ type: 'promo' });
}

// ── Hydration ──────────────────────────────────────────────────────────────

/**
 * Load everything the app needs in one pass.
 *
 * `admin` asks for the unpublished rows too: the storefront must never see a
 * hidden item, but the panel that manages them has to.
 *
 * The four requests go out together rather than in sequence — they do not
 * depend on each other, and on a phone connection four round trips one after
 * another is the difference between a fast first paint and a slow one.
 */
export async function hydrate({ admin = false, signal } = {}) {
  try {
    const [catalog, hours, banners, promo] = await Promise.all([
      admin ? api.admin.getCatalog({ signal }) : api.getCatalog({ signal }),
      api.getHours({ signal }),
      admin ? api.admin.getBanners({ signal }) : api.getBanners({ signal }),
      api.getPromo({ signal }),
    ]);

    applyCatalog(catalog);
    applyHours(hours);
    applyBanners(banners);
    applyPromo(promo);

    hydrated = true;
    hydrationError = null;
    emit({ type: 'hydrated' });

    return { ok: true };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;

    hydrationError = error;
    emit({ type: 'hydration-error' });

    return { ok: false, error };
  }
}

/** Re-read the catalog after a write. */
async function refreshCatalog({ admin = true } = {}) {
  applyCatalog(admin ? await api.admin.getCatalog() : await api.getCatalog());
}

// ── Catalog ────────────────────────────────────────────────────────────────

export function getCatalog() {
  return snapshot.catalog;
}

export async function saveCategory(category) {
  await api.admin.saveCategory(category);
  await refreshCatalog();
  return category;
}

/**
 * Removing a category would orphan its items, so the API refuses while any
 * remain. The refusal is turned back into the `{ ok, reason, count }` shape
 * the admin screen already knows how to explain.
 */
export async function deleteCategory(categoryId) {
  try {
    await api.admin.deleteCategory(categoryId);
  } catch (error) {
    if (error?.code === 'has_items') {
      return { ok: false, reason: 'has-items', count: error.count ?? 0 };
    }
    throw error;
  }

  await refreshCatalog();
  return { ok: true };
}

export async function reorderCategories(orderedIds) {
  await api.admin.reorderCategories(orderedIds);
  await refreshCatalog();
}

/**
 * Save an item.
 *
 * The API replaces the row wholesale, so a partial patch would blank whatever
 * it left out. Callers that mean "change one field" get merged over the stored
 * item first — which is what keeps an unrelated edit from dropping the photo.
 */
export async function saveItem(item) {
  const existing = snapshot.catalog.items.find((candidate) => candidate.id === item.id);
  const merged = existing ? { ...existing, ...item } : item;

  await api.admin.saveItem(merged);
  await refreshCatalog();
  return merged;
}

export async function deleteItem(itemId) {
  await api.admin.deleteItem(itemId);
  await refreshCatalog();
}

/** Soft availability toggle — keeps the item but hides it from the menu. */
export async function setItemPublished(itemId, isPublished) {
  return saveItem({ id: itemId, isPublished });
}

// ── Option (modifier) groups ───────────────────────────────────────────────

export async function saveModifierGroup(group) {
  await api.admin.saveModifierGroup(group);
  await refreshCatalog();
  return group;
}

export function itemsUsingModifierGroup(groupId) {
  return getCatalog().items.filter((item) => (item.modifierGroups ?? []).includes(groupId));
}

/**
 * Deleting a group that items still reference would leave them silently
 * missing an option the kitchen expects, so the API refuses by default.
 * `force` detaches it from every item first.
 */
export async function deleteModifierGroup(groupId, { force = false } = {}) {
  let response;

  try {
    response = await api.admin.deleteModifierGroup(groupId, { force });
  } catch (error) {
    if (error?.code === 'group_in_use') {
      return {
        ok: false,
        reason: 'in-use',
        count: error.count ?? 0,
        items: error.items ?? [],
      };
    }
    throw error;
  }

  await refreshCatalog();
  return { ok: true, detachedFrom: response?.detachedFrom ?? 0 };
}

// ── Trading hours ──────────────────────────────────────────────────────────

export function getHours() {
  return snapshot.hours;
}

export async function saveShifts(shifts) {
  applyHours(await api.admin.saveHours({ shifts }));
}

export async function setManualStatus(manualStatus) {
  applyHours(await api.admin.saveHours({ manualStatus }));
}

export async function saveClosedDates(closedDates) {
  applyHours(await api.admin.saveHours({ closedDates }));
}

// ── Hero banners ───────────────────────────────────────────────────────────

export function getBanners() {
  return snapshot.banners;
}

export async function saveBanner(banner) {
  const existing = snapshot.banners.slides.find((slide) => slide.id === banner.id);
  applyBanners(await api.admin.saveBanner(existing ? { ...existing, ...banner } : banner));
  return banner;
}

export async function deleteBanner(bannerId) {
  applyBanners(await api.admin.deleteBanner(bannerId));
}

export async function setBannerPublished(bannerId, isPublished) {
  return saveBanner({ id: bannerId, isPublished });
}

/** Move a slide one place earlier (-1) or later (+1). */
export async function moveBanner(bannerId, direction) {
  const slides = [...snapshot.banners.slides].sort((a, b) => a.displayOrder - b.displayOrder);
  const index = slides.findIndex((slide) => slide.id === bannerId);
  const target = index + direction;

  if (index === -1 || target < 0 || target >= slides.length) return false;

  [slides[index], slides[target]] = [slides[target], slides[index]];
  applyBanners(await api.admin.reorderBanners(slides.map((slide) => slide.id)));

  return true;
}

export async function saveBannerSettings(patch) {
  applyBanners(await api.admin.saveBannerSettings(patch));
}

// ── Promotion ──────────────────────────────────────────────────────────────

/**
 * The first-order coupon shown in the top strip and honoured at checkout.
 *
 * `getPromo` is what `pricing.evaluatePromo` validates against, so changing
 * the code here changes what the basket accepts. The server re-checks it at
 * checkout regardless — this copy decides what the customer is *shown*, never
 * what they are charged.
 */
export function getPromo() {
  return snapshot.promo;
}

export async function savePromo(patch) {
  applyPromo(await api.admin.savePromo(patch));
}

// ── Maintenance ────────────────────────────────────────────────────────────

/**
 * Every image id the app still needs, across all collections.
 *
 * Anything asking "is this photo still in use?" must use this rather than a
 * single screen's own list — checking the menu alone would treat every banner
 * photo as an orphan.
 */
export function allReferencedImageIds() {
  const catalog = getCatalog();
  const banners = getBanners();

  return [
    ...catalog.items.map((item) => item.imageId),
    ...catalog.categories.map((category) => category.imageId),
    ...banners.slides.map((slide) => slide.imageId),
    ...banners.slides.map((slide) => slide.backgroundImageId),
  ].filter(Boolean);
}

/** Test hook — puts the store back to the seed data without touching the API. */
export function resetToSeed() {
  snapshot.catalog = seedCatalog();
  snapshot.hours = seedHours();
  snapshot.banners = seedBannerState();
  snapshot.promo = { ...orderSetup.promo };
  hydrated = false;
  hydrationError = null;
  emit({ type: 'reset' });
}
