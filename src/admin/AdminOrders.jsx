import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listOrders,
  setOrderStatus,
  acknowledgeOrder,
  nextStatusFor,
  statusStepsFor,
  findStatus,
  ORDER_STATUS,
} from '../lib/orders';
import { subscribe } from '../lib/repository';
import { ORDER_TYPE } from '../data/store';
import Thumb from '../components/Thumb';
import { formatPence } from '../lib/money';
import { lineUnitPence } from '../lib/pricing';
import { formatTime, formatDateTime } from '../lib/hours';
import {
  playChime,
  flashTitle,
  restoreTitle,
  notifyNewOrder,
  requestNotifications,
  notificationPermission,
  isAudioArmed,
} from '../lib/alerts';

const FILTERS = [
  { id: 'active', label: 'Active' },
  { id: 'new', label: 'New' },
  { id: 'all', label: 'All' },
  { id: 'complete', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function AdminOrders() {
  const [orders, setOrders] = useState(() => listOrders());
  const [filter, setFilter] = useState('active');
  const [expanded, setExpanded] = useState(null);
  const [permission, setPermission] = useState(() => notificationPermission());

  // References we've already alerted on, so a re-render never re-chimes.
  const alertedRef = useRef(new Set(listOrders().map((order) => order.reference)));

  useEffect(() => {
    function reload() {
      const next = listOrders();

      const fresh = next.filter(
        (order) => !alertedRef.current.has(order.reference) && order.status !== 'cancelled',
      );

      if (fresh.length > 0) {
        playChime(fresh.length > 1 ? 3 : 2);
        fresh.forEach((order) => {
          alertedRef.current.add(order.reference);
          notifyNewOrder(order);
        });
      }

      // Keep the set in step with reality so it can't grow forever.
      for (const order of next) alertedRef.current.add(order.reference);

      setOrders(next);
    }

    const unsubscribe = subscribe(reload);
    // Backstop for same-tab writes and any missed storage event.
    const id = setInterval(reload, 5000);

    return () => {
      unsubscribe();
      clearInterval(id);
      restoreTitle();
    };
  }, []);

  const pending = useMemo(
    () => orders.filter((order) => !order.acknowledgedAt && order.status !== 'cancelled'),
    [orders],
  );

  useEffect(() => {
    flashTitle(pending.length);
    return () => restoreTitle();
  }, [pending.length]);

  const visible = useMemo(() => {
    switch (filter) {
      case 'active':
        return orders
          .filter((order) => order.status !== 'complete' && order.status !== 'cancelled')
          .sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
      case 'new':
        return orders.filter((order) => !order.acknowledgedAt && order.status !== 'cancelled');
      case 'complete':
        return orders.filter((order) => order.status === 'complete');
      case 'cancelled':
        return orders.filter((order) => order.status === 'cancelled');
      default:
        return orders;
    }
  }, [orders, filter]);

  function advance(order) {
    const next = nextStatusFor(order);
    if (!next) return;
    if (!order.acknowledgedAt) acknowledgeOrder(order.reference);
    setOrderStatus(order.reference, next.id);
    setOrders(listOrders());
  }

  function setStatus(order, statusId) {
    setOrderStatus(order.reference, statusId);
    setOrders(listOrders());
  }

  function open(order) {
    if (!order.acknowledgedAt) acknowledgeOrder(order.reference);
    setExpanded(expanded === order.reference ? null : order.reference);
    setOrders(listOrders());
  }

  async function enableNotifications() {
    setPermission(await requestNotifications());
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl text-ink-950">Orders</h1>

        {pending.length > 0 && (
          <span className="chip animate-pulse bg-chilli-500 text-white">
            {pending.length} new
          </span>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                filter === entry.id
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-50 text-ink-500 hover:text-ink-800'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <AlertStatus
        permission={permission}
        onEnable={enableNotifications}
        audioArmed={isAudioArmed()}
      />

      {visible.length === 0 ? (
        <div className="card mt-6 grid place-items-center py-20 text-center">
          <span className="text-5xl" aria-hidden="true">🧾</span>
          <p className="mt-4 font-semibold text-ink-800">No orders here</p>
          <p className="mt-1 max-w-sm text-sm text-ink-500">
            Orders placed on this device show up here the moment they land. Open the shop in
            another tab and place one to see the alert fire.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3">
          {visible.map((order) => (
            <OrderCard
              key={order.reference}
              order={order}
              expanded={expanded === order.reference}
              onToggle={() => open(order)}
              onAdvance={() => advance(order)}
              onSetStatus={(statusId) => setStatus(order, statusId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AlertStatus({ permission, onEnable, audioArmed }) {
  if (permission === 'granted' && audioArmed) return null;

  return (
    <div className="card mt-4 flex flex-wrap items-center gap-3 p-4">
      <span className="text-xl" aria-hidden="true">🔔</span>
      <p className="flex-1 text-sm text-ink-500">
        {!audioArmed && 'Click anywhere to enable the order chime. '}
        {permission === 'granted'
          ? 'Desktop notifications are on.'
          : permission === 'unsupported'
            ? 'This browser has no desktop notifications — the chime and tab title still work.'
            : 'Turn on desktop notifications so the kitchen sees orders with the tab in the background.'}
      </p>
      {permission !== 'granted' && permission !== 'unsupported' && (
        <button type="button" onClick={onEnable} className="btn-secondary px-4 py-2 text-xs">
          Enable notifications
        </button>
      )}
    </div>
  );
}

const TONE_CLASS = {
  new: 'bg-chilli-500/15 text-chilli-500',
  active: 'bg-brand-500/12 text-brand-600',
  done: 'bg-leaf-500/15 text-leaf-500',
  cancelled: 'bg-surface-100 text-ink-500',
};

function OrderCard({ order, expanded, onToggle, onAdvance, onSetStatus }) {
  const status = findStatus(order.status);
  const next = nextStatusFor(order);
  const isNew = !order.acknowledgedAt && order.status !== 'cancelled';
  const isDelivery = order.orderType === ORDER_TYPE.DELIVERY;
  const late = new Date(order.readyAt) < new Date() && order.status !== 'complete' && order.status !== 'cancelled';

  return (
    <li className={`card overflow-hidden ${isNew ? 'border-chilli-500' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-3 p-4 text-left"
      >
        <span className="text-2xl" aria-hidden="true">{isDelivery ? '🛵' : '🏪'}</span>

        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-brand-600">
              {order.reference}
            </span>
            {isNew && <span className="chip bg-chilli-500 text-white">New</span>}
          </span>
          <span className="block text-sm text-ink-800">
            {order.customer?.name ?? 'Customer'} · {order.totals.itemCount} items
          </span>
        </span>

        <span className="hidden text-sm text-ink-500 sm:block">
          {isDelivery ? order.address?.postcode : 'Collection'}
        </span>

        <span className="ml-auto flex items-center gap-3">
          <span className="text-right">
            <span className={`block text-xs ${late ? 'text-chilli-500' : 'text-ink-500'}`}>
              {late ? 'Due ' : 'For '}
              {formatTime(new Date(order.readyAt))}
            </span>
            <span className="block text-sm font-semibold tabular-nums text-ink-950">
              {formatPence(order.totals.total)}
            </span>
          </span>

          <span className={`chip ${TONE_CLASS[status.tone]}`}>{status.label}</span>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-surface-200 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-500">
                Items
              </h3>
              <ul className="mt-2 grid gap-2">
                {order.lines.map((line) => (
                  <li key={line.lineId} className="flex gap-3 text-sm">
                    <span className="tabular-nums text-ink-500">{line.quantity}×</span>
                    <Thumb
                      imageId={line.imageId}
                      emoji={line.emoji}
                      className="h-9 w-9 shrink-0"
                      rounded="rounded-md"
                      emojiClass="text-base"
                    />
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
                        <span className="mt-0.5 block rounded bg-brand-500/10 px-2 py-1 text-xs italic text-brand-600">
                          “{line.notes}”
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-ink-800">
                      {formatPence(lineUnitPence(line) * line.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-500">
                Customer
              </h3>
              <p className="mt-2 text-sm text-ink-800">{order.customer?.name}</p>
              <p className="text-sm">
                <a href={`tel:${order.customer?.phone}`} className="text-brand-600 hover:underline">
                  {order.customer?.phone}
                </a>
              </p>
              {order.customer?.email && (
                <p className="text-sm text-ink-500">{order.customer.email}</p>
              )}

              {isDelivery && order.address && (
                <>
                  <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-ink-500">
                    Deliver to
                  </h3>
                  <p className="mt-1 text-sm text-ink-800">
                    {order.address.line1}, {order.address.postcode}
                  </p>
                  {order.address.notes && (
                    <p className="text-sm italic text-ink-500">“{order.address.notes}”</p>
                  )}
                </>
              )}

              <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-ink-500">
                Placed
              </h3>
              <p className="mt-1 text-sm text-ink-500">
                {formatDateTime(new Date(order.placedAt))}
                {order.timing?.mode === 'scheduled' && ' · scheduled'}
              </p>

              <dl className="mt-4 grid gap-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-500">Subtotal</dt>
                  <dd className="tabular-nums">{formatPence(order.totals.subtotal)}</dd>
                </div>
                {order.totals.discount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-500">Promo {order.promoCode}</dt>
                    <dd className="tabular-nums text-leaf-500">
                      − {formatPence(order.totals.discount)}
                    </dd>
                  </div>
                )}
                {isDelivery && (
                  <div className="flex justify-between">
                    <dt className="text-ink-500">Delivery</dt>
                    <dd className="tabular-nums">
                      {order.totals.delivery === 0 ? 'Free' : formatPence(order.totals.delivery)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-surface-200 pt-1 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums text-brand-600">
                    {formatPence(order.totals.total)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-surface-200 pt-4">
            {next && (
              <button type="button" onClick={onAdvance} className="btn-primary px-5 py-2.5 text-xs">
                Mark {next.label.toLowerCase()}
              </button>
            )}

            <select
              value={order.status}
              onChange={(event) => onSetStatus(event.target.value)}
              className="field w-auto py-2 text-xs"
              aria-label="Set status"
            >
              {statusStepsFor(order.orderType).map((step) => (
                <option key={step.id} value={step.id}>
                  {step.label}
                </option>
              ))}
              <option value="cancelled">Cancelled</option>
            </select>

            {order.status !== 'cancelled' && (
              <button
                type="button"
                onClick={() => onSetStatus('cancelled')}
                className="btn-ghost ml-auto px-3 py-2 text-xs hover:text-chilli-500"
              >
                Cancel order
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export { ORDER_STATUS };
