/**
 * Delivery-area checks.
 *
 * The reference store uses a radius-only geofence. A circle drawn around the
 * shop spills into districts we don't drive to, so this checks the postcode
 * district as well and reports which of the two tests failed.
 */

import { storeConfig, orderSetup } from '../data/store.js';

const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** UK postcode, loose enough to accept anything Royal Mail would. */
const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;

export function normalisePostcode(raw) {
  const cleaned = String(raw ?? '').toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(POSTCODE_RE);
  if (!match) return null;
  return `${match[1]} ${match[2]}`;
}

/** The outward district, e.g. "AL8 6HA" → "AL8". */
export function postcodeDistrict(raw) {
  const normalised = normalisePostcode(raw);
  if (!normalised) return null;
  return normalised.split(' ')[0];
}

export function isPostcodeServed(raw) {
  const district = postcodeDistrict(raw);
  if (!district) return false;
  return orderSetup.servedPostcodeDistricts.includes(district);
}

/**
 * Full delivery-area check.
 *
 * `coords` is optional — without it only the postcode is checked, which is the
 * case before a geocoder has resolved the address.
 *
 * Returns `{ ok, reason, distanceKm }` where `reason` is one of
 * `invalid-postcode`, `outside-districts`, `outside-radius`.
 */
export function checkDeliveryArea(postcode, coords = null) {
  const normalised = normalisePostcode(postcode);

  if (!normalised) {
    return { ok: false, reason: 'invalid-postcode', distanceKm: null };
  }

  if (!isPostcodeServed(normalised)) {
    return { ok: false, reason: 'outside-districts', distanceKm: null };
  }

  if (!coords) {
    return { ok: true, reason: null, distanceKm: null };
  }

  const distance = distanceKm(storeConfig.location, coords);

  if (orderSetup.useRadiusBasedDeliveryArea && distance > orderSetup.deliveryRadiusKm) {
    return { ok: false, reason: 'outside-radius', distanceKm: distance };
  }

  return { ok: true, reason: null, distanceKm: distance };
}

export const DELIVERY_AREA_MESSAGES = {
  'invalid-postcode': "That doesn't look like a full UK postcode.",
  'outside-districts': "Sorry, we don't deliver to that area yet — collection is still available.",
  'outside-radius': `Sorry, that address is outside our ${orderSetup.deliveryRadiusKm}km delivery zone — collection is still available.`,
};

/**
 * Stand-in geocoder.
 *
 * Real implementation should call a geocoding API (the reference site uses
 * MapLibre/Leaflet with a places lookup). Until then this derives a stable
 * pseudo-location near the shop from the postcode so the radius check has
 * something to work against in development.
 */
export function geocodePostcodeStub(postcode) {
  const normalised = normalisePostcode(postcode);
  if (!normalised) return null;

  let hash = 0;
  for (const char of normalised) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }

  // Spread within roughly ±0.04° (~4.5km) of the shop.
  const offsetLat = ((hash % 800) / 10000) - 0.04;
  const offsetLng = ((Math.floor(hash / 800) % 800) / 10000) - 0.04;

  return {
    lat: storeConfig.location.lat + offsetLat,
    lng: storeConfig.location.lng + offsetLng,
  };
}
