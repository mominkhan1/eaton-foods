/**
 * Script loading for the payment SDKs.
 *
 * Three buttons — PayPal, Google Pay, Apple Pay — sit on the checkout together
 * and all three need something fetched from a third party before they can
 * render. This is the one place that does that fetching, for two reasons:
 *
 *   - THE PAYPAL SDK CAN ONLY BE LOADED ONCE PER PAGE, and the components it
 *     exposes are fixed by the query string of that single load. Three
 *     components each appending their own script tag gets you three copies of
 *     the SDK racing to define window.paypal, and whichever lands last wins.
 *   - A failed load must not be cached as a permanent failure, or a customer
 *     whose connection blipped can never pay without reloading the page.
 *
 * Promises are cached at module scope rather than in component state so that a
 * remount — or React's development double-render — reuses the load in flight
 * instead of starting another.
 */

/** One <script> per src, however many callers ask for it. */
const scripts = new Map();

function loadScript(src, { attributes = {} } = {}) {
  const cached = scripts.get(src);
  if (cached) return cached;

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;

    for (const [name, value] of Object.entries(attributes)) {
      script.setAttribute(name, value);
    }

    script.onload = () => resolve();
    script.onerror = () => {
      // Drop the cache entry so a later attempt can retry. An ad blocker, a
      // privacy extension or a corporate proxy all land here.
      scripts.delete(src);
      script.remove();
      reject(new Error(`script-blocked: ${src}`));
    };

    document.head.appendChild(script);
  });

  scripts.set(src, promise);
  return promise;
}

// ── PayPal ─────────────────────────────────────────────────────────────────

const PAYPAL_SDK = 'https://www.paypal.com/sdk/js';

let paypalPromise = null;
let paypalKey = null;

/**
 * Load the PayPal SDK with the given components, and resolve to `window.paypal`.
 *
 * `components` is the full list every button on the page needs, decided once by
 * the checkout. A second call asking for something different cannot be honoured
 * — the script is already in the document — so it resolves the original load and
 * says so, which is a great deal easier to diagnose than a component silently
 * missing off `window.paypal`.
 */
export function loadPayPalSdk({ clientId, currency = 'GBP', components = ['buttons'] }) {
  const params = new URLSearchParams({
    'client-id': clientId,
    currency,
    intent: 'capture',
    components: components.join(','),
    // Card is what a customer without a PayPal account uses; the other two are
    // credit products that do not belong on a £20 takeaway.
    'disable-funding': 'paylater,credit',
  });

  const key = params.toString();

  if (paypalPromise) {
    if (paypalKey !== key) {
      console.warn(
        'PayPal SDK already loaded with different parameters; reusing the first load.',
        { loaded: paypalKey, requested: key },
      );
    }
    return paypalPromise;
  }

  paypalKey = key;
  paypalPromise = (window.paypal ? Promise.resolve() : loadScript(`${PAYPAL_SDK}?${key}`))
    .then(() => {
      if (!window.paypal) throw new Error('sdk-empty');
      return window.paypal;
    })
    .catch((error) => {
      // Let a later attempt retry rather than caching the failure forever.
      paypalPromise = null;
      paypalKey = null;
      throw error;
    });

  return paypalPromise;
}

/**
 * The components the SDK must expose, given what the shop has switched on.
 *
 * Asked for as one list before anything renders, because of the single-load
 * rule above.
 */
export function paypalComponents({ googlePay = false, applePay = false } = {}) {
  const components = ['buttons'];
  if (googlePay) components.push('googlepay');
  if (applePay) components.push('applepay');
  return components;
}

// ── The wallets' own SDKs ──────────────────────────────────────────────────

/**
 * Google's payments client, which draws the button and shows the sheet.
 *
 * PayPal's SDK supplies the merchant configuration and takes the resulting
 * payment token, but the sheet itself is Google's and comes from Google's
 * script.
 */
export function loadGooglePaySdk() {
  return loadScript('https://pay.google.com/gp/p/js/pay.js').then(() => {
    if (!window.google?.payments?.api) throw new Error('googlepay-sdk-empty');
    return window.google.payments.api;
  });
}

/**
 * Apple's SDK, which defines the <apple-pay-button> element.
 *
 * `ApplePaySession` itself is built into Safari and is not loaded from
 * anywhere; this script only provides the button element, so the eligibility
 * check belongs to the caller and must happen before this is worth loading.
 */
export function loadApplePaySdk() {
  return loadScript('https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js', {
    crossorigin: 'anonymous',
  });
}

/**
 * Can this browser show an Apple Pay sheet at all?
 *
 * Chrome on a Mac has no ApplePaySession; Safari on a Mac with no card in
 * Wallet has the object but `canMakePayments()` is false. Neither should see a
 * button, and neither is an error worth reporting.
 */
export function deviceSupportsApplePay() {
  try {
    return Boolean(window.ApplePaySession?.canMakePayments?.());
  } catch {
    return false;
  }
}
