/**
 * Data layer.
 *
 * Everything mutable — the catalog, trading hours and orders — is read and
 * written through here. Today it is backed by `localStorage`; swapping in an
 * API means reimplementing the read/write pairs in this one file.
 *
 * IMPORTANT: `localStorage` is per-browser. The admin panel therefore only
 * sees orders placed in the *same browser*. Cross-tab updates work (via the
 * `storage` event), which is enough to demo the whole loop, but a real shop
 * needs a server. See README § Not yet wired up.
 */

import {
  seedCategories,
  seedMenuItems,
  seedModifierGroups,
} from '../data/menu.js';
import { seedShifts, seedClosedDates, orderSetup } from '../data/store.js';
import {
  seedBanners,
  seedBannerSettings,
  clampAutoplaySeconds,
  clampIntensity,
} from '../data/banners.js';

/*
 * Bump a key when its seed data changes shape or content — a stored catalog
 * always wins over the seed, so without a bump an existing browser would keep
 * serving the previous menu forever.
 *
 * catalog v3: the real Eat On menu replaced the placeholder one.
 */
const KEYS = {
  catalog: 'eaton.catalog.v3',
  hours: 'eaton.hours.v2',
  orders: 'eaton.orders.v2',
  banners: 'eaton.banners.v1',
  promo: 'eaton.promo.v1',
};

/** Node (and private browsing) fall back to memory so nothing throws. */
const memory = new Map();

const storage = (() => {
  try {
    if (typeof localStorage === 'undefined') throw new Error('no localStorage');
    localStorage.getItem('__probe__');
    return localStorage;
  } catch {
    return {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => memory.set(key, value),
      removeItem: (key) => memory.delete(key),
    };
  }
})();

function read(key, fallback) {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode — the in-memory cache below still holds the value
    // for this session.
  }
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

// Another tab changed something — drop the cache and tell everyone.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!Object.values(KEYS).includes(event.key)) return;
    invalidateCache();
    emit({ type: 'external', key: event.key });
  });
}

const cache = { catalog: null, hours: null, orders: null, banners: null };

// ── Catalog ────────────────────────────────────────────────────────────────

function seedCatalog() {
  return {
    categories: structuredClone(seedCategories),
    items: structuredClone(seedMenuItems),
    modifierGroups: structuredClone(seedModifierGroups),
  };
}

export function getCatalog() {
  if (!cache.catalog) {
    const stored = read(KEYS.catalog, null);
    cache.catalog = stored ?? seedCatalog();
    if (!stored) write(KEYS.catalog, cache.catalog);
  }
  return cache.catalog;
}

function saveCatalog(catalog) {
  cache.catalog = catalog;
  write(KEYS.catalog, catalog);
  emit({ type: 'catalog' });
}

export function saveCategory(category) {
  const catalog = getCatalog();
  const categories = [...catalog.categories];
  const index = categories.findIndex((candidate) => candidate.id === category.id);

  if (index === -1) categories.push(category);
  else categories[index] = { ...categories[index], ...category };

  saveCatalog({ ...catalog, categories });
  return category;
}

/**
 * Removing a category would orphan its items, so this refuses while any
 * remain. The caller decides whether to move or delete them first.
 */
export function deleteCategory(categoryId) {
  const catalog = getCatalog();
  const orphans = catalog.items.filter((item) => item.categoryId === categoryId);

  if (orphans.length > 0) {
    return { ok: false, reason: 'has-items', count: orphans.length };
  }

  saveCatalog({
    ...catalog,
    categories: catalog.categories.filter((category) => category.id !== categoryId),
  });

  return { ok: true };
}

export function reorderCategories(orderedIds) {
  const catalog = getCatalog();
  const categories = catalog.categories.map((category) => ({
    ...category,
    displayOrder: orderedIds.indexOf(category.id) + 1,
  }));
  saveCatalog({ ...catalog, categories });
}

export function saveItem(item) {
  const catalog = getCatalog();
  const items = [...catalog.items];
  const index = items.findIndex((candidate) => candidate.id === item.id);

  if (index === -1) items.push(item);
  else items[index] = { ...items[index], ...item };

  saveCatalog({ ...catalog, items });
  return item;
}

export function deleteItem(itemId) {
  const catalog = getCatalog();
  saveCatalog({ ...catalog, items: catalog.items.filter((item) => item.id !== itemId) });
}

// ── Option (modifier) groups ───────────────────────────────────────────────

export function saveModifierGroup(group) {
  const catalog = getCatalog();
  saveCatalog({
    ...catalog,
    modifierGroups: { ...catalog.modifierGroups, [group.id]: group },
  });
  return group;
}

