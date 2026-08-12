/**
 * Store configuration.
 *
 * Mirrors the shape of the reference platform's `storeConfig` + `OrderSetup`
 * payloads, so this file is the single place to swap in real values once the
 * backend exists.
 */

export const ORDER_TYPE = {
  PICKUP: 'pickup',
  DELIVERY: 'delivery',
};

export const storeConfig = {
  name: 'Eat On',
  legalName: 'The Food Table Ltd',
  tagline: 'Good Food Good Mood',
  isHalal: true,
  address: 'The Howard Centre, Howardsgate, Welwyn Garden City',
  postcode: 'AL8 6HA',
  city: 'Welwyn Garden City',
  country: 'United Kingdom',
  // PLACEHOLDER — replace with the shop's real number before launch.
  phoneDisplay: '01707 555142',
  phone: '+441707555142',
  email: 'orders@eaton.food',
  timeZone: 'Europe/London',
  currency: '£',
  currencyCode: 'GBP',
  // Geofence centre — the shop itself. Approximate to the Howard Centre;
  // worth confirming against a map pin before relying on the radius check.
  location: { lat: 51.8014, lng: -0.2045 },
};

export const orderSetup = {
  isDeliveryOn: true,
  isPickupOn: true,
  isDineInOn: false,
  defaultOrderType: ORDER_TYPE.PICKUP,

  // Prep times in minutes, used for the "ASAP" quote.
  deliveryTime: 35,
  pickupTime: 10,

  // Scheduled ("pre") orders.
  isPreOrderingEnabled: true,
  scheduleSlotMinutes: 15,
  scheduleMaxDaysAhead: 2,

  /*
   * Delivery area is decided by postcode district alone.
   *
   * A radius was tried and abandoned: Hatfield (AL9/AL10) is served in full,
   * and those districts reach well past any circle centred on the shop, so a
   * radius test would refuse addresses the drivers happily go to. Districts
   * are also how the shop actually thinks about its area.
   *
   * `deliveryRadiusKm` is kept only as a fallback for the stub geocoder and
   * is not enforced while the flag below is false.
   */
  useRadiusBasedDeliveryArea: false,
  deliveryRadiusKm: 5,

  // Shown to customers wherever the delivery area is described. Plain words,
  // because "within 5km" means nothing to someone deciding whether to order.
  deliveryAreaLabel: 'Welwyn Garden City, Welwyn and Hatfield',
  // Districts we actually drive to. A radius circle alone will spill into
  // places we don't serve, so the postcode is checked too.
  //
  // These are the districts within roughly 5km of the Howard Centre:
  // Welwyn Garden City itself (AL7/AL8), Welwyn and Digswell (AL6), and
  // Hatfield (AL9/AL10). Widen or trim this to match what the drivers will
  // actually do — it is a business decision, not a geographic one.
  servedPostcodeDistricts: ['AL6', 'AL7', 'AL8', 'AL9', 'AL10'],

  // Delivery pricing.
  deliveryFee: 2.49,
  isDeliveryFreeOver: true,
  freeDeliveryThreshold: 25,
  minimumDeliveryOrder: 12,

  // Payment.
  isCardPaymentAccepted: true,
  isCashPaymentAccepted: false,
  isCashPaymentAcceptedDelivery: false,

  // Surcharges applied at checkout.
  isPlatformSurchargeLevied: true,
  platformSurchargeAmt: 0.25,
  platformSurchargePercentage: 2,

  // First-order promotion shown in the top banner.
  promo: {
    isOn: true,
    code: 'EATON10',
    title: '10% OFF your FIRST order',
    message: 'Get 10% off your first order over £20',
    buttonText: 'Order now',
    percentage: 10,
    minimumSpend: 20,
  },
};

/**
 * Trading hours.
 *
 * `day` is ISO-8601: 1 = Monday … 7 = Sunday.
 * `start`/`end` are seconds from midnight on that day.
 *
 * Late-night trading is expressed as two rows per day (a midday-to-midnight
 * shift plus an after-midnight shift), which is how the reference store does
 * it and which avoids any wrap-around arithmetic.
 */
const HOURS = 3600;

function shift(day, startHour, endHour, opts = {}) {
  return {
    day,
    start: Math.round(startHour * HOURS),
    end: Math.round(endHour * HOURS),
    noDelivery: opts.noDelivery ?? false,
    noPickup: opts.noPickup ?? false,
  };
}

export const seedShifts = [1, 2, 3, 4, 5, 6, 7].flatMap((day) => [
  // 12:00 → 23:59
  shift(day, 12, 23 + 59 / 60),
  // 00:00 → 02:00 (the tail of the previous night). Kitchen still cooks but
  // we stop driving at 1am on weeknights.
  shift(day, 0, day >= 5 ? 2 : 1),
]);

/** Dates the shop is shut regardless of the normal schedule. */
export const seedClosedDates = [
  { date: '2026-12-25', reason: 'Christmas Day' },
  { date: '2026-12-26', reason: 'Boxing Day' },
];

export const storeClosedMessage =
  'We are currently closed. You can still place an order now for later.';
