import { useEffect, useRef, useState } from 'react';
import { loadPayPalSdk } from '../lib/paypalSdk';

/**
 * The PayPal pay button.
 *
 * The SDK renders its own buttons into a DOM node it owns, inside iframes it
 * controls. That does not survive React re-rendering it, so the buttons are
 * mounted exactly once and every callback is read through a ref — the SDK
 * always calls the latest one without the widget being torn down and rebuilt
 * under a customer who is mid-payment.
 *
 * NOTHING HERE DECIDES WHAT IS PAID. The amount lives on the server, is
 * attached to the PayPal order there, and is checked against the captured
 * figure before an order is marked paid. This component only opens the window
 * and reports back what happened.
 */

export default function PayPalButton({
  clientId,
  currency = 'GBP',
  /** Every component the page needs, since the SDK loads once. */
  components,
  /** Return false to stop the payment opening — used for form validation. */
  onBeforePay,
  /** Must resolve to a PayPal order id. */
  createOrder,
  /** Called with the PayPal order id once the customer approves. */
  onApprove,
  onCancel,
  onError,
}) {
  const containerRef = useRef(null);
  const [state, setState] = useState('loading');

  // The SDK holds whatever function it was given at mount, so the handlers
  // live in a ref refreshed after every render. Declared before the mount
  // effect below, so it is populated by the time the buttons exist.
  const handlers = useRef({});

  useEffect(() => {
    handlers.current = { onBeforePay, createOrder, onApprove, onCancel, onError };
  });

  useEffect(() => {
    let cancelled = false;
    let instance = null;

    loadPayPalSdk({ clientId, currency, components })
      .then((paypal) => {
        if (cancelled || !containerRef.current) return;

        instance = paypal.Buttons({
          style: { layout: 'vertical', shape: 'pill', label: 'pay', height: 48 },

          onClick: (_data, actions) => {
            const ok = handlers.current.onBeforePay?.();
            return ok === false ? actions.reject() : actions.resolve();
          },

          createOrder: () => handlers.current.createOrder(),
          onApprove: (data) => handlers.current.onApprove(data.orderID),
          onCancel: () => handlers.current.onCancel?.(),
          onError: (error) => handlers.current.onError?.(error),
        });

        if (!instance.isEligible()) {
          setState('ineligible');
          return;
        }

        instance.render(containerRef.current).then(
          () => !cancelled && setState('ready'),
          () => !cancelled && setState('failed'),
        );
      })
      .catch(() => !cancelled && setState('failed'));

    return () => {
      cancelled = true;
      // Closing on unmount stops the SDK writing into a node React has removed.
      try {
        instance?.close();
      } catch {
        // Already gone; nothing to do.
      }
    };
    // Mounted once. The handlers ref carries every later change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div ref={containerRef} />

      {state === 'loading' && (
        <p className="py-3 text-center text-sm text-ink-500">Loading payment options…</p>
      )}

      {(state === 'failed' || state === 'ineligible') && (
        <p className="rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">
          {state === 'ineligible'
            ? 'PayPal is not available for this order. Please call the shop to pay.'
            : 'The payment window could not load. An ad blocker or privacy extension' +
              ' will do this — try disabling it, or call the shop to order.'}
        </p>
      )}
    </div>
  );
}
