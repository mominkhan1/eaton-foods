import { useState } from 'react';
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
import { DrumstickIcon, CardIcon, PhoneIcon } from '../components/Icons';

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
  const [payment, setPayment] = useState('card');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const [addressOpen, setAddressOpen] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);

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

  async function onSubmit(event) {
    event.preventDefault();
    if (!validate() || !canCheckout || submitting) return;

    setSubmitting(true);
    setErrors({});

    const customer = { name: name.trim(), phone: phone.trim(), email: email.trim() };
    try {
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    } catch {
      // Not worth blocking the order over.
    }

    let order;
    try {
      order = await placeOrder({
        lines,
        orderType,
        timing,
        address: deliveryAddress,
        customer,
        promoCode,
      });
    } catch (error) {
      setSubmitting(false);

      // The server re-checks everything the browser checked, so a refusal here
      // usually means the shop changed something while the basket sat open —
      // an item came off the menu, or a price moved. The basket is deliberately
      // left intact so the customer can fix it rather than start again.
      setErrors({
        submit:
          error?.code === 'outside_delivery_area'
            ? error.message
            : (error?.message ?? 'We could not place that order. Please try again.'),
      });
      return;
    }

    rememberOrder(order);
    clear();
    navigate(`/order/${order.reference}`, { replace: true });
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

      <form onSubmit={onSubmit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
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
              {orderSetup.isCashPaymentAccepted
                ? 'Card or cash.'
                : 'Card payment only — we no longer take cash.'}
            </p>

            <div className="mt-4 grid gap-2">
              <PaymentOption
                id="card"
                checked={payment === 'card'}
                onChange={setPayment}
                label="Credit or debit card"
                hint="Visa, Mastercard, Amex"
                icon={<CardIcon className="h-6 w-6 shrink-0 text-brand-600" />}
              />
              <PaymentOption
                id="gpay"
                checked={payment === 'gpay'}
                onChange={setPayment}
                label="Google Pay"
                hint="Pay with your saved card"
                icon={<PhoneIcon className="h-6 w-6 shrink-0 text-brand-600" />}
              />
            </div>

            <p className="mt-4 rounded-xl bg-surface-0 px-4 py-3 text-xs text-ink-500">
              Card capture is not wired up yet — the order reaches the kitchen and you can track
              it, but payment is settled in person for now.
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

          <button
            type="submit"
            disabled={!canCheckout || submitting}
            className="btn-primary mt-4 w-full justify-between"
          >
            <span>{submitting ? 'Placing order…' : 'Place order'}</span>
            <span className="tabular-nums">{formatPence(totals.total)}</span>
          </button>
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

function PaymentOption({ id, checked, onChange, label, hint, icon }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${
        checked ? 'border-brand-500 bg-brand-500/8' : 'border-surface-300'
      }`}
    >
      <input
        type="radio"
        name="payment"
        checked={checked}
        onChange={() => onChange(id)}
        className="h-4 w-4 accent-brand-500"
      />
      {icon}
      <span className="flex-1">
        <span className="block text-sm text-ink-800">{label}</span>
        <span className="block text-xs text-ink-500">{hint}</span>
      </span>
    </label>
  );
}
