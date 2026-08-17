import { useEffect, useRef, useState } from 'react';
import { deviceSupportsApplePay, loadApplePaySdk, loadPayPalSdk } from '../lib/paypalSdk';

/**
 * Apple Pay, settled through PayPal.
 *
 * Like Google Pay, this is the same PayPal order and the same server-side
 * capture; only the sheet in front of it differs. Apple's is driven by an
 * ApplePaySession the page owns and drives through callbacks:
 *
 *   1. The device must be able to pay at all — Safari, with a card in Wallet.
 *      Checked before anything is loaded, because on every other browser this
 *      component has nothing to do.
 *   2. paypal.Applepay().config() says whether the merchant account is set up
 *      and what it accepts.
 *   3. onvalidatemerchant proves to Apple that this domain belongs to the
 *      merchant. THIS IS THE STEP THAT FAILS IF THE DOMAIN IS NOT REGISTERED
 *      with PayPal and serving its association file — see DEPLOYMENT.md §8.6.
 *   4. onpaymentauthorized gets the payment token, and only then is the order
 *      created and confirmed.
 *
 * AS EVERYWHERE ELSE, THE AMOUNT IS THE SERVER'S. `totalPence` is what Apple's
 * sheet shows; the capture is checked against the stored order and refused if
 * they disagree.
 */

function toDisplayAmount(pence) {
  return (pence / 100).toFixed(2);
}

export default function ApplePayButton({
  clientId,
  currency = 'GBP',
  components,
  totalPence,
  /** Shown on the sheet as who is being paid. */
  merchantName = 'Eat On',
  /** Return false to stop the sheet opening — used for form validation. */
  onBeforePay,
  /** Must resolve to a PayPal order id. */
  createOrder,
  /** Takes the money. Throws if it did not go through. */
  captureOrder,
  /** Paid and confirmed — safe to leave the checkout. */
  onComplete,
  onCancel,
  onError,
}) {
  const buttonRef = useRef(null);

  /*
   * Whether the device can do Apple Pay at all is knowable before the first
   * render and never changes, so it is the initial state rather than something
   * an effect corrects afterwards — no flash of a button that then vanishes,
   * and nothing for the render to chase.
   */
  const [state, setState] = useState(() =>
    deviceSupportsApplePay() ? 'loading' : 'ineligible',
  );

  // Set once the SDK is up, and read by the click handler below.
  const applepay = useRef(null);
  const config = useRef(null);

  const handlers = useRef({});
  useEffect(() => {
    handlers.current = { onBeforePay, createOrder, captureOrder, onComplete, onCancel, onError };
  });

  const amount = useRef(totalPence);
  useEffect(() => {
    amount.current = totalPence;
  }, [totalPence]);

  useEffect(() => {
    // Not Safari, or no card in Wallet — decided above, before the first
    // render. Nothing here is worth fetching.
    if (state === 'ineligible') return undefined;

    let cancelled = false;

    Promise.all([loadPayPalSdk({ clientId, currency, components }), loadApplePaySdk()])
      .then(async ([paypal]) => {
        if (cancelled) return;

        const instance = paypal.Applepay();
        const settings = await instance.config();

        if (cancelled) return;

        if (!settings.isEligible) {
          setState('ineligible');
          return;
        }

        applepay.current = instance;
        config.current = settings;
        setState('ready');
      })
      .catch(() => !cancelled && setState('failed'));

    return () => {
      cancelled = true;
    };
    // Mounted once. The refs above carry every later change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * The listener goes on with addEventListener rather than a JSX onClick.
   *
   * <apple-pay-button> is a custom element from Apple's script, not a React
   * one, and the session must be created inside a real user-gesture handler —
   * Safari refuses `new ApplePaySession()` outside one, which is exactly the
   * kind of failure that only shows up on a real device.
   */
  useEffect(() => {
    if (state !== 'ready') return undefined;

    const button = buttonRef.current;
    if (!button) return undefined;

    function onClick() {
      if (handlers.current.onBeforePay?.() === false) return;

      const settings = config.current;
      const instance = applepay.current;

      const session = new window.ApplePaySession(4, {
        countryCode: settings.countryCode,
        currencyCode: currency,
        merchantCapabilities: settings.merchantCapabilities,
        supportedNetworks: settings.supportedNetworks,
        // No shipping fields: this is a takeaway, and the address was
        // collected and geofenced long before the checkout. The billing
        // address is asked for because card issuers use it to authorise.
        requiredBillingContactFields: ['postalAddress'],
        total: {
          label: merchantName,
          type: 'final',
          amount: toDisplayAmount(amount.current),
        },
      });

      session.onvalidatemerchant = (event) => {
        instance
          .validateMerchant({ validationUrl: event.validationURL, displayName: merchantName })
          .then((result) => session.completeMerchantValidation(result.merchantSession))
          .catch((error) => {
            session.abort();
            handlers.current.onError?.(error);
          });
      };

      session.onpaymentauthorized = async (event) => {
        try {
          const orderId = await handlers.current.createOrder();

          await instance.confirmOrder({
            orderId,
            token: event.payment.token,
            billingContact: event.payment.billingContact,
          });

          await handlers.current.captureOrder(orderId);

          // Dismiss the sheet before leaving the page, or Safari is left
          // holding a session over a checkout that no longer exists.
          session.completePayment(window.ApplePaySession.STATUS_SUCCESS);
          handlers.current.onComplete?.();
        } catch (error) {
          session.completePayment(window.ApplePaySession.STATUS_FAILURE);
          handlers.current.onError?.(error);
        }
      };

      // Fires when the customer dismisses the sheet, and also after an abort
      // above — harmless either way, since it only clears the pending state.
      session.oncancel = () => handlers.current.onCancel?.();

      session.begin();
    }

    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
  }, [state, currency, merchantName]);

  // Silent unless it can actually be used — see the note in GooglePayButton.
  if (state !== 'ready') return null;

  return (
    <apple-pay-button
      ref={buttonRef}
      buttonstyle="black"
      type="buy"
      locale="en-GB"
      style={{
        '--apple-pay-button-width': '100%',
        '--apple-pay-button-height': '48px',
        '--apple-pay-button-border-radius': '24px',
        display: 'block',
        cursor: 'pointer',
      }}
    />
  );
}
