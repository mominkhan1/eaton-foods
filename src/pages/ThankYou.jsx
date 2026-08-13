import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getOrder, statusStepsFor } from '../lib/orders';
import { ORDER_TYPE, storeConfig } from '../data/store';
import { formatPence } from '../lib/money';
import { formatDateTime } from '../lib/hours';
import {
  CheckSealIcon,
  ScooterIcon,
  StorefrontIcon,
  ClockIcon,
  ReceiptIcon,
  BellIcon,
  DrumstickIcon,
} from '../components/Icons';

/**
 * The moment after paying.
 *
 * Deliberately its own route rather than a state on the tracking screen.
 * `/order/:reference` is the durable link — it is what the confirmation email
 * points at and what "track order" resolves to, and someone opening it three
 * days later wants the status, not a celebration. This page is the arrival:
 * reached once, from checkout, and it hands over to tracking.
 *
 * The docket is the idea. A takeaway order has always been a paper ticket
 * torn off and clipped above the pass, so the reference the customer will read
 * down the phone sits on a stub with a perforated edge, rather than in another
 * rounded rectangle like everything else on the site.
 */
export default function ThankYou() {
  const { reference } = useParams();

  // Tagged with the reference so a second order never shows the first one's
  // stub while the new one loads.
  const [result, setResult] = useState({ reference: null, order: null });
  const loading = result.reference !== reference;
  const order = loading ? null : result.order;

  useEffect(() => {
    const controller = new AbortController();

    getOrder(reference, { signal: controller.signal })
      .then((fresh) => {
        if (!controller.signal.aborted) setResult({ reference, order: fresh });
      })
      .catch((error) => {
        if (error?.name === 'AbortError' || controller.signal.aborted) return;
        setResult({ reference, order: null });
      });

    return () => controller.abort();
  }, [reference]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="text-sm text-ink-500">Confirming your order…</p>
      </div>
    );
  }

  // Someone typing the URL, or a reference that never existed. The tracking
  // page owns "where is my order", so send them there rather than duplicating
  // the lookup form here.
  if (!order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="text-3xl text-ink-950">We can't find that order</h1>
        <p className="mt-2 text-ink-500">
          Check the reference on your confirmation — it looks like{' '}
          <span className="font-mono">EF-A2C4K9</span>.
        </p>
        <Link to="/track" className="btn-primary mt-6">
          Look up an order
        </Link>
      </div>
    );
  }

  const isDelivery = order.orderType === ORDER_TYPE.DELIVERY;
  const itemCount = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const steps = statusStepsFor(order.orderType);
  const firstName = (order.customer?.name ?? '').trim().split(/\s+/)[0];

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-10 sm:pt-14">
      {/* ── The celebration ──────────────────────────────────────────────── */}
      <div className="relative isolate text-center">
        <Confetti />

        {/* A warm bloom behind the seal, so it reads as a moment rather than
            an icon sitting on a page. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-2 -z-10 h-40 w-40 -translate-x-1/2
                     rounded-full bg-brand-500/15 blur-3xl"
        />

        <CheckSealIcon className="animate-seal-pop mx-auto h-16 w-16 text-leaf-500" />

        <p className="animate-hero-in mt-4 font-script text-3xl leading-none text-brand-600 sm:text-4xl">
          Thank you{firstName ? `, ${firstName}` : ''}
        </p>
        <h1 className="animate-hero-in mt-1 text-4xl text-ink-950 sm:text-5xl">
          Your order is in.
        </h1>
        <p className="animate-hero-in mx-auto mt-3 max-w-md text-ink-500">
          {storeConfig.name} has it on the pass. We'll start cooking it fresh —
          nothing sits under a lamp waiting for you.
        </p>
      </div>

      {/* ── The docket ───────────────────────────────────────────────────── */}
      <Stub order={order} isDelivery={isDelivery} itemCount={itemCount} />

      {/* ── What happens next ────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-center text-xl text-ink-950">What happens next</h2>

        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {steps.slice(0, 3).map((step, index) => (
            <li key={step.id} className="card flex items-start gap-3 p-4 sm:flex-col sm:gap-2">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-500/12
                           font-display text-base text-brand-600"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-ink-950">{step.label}</span>
                <span className="mt-0.5 block text-sm text-ink-500">{step.description}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Where it goes ────────────────────────────────────────────────── */}
      <section className="card mt-4 flex flex-wrap items-center gap-4 p-5">
        {isDelivery ? (
          <ScooterIcon className="h-8 w-8 shrink-0 text-brand-600" />
        ) : (
          <StorefrontIcon className="h-8 w-8 shrink-0 text-brand-600" />
        )}

        <div className="min-w-[12rem] flex-1">
          <h2 className="text-lg text-ink-950">
            {isDelivery ? 'Delivering to' : 'Collect from'}
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {isDelivery ? (
              <>
                {order.address?.line1}
                {order.address?.postcode ? `, ${order.address.postcode}` : ''}
              </>
            ) : (
              <>
                {storeConfig.address}, {storeConfig.postcode}
              </>
            )}
          </p>
        </div>

        {!isDelivery && (
          <a href={`tel:${storeConfig.phone}`} className="btn-secondary shrink-0 px-4 py-2 text-xs">
            Call the shop
          </a>
        )}
      </section>

      {order.customer?.email && (
        <p className="mt-4 flex items-center justify-center gap-2 text-center text-sm text-ink-500">
          <BellIcon className="h-4 w-4 shrink-0 text-brand-600" />
          Confirmation sent to {order.customer.email}
        </p>
      )}

      {/* ── Onward ───────────────────────────────────────────────────────── */}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to={`/order/${order.reference}`} className="btn-primary">
          <ReceiptIcon className="h-4 w-4" />
          Track your order
        </Link>
        <Link to="/menu" className="btn-secondary">
          <DrumstickIcon className="h-4 w-4" />
          Order something else
        </Link>
      </div>
    </div>
  );
}

