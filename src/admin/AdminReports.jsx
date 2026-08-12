import { useMemo, useState } from 'react';
import RevenueChart from './RevenueChart';
import Thumb from '../components/Thumb';
import { buildReport, topItems, GRANULARITY, GRANULARITY_LABELS } from '../lib/reports';
import { listOrders } from '../lib/repository';
import { useCatalog } from '../context/CatalogContext';
import { formatPence } from '../lib/money';

export default function AdminReports() {
  // Re-renders whenever the repository changes.
  const { version } = useCatalog();
  const [granularity, setGranularity] = useState(GRANULARITY.DAILY);

  // `version` is the invalidation signal, not an input: `listOrders()` reads
  // mutable module state that the linter cannot see.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const orders = useMemo(() => listOrders(), [version]);

  const report = useMemo(
    () => buildReport({ granularity, orders }),
    [granularity, orders],
  );

  const best = useMemo(
    () => topItems({ orders, since: report.buckets[0]?.start, limit: 8 }),
    [orders, report],
  );

  const { totals } = report;
  const windowLabel = `${report.buckets[0]?.label} – ${report.buckets[report.buckets.length - 1]?.label}`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl text-ink-950">Reports</h1>

        <div className="ml-auto inline-flex rounded-full bg-surface-50 p-1">
          {Object.values(GRANULARITY).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setGranularity(option)}
              aria-pressed={granularity === option}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                granularity === option
                  ? 'bg-brand-600 text-white'
                  : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {GRANULARITY_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-sm text-ink-500">
        {windowLabel} · {report.buckets.length} periods
      </p>

      {orders.length === 0 && (
        <p className="mt-4 rounded-xl bg-surface-50 px-4 py-3 text-sm text-ink-500">
          No orders recorded on this device yet, so every figure below is zero. Place an order on
          the shop to populate it.
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Revenue"
          value={formatPence(totals.revenue)}
          hint={`across ${totals.orders} order${totals.orders === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Average order"
          value={formatPence(totals.averageOrderValue)}
          hint={`${totals.items} items sold`}
        />
        <StatTile
          label="Delivery / collection"
          value={`${totals.delivery} / ${totals.collection}`}
          hint={
            totals.orders > 0
              ? `${Math.round((totals.delivery / totals.orders) * 100)}% delivered`
              : 'no orders yet'
          }
        />
        <StatTile
          label={`Latest ${GRANULARITY_LABELS[granularity].toLowerCase().replace('ly', '')}`}
          value={formatPence(report.current?.revenue ?? 0)}
          hint={
            report.changePercent === null
              ? 'no prior period'
              : `${report.changePercent >= 0 ? '+' : ''}${report.changePercent.toFixed(0)}% vs previous`
          }
          tone={report.changePercent === null ? undefined : report.changePercent >= 0 ? 'up' : 'down'}
        />
      </div>

      <section className="card mt-4 p-5">
        <h2 className="text-xl text-ink-950">
          Revenue by {GRANULARITY_LABELS[granularity].toLowerCase().replace('ly', '')}
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Peak {formatPence(report.peak?.revenue ?? 0)} on {report.peak?.label}. Cancelled orders
          are excluded.
        </p>

        <div className="mt-4">
          <RevenueChart buckets={report.buckets} granularity={granularity} />
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="card overflow-hidden">
          <header className="border-b border-surface-200 px-5 py-4">
            <h2 className="text-xl text-ink-950">Breakdown</h2>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 text-left text-xs uppercase tracking-wider text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Period</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Orders</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Delivery</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Collection</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200">
                {[...report.buckets].reverse().map((bucket) => (
                  <tr key={bucket.key}>
                    <th scope="row" className="px-5 py-2.5 text-left font-medium text-ink-800">
                      {bucket.label}
                    </th>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-500">
                      {bucket.orders}
                      {bucket.cancelled > 0 && (
                        <span className="text-chilli-500"> (+{bucket.cancelled}✕)</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-500">
                      {formatPence(bucket.deliveryRevenue)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-500">
                      {formatPence(bucket.collectionRevenue)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-ink-950">
                      {formatPence(bucket.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-surface-300">
                  <th scope="row" className="px-5 py-3 text-left text-ink-950">Total</th>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-800">
                    {totals.orders}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-800">
                    {formatPence(totals.deliveryRevenue)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-800">
                    {formatPence(totals.collectionRevenue)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-brand-600">
                    {formatPence(totals.revenue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="card overflow-hidden">
          <header className="border-b border-surface-200 px-5 py-4">
            <h2 className="text-xl text-ink-950">Best sellers</h2>
            <p className="mt-1 text-xs text-ink-500">By units sold in this window.</p>
          </header>

          {best.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-500">Nothing sold yet.</p>
          ) : (
            <ol className="divide-y divide-surface-200">
              {best.map((item, index) => (
                <li key={item.itemId} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-4 text-xs tabular-nums text-ink-500">{index + 1}</span>
                  <Thumb
                    imageId={item.imageId}
                    emoji={item.emoji}
                    className="h-8 w-8 shrink-0"
                    rounded="rounded-md"
                    emojiClass="text-base"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
                    {item.name}
                  </span>
                  <span className="text-xs tabular-nums text-ink-500">×{item.quantity}</span>
                  <span className="w-16 text-right text-sm tabular-nums text-ink-950">
                    {formatPence(item.revenue)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <p className="mt-6 rounded-xl bg-surface-50 px-4 py-3 text-xs text-ink-500">
        Figures cover orders stored in <strong>this browser</strong> only. A real deployment reads
        them from the server, where every device's orders live together.
      </p>
    </div>
  );
}

function StatTile({ label, value, hint, tone }) {
  const toneClass =
    tone === 'up' ? 'text-leaf-500' : tone === 'down' ? 'text-chilli-500' : 'text-ink-500';

  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">{label}</p>
      <p className="mt-1.5 text-3xl tabular-nums text-ink-950">{value}</p>
      <p className={`mt-0.5 text-xs ${toneClass}`}>
        {tone === 'up' && '▲ '}
        {tone === 'down' && '▼ '}
        {hint}
      </p>
    </div>
  );
}
