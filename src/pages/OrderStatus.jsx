import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getOrder, statusPosition } from '../lib/orders';
import { ORDER_TYPE, storeConfig } from '../data/store';
import { formatPence } from '../lib/money';
import { formatDateTime } from '../lib/hours';

/** How often the customer's tracking screen re-reads the order. */
const POLL_MS = 15000;

/**
 * Confirmation + live tracking, same screen.
 *
 * The reference site splits these; folding them together means the link in the
 * confirmation email and the "track order" link resolve to one place.
 */
export default function OrderStatus() {
  const { reference } = useParams();

  // Tagged with the reference it belongs to, so following a link to a
  // different order never shows the previous one while the new one loads.
  const [result, setResult] = useState({ reference: null, order: null });
  const loading = result.reference !== reference;
  const order = loading ? null : result.order;

  // The kitchen advances the status from its own device, so there is nothing
  // local to react to — the page has to ask. A failed poll keeps the order on
  // screen rather than replacing it with an error; the next tick recovers.
  useEffect(() => {
    const controller = new AbortController();

    async function reload() {
      try {
        const fresh = await getOrder(reference, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ reference, order: fresh });
      } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return;
        // Only the first attempt decides "no such order" — a later failure is
        // the connection, and the order already on screen stays put.
        setResult((current) =>
          current.reference === reference ? current : { reference, order: null },
        );
      }
    }

    reload();
    const id = setInterval(reload, POLL_MS);

    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [reference]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="text-sm text-ink-500">Looking up your order…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="text-3xl text-ink-950">Order not found</h1>
        <p className="mt-2 text-ink-500">
          We couldn't find order <span className="font-mono">{reference}</span>. Check the
          reference on your confirmation.
        </p>
        <Link to="/track" className="btn-secondary mt-6">
          Look up another order
        </Link>
      </div>
    );
  }

  const { steps, activeIndex, current, isCancelled } = statusPosition(order);
  const isDelivery = order.orderType === ORDER_TYPE.DELIVERY;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="text-center">
        <span className="text-5xl" aria-hidden="true">🎉</span>
        <h1 className="mt-3 text-4xl text-ink-950">Order confirmed</h1>
        <p className="mt-2 text-ink-500">
          Reference <span className="font-mono font-semibold text-brand-600">{order.reference}</span>
        </p>
        <p className="mt-1 text-ink-500">
          {isDelivery ? 'Arriving' : 'Ready for collection'} around{' '}
          <span className="font-semibold text-ink-800">
            {formatDateTime(new Date(order.readyAt))}
          </span>
        </p>
      </div>

      <section className="card mt-8 p-5">
        <h2 className="text-xl text-ink-950">{current.label}</h2>
        <p className="mt-1 text-sm text-ink-500">{current.description}</p>

        {isCancelled && (
          <p className="mt-3 rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">
            The shop cancelled this order. Call{' '}
            <a href={`tel:${storeConfig.phone}`} className="underline">
              {storeConfig.phoneDisplay}
            </a>{' '}
            if you were not expecting that.
          </p>
        )}

        <ol className={`mt-5 grid gap-0 ${isCancelled ? 'opacity-40' : ''}`}>
          {steps.map((step, index) => {
            const done = index < activeIndex;
            const active = index === activeIndex;

            return (
              <li key={step.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      done || active ? 'bg-brand-600 text-white' : 'bg-surface-100 text-ink-500'
                    }`}
                  >
                    {done ? '✓' : index + 1}
                  </span>
                  {index < steps.length - 1 && (
                    <span
                      className={`w-0.5 flex-1 ${done ? 'bg-brand-500' : 'bg-surface-100'}`}
                      aria-hidden="true"
                    />
                  )}
                </div>

                <div className={`pb-5 ${index === steps.length - 1 ? 'pb-0' : ''}`}>
                  <p className={active ? 'font-semibold text-ink-950' : 'text-ink-500'}>
                    {step.label}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card mt-4 p-5">
        <h2 className="text-xl text-ink-950">{isDelivery ? 'Delivering to' : 'Collect from'}</h2>
        <p className="mt-1 text-sm text-ink-500">
          {isDelivery ? (
            <>
              {order.address?.line1}, {order.address?.postcode}
            </>
          ) : (
            <>
              {storeConfig.address}, {storeConfig.postcode}
              <br />
              <a href={`tel:${storeConfig.phone}`} className="text-brand-600 hover:underline">
                {storeConfig.phoneDisplay}
              </a>
            </>
          )}
        </p>
      </section>

      <section className="card mt-4 p-5">
        <h2 className="text-xl text-ink-950">Your order</h2>

        <ul className="mt-4 grid gap-3 border-b border-surface-200 pb-4">
          {order.lines.map((line, index) => (
            <li key={index} className="flex items-start gap-3 text-sm">
              <span className="tabular-nums text-ink-500">{line.quantity}×</span>
              <span className="min-w-0 flex-1">
                <span className="block text-ink-800">{line.name}</span>
                {line.sizeName && line.sizeName !== 'Serve' && (
                  <span className="block text-xs text-ink-500">{line.sizeName}</span>
                )}
                {line.modifiers.length > 0 && (
                  <span className="block text-xs text-ink-500">
                    {line.modifiers.map((modifier) => modifier.optionName).join(' · ')}
                  </span>
                )}
                {line.notes && (
                  <span className="block text-xs italic text-ink-500">“{line.notes}”</span>
                )}
              </span>
              <span className="tabular-nums text-ink-800">{formatPence(line.totalPence)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 grid gap-1.5 text-sm">
          <SummaryRow label="Subtotal" value={formatPence(order.totals.subtotal)} />
          {order.totals.discount > 0 && (
            <SummaryRow label="Promo" value={`− ${formatPence(order.totals.discount)}`} />
          )}
          {isDelivery && (
            <SummaryRow
              label="Delivery"
              value={order.totals.delivery === 0 ? 'Free' : formatPence(order.totals.delivery)}
            />
          )}
          {order.totals.surcharge > 0 && (
            <SummaryRow label="Service charge" value={formatPence(order.totals.surcharge)} />
          )}
          <div className="mt-2 flex justify-between border-t border-surface-200 pt-3">
            <dt className="font-display text-xl text-ink-950">Total paid</dt>
            <dd className="font-display text-xl tabular-nums text-brand-600">
              {formatPence(order.totals.total)}
            </dd>
          </div>
        </dl>
      </section>

      <div className="mt-6 flex justify-center gap-3">
        <Link to="/menu" className="btn-secondary">
          Order again
        </Link>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="tabular-nums text-ink-800">{value}</dd>
    </div>
  );
}
