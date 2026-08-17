import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useOrder } from '../context/OrderContext';
import OrderSummary from '../components/OrderSummary';
import PromoField from '../components/PromoField';
import AddressModal from '../components/AddressModal';
import TimingModal from '../components/TimingModal';
import { ORDER_TYPE, orderSetup, storeConfig } from '../data/store';
import { formatPence } from '../lib/money';
import { lineUnitPence } from '../lib/pricing';
import { formatDateTime, formatTime } from '../lib/hours';
import { placeOrder, rememberOrder } from '../lib/orders';
import { api } from '../lib/api';
import PayPalButton from '../components/PayPalButton';
import GooglePayButton from '../components/GooglePayButton';
import ApplePayButton from '../components/ApplePayButton';
import { paypalComponents } from '../lib/paypalSdk';
import { DrumstickIcon, CardIcon } from '../components/Icons';

const CUSTOMER_KEY = 'eaton.customer.v1';

function loadCustomer() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMER_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export default function Checkout() {
  const navigate = useNavigate();
  const { lines, totals, promoCode, clear, canCheckout, blockedLines, isEmpty } = useCart();
  const { orderType, deliveryAddress, timing, quote, storeOpen, opensAt } = useOrder();

  const saved = loadCustomer();
  const [name, setName] = useState(saved.name ?? '');
  const [phone, setPhone] = useState(saved.phone ?? '');
  const [email, setEmail] = useState(saved.email ?? '');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const [addressOpen, setAddressOpen] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);

  // The PayPal client id, and whether payment is configured at all.
  const [paypal, setPaypal] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .getConfig({ signal: controller.signal })
      .then((config) => setPaypal(config.paypal ?? { configured: false }))
      .catch(() => setPaypal({ configured: false }));
    return () => controller.abort();
  }, []);

  /*
   * Which SDK components every button on this page will need.
   *
   * Decided here rather than inside each button because the PayPal SDK loads
   * exactly once and its component list is fixed by that one load — see
   * src/lib/paypalSdk.js. Asking for a wallet the shop has not switched on just
   * makes the script bigger, so it is driven off the server's config.
   */
  const sdkComponents = useMemo(
    () => paypalComponents({ googlePay: paypal?.googlePay, applePay: paypal?.applePay }),
    [paypal?.googlePay, paypal?.applePay],
  );

  /*
   * What to name in the payment blurb.
   *
   * This is what the SHOP has switched on, not what this device can do — the
   * buttons themselves ask the device and stay hidden if the answer is no,
   * which is why the copy says "if your device offers it" rather than
   * promising anything.
   */
  const walletsOffered =
    [paypal?.applePay && 'Apple Pay', paypal?.googlePay && 'Google Pay']
      .filter(Boolean)
      .join(' or ') || null;

  /*
   * The order this payment is for.
   *
   * Created on the first payment attempt and reused on a retry, so a customer
   * who cancels the PayPal window and tries again does not leave a trail of
   * abandoned orders. Keyed by a signature of everything that affects the
   * price: if the basket changed underneath, the stored order is wrong and a
   * fresh one is placed.
   */
  const placed = useRef(null);

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-20 text-center">
        <DrumstickIcon className="mx-auto h-14 w-14 text-brand-500/40" />
        <h1 className="mt-4 text-3xl text-ink-950">Nothing to check out</h1>
        <p className="mt-2 text-ink-500">Your basket is empty.</p>
        <Link to="/menu" className="btn-primary mt-6">
          Browse the menu
        </Link>
      </div>
    );
  }

  function validate() {
    const next = {};

    if (!name.trim()) next.name = 'We need a name for the order.';
    // UK mobile/landline, spaces and +44 tolerated.
    if (!/^(\+?44|0)\s?\d[\d\s]{8,12}$/.test(phone.trim())) {
      next.phone = 'Enter a valid UK phone number.';
    }
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      next.email = 'That email address looks wrong.';
    }
    if (orderType === ORDER_TYPE.DELIVERY && !deliveryAddress) {
      next.address = 'Add a delivery address to continue.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function rememberCustomer(customer) {
    try {
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    } catch {
      // Private browsing. Not worth blocking the order over.
    }
  }

  /** Everything that affects what this order costs. */
  function orderPayload() {
    return {
      lines,
      orderType,
      timing,
      address: deliveryAddress,
      customer: { name: name.trim(), phone: phone.trim(), email: email.trim() },
      promoCode,
    };
  }

  /**
   * The order must exist server-side before PayPal can be told what to charge
   * — the amount comes from the stored order, not from this page.
   */
  async function ensureOrder() {
    const payload = orderPayload();
    const signature = JSON.stringify(payload);

    if (placed.current?.signature === signature) {
      return placed.current.reference;
    }

    rememberCustomer(payload.customer);

    const order = await placeOrder(payload);
    placed.current = { signature, reference: order.reference };
    return order.reference;
  }

  /** PayPal is opening: last chance to stop it. */
  function onBeforePay() {
    if (!validate() || !canCheckout) {
      // The invalid field is up the page, above the fold on desktop but not
      // on a phone.
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return false;
    }
    setErrors({});
    return true;
  }

  async function onCreatePaypalOrder(source = 'paypal') {
    setSubmitting(true);
    try {
      const reference = await ensureOrder();
      const { paypalOrderId } = await api.createPaypalOrder(reference, source);
      return paypalOrderId;
    } catch (error) {
      setSubmitting(false);
      /*
       * The server re-prices and re-checks everything the browser checked, so
       * a refusal here usually means the shop changed something while the
       * basket sat open — an item came off the menu, or a price moved. The
       * basket is deliberately left intact so the customer can fix it rather
       * than start again.
       */
      setErrors({
        submit: error?.message ?? 'We could not start the payment. Please try again.',
      });
      throw error;
    }
  }

  /**
   * Take the money.
   *
   * Split from the navigation below because the wallets need the two halves
   * apart: Google Pay and Apple Pay both hold their sheet open until the
   * capture has resolved, and report the outcome INTO the sheet. Leaving the
   * page from in here would tear the checkout down underneath an open sheet.
   *
   * Throws on failure, having already set the message, so a wallet can fail
   * its own sheet and the PayPal button can simply stop.
   */
  async function capturePayment(paypalOrderId) {
    const reference = placed.current?.reference;
    if (!reference) throw new Error('no-order');

    try {
      await api.capturePaypalOrder(reference, paypalOrderId);
    } catch (error) {
      setSubmitting(false);
      setErrors({
        submit:
          error?.message ??
          'We could not confirm that payment. Do not pay again — call the shop and quote ' +
            reference +
            '.',
      });
      throw error;
    }
  }

  /** Paid. Clear the basket and go, once any wallet sheet has closed. */
  function completePayment() {
    const reference = placed.current?.reference;
    if (!reference) return;

    rememberOrder({ reference, placedAt: new Date().toISOString(), totals });
    clear();
    // `replace`, so Back does not land on a checkout for a basket that has
    // already been paid for and cleared.
    navigate(`/thank-you/${reference}`, { replace: true });
  }

  async function onPaymentApproved(paypalOrderId) {
    try {
      await capturePayment(paypalOrderId);
    } catch {
      // capturePayment has already put the reason on screen.
      return;
    }
    completePayment();
  }

  /** What a wallet reports when its own sheet could not finish. */
  function onWalletError(error) {
    setSubmitting(false);
    // A capture failure has already written the specific reason; only fill in
    // a message when something earlier went wrong and left none.
    setErrors((current) =>
      current.submit
        ? current
        : {
            submit:
              error?.message ?? 'The payment could not be completed. Nothing has been charged.',
          },
    );
  }

  const whenLabel =
    timing.mode === 'scheduled' && timing.slot
      ? formatDateTime(new Date(timing.slot))
      : storeOpen
        ? `As soon as possible · ~${quote.minutes} mins`
        : `Order ahead — we reopen at ${opensAt ? formatTime(opensAt) : 'soon'}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-4xl text-ink-950">Checkout</h1>

      {/* Payment is what places the order, so there is no submit button.
          Enter in a field validates rather than doing nothing silently. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          validate();
        }}
        className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start"
      >
        <div className="grid gap-4">
          <section className="card p-5">
            <h2 className="text-xl text-ink-950">Your details</h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Name" error={errors.name}>
                <input
                  className="field"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </Field>

              <Field label="Phone" error={errors.phone}>
                <input
                  className="field"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="07700 900123"
                  autoComplete="tel"
                  inputMode="tel"
                />
              </Field>

              <div className="sm:col-span-2">
                <Field label="Email (for your receipt)" error={errors.email} optional>
                  <input
                    className="field"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    inputMode="email"
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl text-ink-950">
                  {orderType === ORDER_TYPE.DELIVERY ? 'Delivering to' : 'Collection from'}
                </h2>
                <p className="mt-1 text-sm text-ink-500">
                  {orderType === ORDER_TYPE.DELIVERY ? (
                    deliveryAddress ? (
                      <>
                        {deliveryAddress.line1}, {deliveryAddress.postcode}
                        {deliveryAddress.notes && (
                          <span className="block italic">“{deliveryAddress.notes}”</span>
                        )}
                      </>
                    ) : (
                      'No address yet'
                    )
                  ) : (
                    <>
                      {storeConfig.address}, {storeConfig.postcode}
                    </>
                  )}
                </p>
              </div>

              {orderType === ORDER_TYPE.DELIVERY && (
                <button
                  type="button"
                  onClick={() => setAddressOpen(true)}
                  className="shrink-0 text-sm text-brand-600 underline"
                >
                  Change
                </button>
              )}
            </div>

            {errors.address && (
              <p className="mt-3 text-sm text-chilli-500">{errors.address}</p>
            )}

            <div className="mt-4 flex items-start justify-between gap-4 border-t border-surface-200 pt-4">
              <div>
                <h2 className="text-xl text-ink-950">When</h2>
                <p className="mt-1 text-sm text-ink-500">{whenLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => setTimingOpen(true)}
                className="shrink-0 text-sm text-brand-600 underline"
              >
                Change
              </button>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-xl text-ink-950">Payment</h2>
            <p className="mt-1 text-sm text-ink-500">
              {walletsOffered ? (
                <>
                  Pay with <strong className="text-ink-800">{walletsOffered}</strong> if your
                  device offers it, or through PayPal. You do not need a PayPal account —
                  choose <strong className="text-ink-800">Debit or Credit Card</strong> in the
                  window that opens.
                </>
              ) : (
                <>
                  Paid securely through PayPal. You do not need a PayPal account —
                  choose <strong className="text-ink-800">Debit or Credit Card</strong> in the
                  window that opens.
                </>
              )}
            </p>

            <div className="mt-4 flex items-start gap-3 rounded-xl border border-surface-300 px-4 py-3">
              <CardIcon className="h-6 w-6 shrink-0 text-brand-600" />
              <p className="text-sm text-ink-500">
                Your card details are entered on PayPal's own page and never reach this site.
                We are told only that the payment succeeded.
              </p>
            </div>

            <p className="mt-4 rounded-xl bg-surface-0 px-4 py-3 text-xs text-ink-500">
              Nothing is charged until you approve it, and the kitchen only starts cooking
              once the payment clears.
            </p>
          </section>
        </div>

        <aside className="card p-5 lg:sticky lg:top-24">
          <h2 className="text-xl text-ink-950">Your order</h2>

          <ul className="mt-4 grid gap-3 border-b border-surface-200 pb-4">
            {lines.map((line) => (
              <li key={line.lineId} className="flex items-start gap-3 text-sm">
                <span className="text-ink-500 tabular-nums">{line.quantity}×</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ink-800">{line.name}</span>
                  {line.modifiers.length > 0 && (
                    <span className="block text-xs text-ink-500">
                      {line.modifiers.map((modifier) => modifier.optionName).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-ink-800">
                  {formatPence(lineUnitPence(line) * line.quantity)}
                </span>
              </li>
            ))}
          </ul>

          <div className="py-4">
            <PromoField />
          </div>

          <OrderSummary />

          {blockedLines.length > 0 && (
            <p className="mt-3 rounded-xl bg-chilli-500/10 px-4 py-3 text-xs text-chilli-500">
              Remove the collection-only items from your basket before checking out.
            </p>
          )}

          {!totals.meetsMinimum && (
            <p className="mt-3 rounded-xl bg-chilli-500/10 px-4 py-3 text-xs text-chilli-500">
              Delivery minimum is £{orderSetup.minimumDeliveryOrder.toFixed(2)} — add{' '}
              {formatPence(totals.minimumShortfall)} more.
            </p>
          )}

          {errors.submit && (
            <p className="mt-3 rounded-xl bg-chilli-500/10 px-4 py-3 text-xs text-chilli-500">
              {errors.submit}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-surface-200 pt-4">
            <span className="font-display text-xl tracking-wide text-ink-950">To pay</span>
            <span className="font-display text-xl tabular-nums text-brand-600">
              {formatPence(totals.total)}
            </span>
          </div>

          <div className="mt-3">
            {paypal === null ? (
              <p className="py-3 text-center text-sm text-ink-500">Loading payment options…</p>
            ) : paypal.configured ? (
              /* Remounted if the total changes, so no button can be holding a
                 PayPal order for a basket that has since been edited in the
                 drawer. */
              <div key={totals.total} className="space-y-2">
                {/* The wallets come first: a customer who has one is one tap
                    from done, and each renders nothing at all unless this
                    device can actually pay with it. */}
                {paypal.applePay && (
                  <ApplePayButton
                    clientId={paypal.clientId}
                    currency={paypal.currency}
                    components={sdkComponents}
                    totalPence={totals.total}
                    merchantName={storeConfig.name}
                    onBeforePay={onBeforePay}
                    createOrder={() => onCreatePaypalOrder('applepay')}
                    captureOrder={capturePayment}
                    onComplete={completePayment}
                    onCancel={() => setSubmitting(false)}
                    onError={onWalletError}
                  />
                )}

                {paypal.googlePay && (
                  <GooglePayButton
                    clientId={paypal.clientId}
                    currency={paypal.currency}
                    components={sdkComponents}
                    mode={paypal.mode}
                    totalPence={totals.total}
                    onBeforePay={onBeforePay}
                    createOrder={() => onCreatePaypalOrder('googlepay')}
                    captureOrder={capturePayment}
                    onComplete={completePayment}
                    onCancel={() => setSubmitting(false)}
                    onError={onWalletError}
                  />
                )}

                <PayPalButton
                  clientId={paypal.clientId}
                  currency={paypal.currency}
                  components={sdkComponents}
                  onBeforePay={onBeforePay}
                  createOrder={() => onCreatePaypalOrder('paypal')}
                  onApprove={onPaymentApproved}
                  onCancel={() => setSubmitting(false)}
                  onError={() => {
                    setSubmitting(false);
                    setErrors({
                      submit: 'The payment could not be completed. Nothing has been charged.',
                    });
                  }}
                />
              </div>
            ) : (
              <p className="rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">
                Online payment is not set up yet, so orders cannot be placed here. Please call
                the shop on{' '}
                <a href={`tel:${storeConfig.phone}`} className="underline">
                  {storeConfig.phoneDisplay}
                </a>
                .
              </p>
            )}
          </div>

          {submitting && (
            <p className="mt-3 text-center text-xs text-ink-500" role="status">
              Taking payment — do not close this page.
            </p>
          )}

          {!canCheckout && (
            <p className="mt-3 text-center text-xs text-ink-500">
              Fix the items above before paying.
            </p>
          )}
        </aside>
      </form>

      <AddressModal open={addressOpen} onClose={() => setAddressOpen(false)} />
      <TimingModal open={timingOpen} onClose={() => setTimingOpen(false)} />
    </div>
  );
}

function Field({ label, error, optional, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-ink-500">
        {label}
        {optional && <span className="text-ink-500/70"> — optional</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-chilli-500">{error}</span>}
    </label>
  );
}
