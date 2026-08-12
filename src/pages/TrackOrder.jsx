import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getOrder, listOrders } from '../lib/orders';
import { formatDateTime } from '../lib/hours';
import { formatPence } from '../lib/money';

export default function TrackOrder() {
  const navigate = useNavigate();
  const [reference, setReference] = useState('');
  const [error, setError] = useState(null);
  const recent = listOrders().slice(0, 5);

  function onSubmit(event) {
    event.preventDefault();
    const order = getOrder(reference);

    if (!order) {
      setError("We couldn't find that reference on this device.");
      return;
    }

    navigate(`/order/${order.reference}`);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-4xl text-ink-950">Track your order</h1>
      <p className="mt-2 text-ink-500">
        Enter the reference from your confirmation, e.g. <span className="font-mono">EF-A2C4K9</span>.
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex gap-2">
        <input
          className="field uppercase"
          value={reference}
          onChange={(event) => {
            setReference(event.target.value);
            setError(null);
          }}
          placeholder="EF-XXXXXX"
          aria-label="Order reference"
        />
        <button type="submit" className="btn-primary shrink-0" disabled={!reference.trim()}>
          Track
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-chilli-500">{error}</p>}

      {recent.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl text-ink-950">Recent orders</h2>
          <ul className="mt-4 grid gap-2">
            {recent.map((order) => (
              <li key={order.reference}>
                <Link
                  to={`/order/${order.reference}`}
                  className="card flex items-center gap-4 p-4 transition-colors hover:border-brand-500"
                >
                  <span className="flex-1">
                    <span className="block font-mono text-sm text-brand-600">{order.reference}</span>
                    <span className="block text-xs text-ink-500">
                      {formatDateTime(new Date(order.placedAt))} ·{' '}
                      {order.orderType === 'delivery' ? 'Delivery' : 'Collection'}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-ink-800">
                    {formatPence(order.totals.total)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
