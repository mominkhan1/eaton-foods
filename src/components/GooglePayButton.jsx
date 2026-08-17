import { useEffect, useRef, useState } from 'react';
import { loadGooglePaySdk, loadPayPalSdk } from '../lib/paypalSdk';

/**
 * Google Pay, settled through PayPal.
 *
 * The sheet and the button belong to Google; the money still moves through the
 * same PayPal order as every other payment here. The shape of it:
 *
 *   1. paypal.Googlepay().config() says what the merchant account accepts.
 *   2. Google's own client draws the button and shows the sheet.
 *   3. The customer authorises, and Google hands back a payment token.
 *   4. Only THEN is the order created — inside onPaymentAuthorized, so a
 *      customer who opens the sheet and changes their mind leaves nothing
 *      behind.
 *   5. confirmOrder() attaches the token to the PayPal order, and the server
 *      captures it.
 *
 * AS WITH THE PAYPAL BUTTON, NOTHING HERE DECIDES WHAT IS PAID. `totalPence`
 * is what Google's sheet displays; the charge is the amount stored against the
 * order on the server, and the capture is refused unless the two agree. A
 * customer who edits it can only make their own payment fail.
 */

/** The sheet wants "12.30"; we hold pence. */
function toDisplayAmount(pence) {
  return (pence / 100).toFixed(2);
}

export default function GooglePayButton({
  clientId,
  currency = 'GBP',
  components,
  /** 'sandbox' | 'live' — Google needs its own word for it. */
  mode = 'sandbox',
  totalPence,
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
  const containerRef = useRef(null);
  const [state, setState] = useState('loading');

  // The SDKs hold whatever function they were given when the button was built,
  // so the live handlers are read through a ref that every render refreshes.
  const handlers = useRef({});
  useEffect(() => {
    handlers.current = { onBeforePay, createOrder, captureOrder, onComplete, onCancel, onError };
  });

  // The displayed total changes as the basket does, and the sheet is built at
  // click time — so this is a ref too, not a closed-over value.
  const amount = useRef(totalPence);
  useEffect(() => {
    amount.current = totalPence;
  }, [totalPence]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadPayPalSdk({ clientId, currency, components }), loadGooglePaySdk()])
      .then(async ([paypal, googlePayApi]) => {
        if (cancelled || !containerRef.current) return;

        const googlepay = paypal.Googlepay();
        const config = await googlepay.config();

        // The merchant account itself is not set up for Google Pay. Nothing
        // the customer can fix, and nothing they need to be told about — the
        // PayPal button below still works.
        if (config.isEligible === false) {
          setState('ineligible');
          return;
        }

        const paymentsClient = new googlePayApi.PaymentsClient({
          environment: mode === 'live' ? 'PRODUCTION' : 'TEST',
          paymentDataCallbacks: {
            /*
             * Everything that matters happens here.
             *
             * Google keeps the sheet open until this resolves, so the customer
             * sees the spinner on it rather than on our page, and a failure can
             * be reported into the sheet instead of behind it.
             */
            onPaymentAuthorized: async (paymentData) => {
              try {
                const orderId = await handlers.current.createOrder();

                const confirmed = await googlepay.confirmOrder({
                  orderId,
                  paymentMethodData: paymentData.paymentMethodData,
                });

                /*
                 * The bank wants the customer to prove who they are — 3-D
                 * Secure. initiatePayerAction opens that challenge and settles
                 * once it is done; skipping it means capturing a payment the
                 * issuer will later reverse.
                 */
                if (confirmed.status === 'PAYER_ACTION_REQUIRED') {
                  await googlepay.initiatePayerAction({ orderId });
                } else if (confirmed.status !== 'APPROVED') {
                  throw new Error(`unexpected-status: ${confirmed.status}`);
                }

                await handlers.current.captureOrder(orderId);

                return { transactionState: 'SUCCESS' };
              } catch (error) {
                return {
                  transactionState: 'ERROR',
                  error: {
                    intent: 'PAYMENT_AUTHORIZATION',
                    // The server writes these for a customer to read; the
                    // fallback covers a network drop, which has no message.
                    message:
                      error?.message ?? 'The payment could not be completed. Nothing was charged.',
                    reason: 'PAYMENT_DATA_INVALID',
                  },
                };
              }
            },
          },
        });

        const ready = await paymentsClient.isReadyToPay({
          apiVersion: 2,
          apiVersionMinor: 0,
          allowedPaymentMethods: config.allowedPaymentMethods,
        });

        // No card in this browser's Google account, or a browser Google Pay
        // does not support.
        if (!ready.result) {
          setState('ineligible');
          return;
        }

        if (cancelled || !containerRef.current) return;

        const button = paymentsClient.createButton({
          buttonColor: 'black',
          buttonType: 'pay',
          buttonSizeMode: 'fill',
          buttonRadius: 24,
          onClick: () => {
            if (handlers.current.onBeforePay?.() === false) return;

            paymentsClient
              .loadPaymentData({
                apiVersion: 2,
                apiVersionMinor: 0,
                allowedPaymentMethods: config.allowedPaymentMethods,
                merchantInfo: config.merchantInfo,
                transactionInfo: {
                  currencyCode: currency,
                  countryCode: config.countryCode ?? 'GB',
                  totalPriceStatus: 'FINAL',
                  totalPrice: toDisplayAmount(amount.current),
                },
                // Without this Google settles the sheet on its own and never
                // calls onPaymentAuthorized, so nothing above would run.
                callbackIntents: ['PAYMENT_AUTHORIZATION'],
              })
              .then(() => handlers.current.onComplete?.())
              .catch((error) => {
                // Closing the sheet is a decision, not a fault.
                if (error?.statusCode === 'CANCELED') {
                  handlers.current.onCancel?.();
                  return;
                }
                handlers.current.onError?.(error);
              });
          },
        });

        containerRef.current.replaceChildren(button);
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
   * Silent when unavailable, deliberately.
   *
   * Google Pay is an extra way to pay, not the only one. A customer on a
   * browser that cannot do it should simply see the PayPal button, not an
   * explanation of a feature they were never offered.
   */
  if (state === 'ineligible' || state === 'failed') return null;

  return <div ref={containerRef} className="[&>button]:w-full" aria-busy={state === 'loading'} />;
}