export function itemsUsingModifierGroup(groupId) {
  return getCatalog().items.filter((item) => (item.modifierGroups ?? []).includes(groupId));
}

/**
 * Deleting a group that items still reference would leave them silently
 * missing an option the kitchen expects, so this refuses by default.
 * `force` detaches it from every item first.
 */
export function deleteModifierGroup(groupId, { force = false } = {}) {
  const inUse = itemsUsingModifierGroup(groupId);

  if (inUse.length > 0 && !force) {
    return {
      ok: false,
      reason: 'in-use',
      count: inUse.length,
      items: inUse.map((item) => item.name),
    };
  }

  const catalog = getCatalog();
  const modifierGroups = { ...catalog.modifierGroups };
  delete modifierGroups[groupId];

  saveCatalog({
    ...catalog,
    modifierGroups,
    items: catalog.items.map((item) =>
      (item.modifierGroups ?? []).includes(groupId)
        ? { ...item, modifierGroups: item.modifierGroups.filter((id) => id !== groupId) }
        : item,
    ),
  });

  return { ok: true, detachedFrom: inUse.length };
}

/** Soft availability toggle — keeps the item but hides it from the menu. */
export function setItemPublished(itemId, isPublished) {
  const catalog = getCatalog();
  saveCatalog({
    ...catalog,
    items: catalog.items.map((item) =>
      item.id === itemId ? { ...item, isPublished } : item,
    ),
  });
}

// ── Trading hours ──────────────────────────────────────────────────────────

export const MANUAL_STATUS = {
  AUTO: 'auto',
  OPEN: 'open',
  CLOSED: 'closed',
};

function seedHours() {
  return {
    shifts: structuredClone(seedShifts),
    closedDates: structuredClone(seedClosedDates),
    // `auto` follows the schedule; the other two override it, which is what
    // the shop needs when the fryer breaks or a rush runs long.
    manualStatus: MANUAL_STATUS.AUTO,
  };
}

export function getHours() {
  if (!cache.hours) {
    const stored = read(KEYS.hours, null);
    cache.hours = stored ?? seedHours();
    if (!stored) write(KEYS.hours, cache.hours);
  }
  return cache.hours;
}

function saveHours(hours) {
  cache.hours = hours;
  write(KEYS.hours, hours);
  emit({ type: 'hours' });
}

export function saveShifts(shifts) {
  saveHours({ ...getHours(), shifts });
}

export function setManualStatus(manualStatus) {
  saveHours({ ...getHours(), manualStatus });
}

export function saveClosedDates(closedDates) {
  saveHours({ ...getHours(), closedDates });
}

// ── Hero banners ───────────────────────────────────────────────────────────

function seedBannerState() {
  return {
    slides: structuredClone(seedBanners),
    settings: { ...seedBannerSettings },
  };
}

export function getBanners() {
  if (!cache.banners) {
    const stored = read(KEYS.banners, null);

    if (stored) {
      // Settings gain keys as features land. Merging the seed underneath means
      // an existing browser picks up new defaults instead of reading
      // `undefined` — no storage-key bump, and the shop keeps its slides.
      cache.banners = {
        slides: stored.slides ?? [],
        settings: { ...seedBannerSettings, ...stored.settings },
      };
    } else {
      cache.banners = seedBannerState();
      write(KEYS.banners, cache.banners);
    }
  }
  return cache.banners;
}

function saveBannerState(state) {
  // Renumber on every write so the order is always dense and 1-based, whatever
  // the caller did.
  const slides = [...state.slides]
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((slide, index) => ({ ...slide, displayOrder: index + 1 }));

  cache.banners = { ...state, slides };
  write(KEYS.banners, cache.banners);
  emit({ type: 'banners' });
}

export function saveBanner(banner) {
  const state = getBanners();
  const slides = [...state.slides];
  const index = slides.findIndex((candidate) => candidate.id === banner.id);

  if (index === -1) {
    slides.push({ ...banner, displayOrder: banner.displayOrder ?? slides.length + 1 });
  } else {
    slides[index] = { ...slides[index], ...banner };
  }

  saveBannerState({ ...state, slides });
  return banner;
}

export function deleteBanner(bannerId) {
  const state = getBanners();
  saveBannerState({
    ...state,
    slides: state.slides.filter((slide) => slide.id !== bannerId),
  });
}

export function setBannerPublished(bannerId, isPublished) {
  const state = getBanners();
  saveBannerState({
    ...state,
    slides: state.slides.map((slide) =>
      slide.id === bannerId ? { ...slide, isPublished } : slide,
    ),
  });
}

