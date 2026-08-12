/**
 * Homepage hero slides.
 *
 * Everything a slide shows is editable from the admin panel; these are only
 * the values a fresh install starts with.
 *
 * `priceNote`/`price` render the big offer figure in the banner; leave both
 * blank and the block is hidden.
 *
 * A slide's `image` is optional — without one the hero falls back to the grid
 * of category tiles, so the page never looks broken before the shop has
 * uploaded any photography.
 */

export const seedBanners = [
  {
    id: 'banner-welcome',
    displayOrder: 1,
    isPublished: true,
    eyebrow: 'Good Food Good Mood',
    heading: 'Made to order.',
    headingAccent: 'Never sat waiting.',
    description:
      'Freshly ground Angus patties, battered chicken and loaded fries — cooked when you order, not before.',
    imageId: null,
    primaryLabel: 'Start your order',
    primaryHref: '#menu',
    secondaryLabel: '',
    secondaryHref: '',
    // Shows the live "open / closed / reopens at" line under the buttons.
    showStoreStatus: true,
  },
  {
    id: 'banner-meal',
    displayOrder: 2,
    isPublished: true,
    eyebrow: 'Make it a meal',
    heading: 'Add fries and a drink.',
    headingAccent: 'Just £2.49.',
    description:
      'Any burger or club sandwich becomes a full meal for £2.49. Pick it as a size when you add the item.',
    imageId: null,
    priceNote: 'Only',
    price: '£2.49',
    primaryLabel: 'See the menu',
    primaryHref: '#menu',
    secondaryLabel: '',
    secondaryHref: '',
    showStoreStatus: false,
  },
  {
    id: 'banner-rascal',
    displayOrder: 3,
    isPublished: true,
    eyebrow: 'Cheesy Rascal',
    heading: 'Loaded fries,',
    headingAccent: 'properly loaded.',
    description:
      'Chicken chunks, pizza sauce, jalapenos, capsicum, mozzarella, mayo and chilli garlic. £6.99.',
    imageId: null,
    priceNote: 'Only',
    price: '£6.99',
    primaryLabel: 'Order one',
    primaryHref: '#category-cheesy-rascal',
    secondaryLabel: '',
    secondaryHref: '',
    showStoreStatus: false,
  },
];

export const seedBannerSettings = {
  isAutoplayOn: true,
  autoplaySeconds: 6,

  // Embers drifting up the whole page. Subtle by default — this one sits
  // behind the menu, so it has to stay out of the way.
  areEmbersOn: true,
  emberIntensity: 0.4,
};

/** Autoplay bounds — fast enough to notice, slow enough to read. */
export const AUTOPLAY_MIN_SECONDS = 3;
export const AUTOPLAY_MAX_SECONDS = 30;

export function clampAutoplaySeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return seedBannerSettings.autoplaySeconds;
  return Math.min(AUTOPLAY_MAX_SECONDS, Math.max(AUTOPLAY_MIN_SECONDS, Math.round(seconds)));
}

/**
 * Effect strength, 0–1.
 *
 * Clamped on the way into storage: an intensity above 1 would wash the hero
 * out until the headline is unreadable, and a negative one renders nothing
 * while the setting still claims to be on.
 */
export function clampIntensity(value, fallback = 0.7) {
  const intensity = Number(value);
  if (!Number.isFinite(intensity)) return fallback;
  return Math.min(1, Math.max(0, Math.round(intensity * 100) / 100));
}

/** A slide needs a heading; everything else is optional. */
export function isBannerRenderable(banner) {
  return Boolean(banner?.heading?.trim() || banner?.headingAccent?.trim());
}