/**
 * The tear-off stub.
 *
 * The notches are two circles in the page colour sitting half outside the
 * card, which is the cheapest way to cut a convincing perforation — no SVG
 * mask, and it survives the card being any height.
 */
function Stub({ order, isDelivery, itemCount }) {
  return (
    <section className="animate-hero-in relative mt-8 overflow-hidden rounded-2xl border border-surface-200 bg-surface-50">
      {/* Top half: the reference, which is what a customer reads out. */}
      <div className="px-6 pb-7 pt-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
          Order reference
        </p>
        <p className="mt-1.5 font-mono text-3xl font-bold tracking-[0.12em] text-brand-600 sm:text-4xl">
          {order.reference}
        </p>
      </div>

      {/* The perforation. */}
      <div className="relative" aria-hidden="true">
        <span className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border-r border-surface-200 bg-surface-0" />
        <span className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border-l border-surface-200 bg-surface-0" />
        <span className="mx-6 block border-t-2 border-dashed border-surface-300" />
      </div>

      {/* Bottom half: the details the kitchen and the customer both care about. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 px-6 pb-6 pt-7 sm:grid-cols-4">
        <Detail
          icon={<ClockIcon className="h-4 w-4" />}
          label={isDelivery ? 'Arriving' : 'Ready'}
          value={formatDateTime(new Date(order.readyAt))}
        />
        <Detail
          icon={isDelivery ? <ScooterIcon className="h-4 w-4" /> : <StorefrontIcon className="h-4 w-4" />}
          label="How"
          value={isDelivery ? 'Delivery' : 'Collection'}
        />
        <Detail
          icon={<DrumstickIcon className="h-4 w-4" />}
          label="Items"
          value={`${itemCount} item${itemCount === 1 ? '' : 's'}`}
        />
        <Detail
          icon={<ReceiptIcon className="h-4 w-4" />}
          label="Total"
          value={formatPence(order.totals.total)}
          strong
        />
      </dl>
    </section>
  );
}

function Detail({ icon, label, value, strong = false }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-500">
        <span className="text-brand-600">{icon}</span>
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm ${
          strong ? 'font-display text-lg tracking-wide text-brand-600' : 'text-ink-800'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * A single burst behind the seal.
 *
 * Fixed positions rather than random ones: a burst that lands differently on
 * every render is impossible to eyeball, and nobody sees it twice anyway. Pure
 * CSS on transform and opacity, so it composites on the GPU and costs no
 * main-thread work — and it is suppressed entirely for anyone who has asked
 * for reduced motion.
 */
const CONFETTI = [
  { dx: '-7.5rem', dy: '-1.5rem', spin: '-160deg', delay: 40, colour: 'bg-brand-500' },
  { dx: '-5rem', dy: '-4.5rem', spin: '120deg', delay: 0, colour: 'bg-amber-400' },
  { dx: '-2.5rem', dy: '-6rem', spin: '-90deg', delay: 90, colour: 'bg-leaf-500' },
  { dx: '0rem', dy: '-6.75rem', spin: '200deg', delay: 30, colour: 'bg-brand-400' },
  { dx: '2.5rem', dy: '-6rem', spin: '-140deg', delay: 110, colour: 'bg-brand-500' },
  { dx: '5rem', dy: '-4.5rem', spin: '90deg', delay: 20, colour: 'bg-leaf-500' },
  { dx: '7.5rem', dy: '-1.5rem', spin: '170deg', delay: 70, colour: 'bg-amber-400' },
  { dx: '-6.5rem', dy: '2.5rem', spin: '-110deg', delay: 130, colour: 'bg-brand-400' },
  { dx: '6.5rem', dy: '2.5rem', spin: '150deg', delay: 100, colour: 'bg-brand-500' },
];

function Confetti() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-8 -z-10 block h-0 w-0"
    >
      {CONFETTI.map((piece, index) => (
        <span
          key={index}
          className={`confetti-piece absolute h-2 w-2 rounded-[2px] ${piece.colour}`}
          style={{
            '--dx': piece.dx,
            '--dy': piece.dy,
            '--spin': piece.spin,
            animationDelay: `${piece.delay}ms`,
          }}
        />
      ))}
    </span>
  );
}