/** Move a slide one place earlier (-1) or later (+1). */
export function moveBanner(bannerId, direction) {
  const state = getBanners();
  const slides = [...state.slides].sort((a, b) => a.displayOrder - b.displayOrder);
  const index = slides.findIndex((slide) => slide.id === bannerId);
  const target = index + direction;

  if (index === -1 || target < 0 || target >= slides.length) return false;

  [slides[index], slides[target]] = [slides[target], slides[index]];
  // The renumber in saveBannerState needs the new positions to sort by.
  saveBannerState({
    ...state,
    slides: slides.map((slide, position) => ({ ...slide, displayOrder: position + 1 })),
  });

  return true;
}

export function saveBannerSettings(patch) {
  const state = getBanners();
  const settings = { ...state.settings, ...patch };

  if ('autoplaySeconds' in patch) {
    settings.autoplaySeconds = clampAutoplaySeconds(patch.autoplaySeconds);
  }
  if ('emberIntensity' in patch) {
    settings.emberIntensity = clampIntensity(
      patch.emberIntensity,
      seedBannerSettings.emberIntensity,
    );
  }

  saveBannerState({ ...state, settings });
}

export function resetBanners() {
  saveBannerState(seedBannerState());
}

// ── Orders ─────────────────────────────────────────────────────────────────

export function getOrders() {
  if (!cache.orders) cache.orders = read(KEYS.orders, {});
  return cache.orders;
}

function saveOrders(orders) {
  cache.orders = orders;
  write(KEYS.orders, orders);
  emit({ type: 'orders' });
}

export function putOrder(order) {
  saveOrders({ ...getOrders(), [order.reference]: order });
  return order;
}

export function patchOrder(reference, patch) {
  const orders = getOrders();
  const existing = orders[reference];
  if (!existing) return null;

  const updated = { ...existing, ...patch };
  saveOrders({ ...orders, [reference]: updated });
  return updated;
}

export function findOrder(reference) {
  if (!reference) return null;
  return getOrders()[reference.trim().toUpperCase()] ?? null;
}

/** Newest first. */
export function listOrders() {
  return Object.values(getOrders()).sort(
    (a, b) => new Date(b.placedAt) - new Date(a.placedAt),
  );
}

// ── Maintenance ────────────────────────────────────────────────────────────

/**
 * Every image id the app still needs, across all collections.
 *
 * Pruning must use this rather than a single screen's own list — pruning from
 * the menu alone would treat every banner photo as an orphan and delete it.
 */
// ── Promotion ──────────────────────────────────────────────────────────────

/**
 * The first-order coupon shown in the top strip and honoured at checkout.
 *
 * Seeded from `orderSetup.promo` and then owned by the shop. `getPromo` is
 * what `pricing.evaluatePromo` validates against, so changing the code here
 * changes what the basket accepts — there is no second copy to keep in step.
 */
export function getPromo() {
  if (!cache.promo) {
    const stored = read(KEYS.promo, null);
    // Seed underneath, so a promo gaining a field does not read `undefined`.
    cache.promo = stored ? { ...orderSetup.promo, ...stored } : { ...orderSetup.promo };
    if (!stored) write(KEYS.promo, cache.promo);
  }
  return cache.promo;
}

export function savePromo(patch) {
  const promo = { ...getPromo(), ...patch };

  // A coupon has to survive being typed in by a customer: store it upper-case
  // and trimmed once here rather than normalising at every comparison.
  if ('code' in patch) promo.code = String(patch.code ?? '').trim().toUpperCase();

  // Nonsense values here silently break the basket maths, so clamp on write.
  if ('percentage' in patch) {
    promo.percentage = clampNumber(patch.percentage, 0, 100, orderSetup.promo.percentage);
  }
  if ('minimumSpend' in patch) {
    promo.minimumSpend = clampNumber(patch.minimumSpend, 0, 1000, orderSetup.promo.minimumSpend);
  }

  cache.promo = promo;
  write(KEYS.promo, promo);
  emit({ type: 'promo' });
}

export function resetPromo() {
  cache.promo = { ...orderSetup.promo };
  write(KEYS.promo, cache.promo);
  emit({ type: 'promo' });
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

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

/** Drop every local override and go back to the seed data. */
export function resetCatalog() {
  saveCatalog(seedCatalog());
}

export function resetHours() {
  saveHours(seedHours());
}

export function clearOrders() {
  saveOrders({});
}

/** Test hook — wipes the in-memory cache without touching storage. */
export function invalidateCache() {
  cache.catalog = null;
  cache.hours = null;
  cache.orders = null;
  cache.banners = null;
}
