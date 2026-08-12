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
  address: '312 Wilmslow Road, Rusholme, Manchester',
  postcode: 'M14 5LJ',
  city: 'Manchester',
  country: 'United Kingdom',
  phoneDisplay: '+44 161 555 0142',
  phone: '+441615550142',
  email: 'orders@eatonfoods.co.uk',
  timeZone: 'Europe/London',
  currency: '£',
  currencyCode: 'GBP',
  // Geofence centre — the shop itself.
  location: { lat: 53.4506, lng: -2.2245 },
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

  // Delivery geofence. Radius-based, like the reference store.
  useRadiusBasedDeliveryArea: true,
  deliveryRadiusKm: 5,
  // Manchester postal districts we actually drive to. A radius circle alone
  // will spill into districts we don't serve, so the postcode is checked too.
  servedPostcodeDistricts: [
    'M1', 'M2', 'M3', 'M4', 'M8', 'M11', 'M12', 'M13', 'M14',
    'M15', 'M16', 'M18', 'M19', 'M20', 'M21', 'M32',
  ],

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
