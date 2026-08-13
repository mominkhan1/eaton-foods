import { useEffect, useMemo, useState } from 'react';
import RevenueChart from './RevenueChart';
import Thumb from '../components/Thumb';
import {
  buildReport,
  reportRange,
  GRANULARITY,
  GRANULARITY_LABELS,
} from '../lib/reports';
import { api } from '../lib/api';
import { useCatalog } from '../context/CatalogContext';
import { formatPence } from '../lib/money';
import { TrendUpIcon, TrendDownIcon } from '../components/Icons';

/**
 * Revenue and volume, read from the API's aggregated report.
 *
 * The endpoint counts only orders that were both paid and not cancelled — an
 * unpaid pending order is not money the shop has — so these figures are the
 * takings, not the order book.
 */
export default function AdminReports() {
  const [granularity, setGranularity] = useState(GRANULARITY.DAILY);

  // Tagged with the granularity it answers, so "still loading" is derived from
  // the result being for a different window rather than tracked separately —
  // a switch mid-flight can never leave a stale chart looking settled.
  const [result, setResult] = useState({ granularity: null, payload: null, error: null });
  const loading = result.granularity !== granularity;

  // Best sellers come back as names and quantities; the photo belongs to the
  // item, so it is matched up from the catalog we already have loaded.
  const { allItems } = useCatalog();
  const itemsByName = useMemo(
    () => new Map(allItems.map((item) => [item.name, item])),
    [allItems],
  );

  useEffect(() => {
    const controller = new AbortController();

    api.admin
      .getReports(reportRange(granularity), { signal: controller.signal })
      .then((payload) => setResult({ granularity, payload, error: null }))
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setResult({
          granularity,
          payload: null,
          error: error?.message ?? 'Could not load the report.',
        });
      });

    return () => controller.abort();
  }, [granularity]);

  const report = useMemo(
    () => buildReport({ granularity, daily: result.payload?.daily ?? [] }),
    [granularity, result],
  );

  const summary = result.payload?.summary;
  const best = result.payload?.topItems ?? [];
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
        {loading && ' · loading…'}
      </p>

      {result.error && (
        <p className="mt-4 rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">
          {result.error}
        </p>
      )}

      {!loading && summary?.orders === 0 && (
        <p className="mt-4 rounded-xl bg-surface-50 px-4 py-3 text-sm text-ink-500">
          No paid orders in this window, so every figure below is zero.
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Revenue"
          value={formatPence(summary?.revenuePence ?? 0)}
          hint={`across ${summary?.orders ?? 0} order${summary?.orders === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Average order"
          value={formatPence(summary?.averagePence ?? 0)}
          hint={`${formatPence(summary?.discountPence ?? 0)} discounted`}
        />
        <StatTile
          label="Delivery / collection"
          value={`${summary?.deliveryOrders ?? 0} / ${summary?.pickupOrders ?? 0}`}
          hint={
            summary?.orders > 0
              ? `${Math.round((summary.deliveryOrders / summary.orders) * 100)}% delivered`
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
          Peak {formatPence(report.peak?.revenue ?? 0)} on {report.peak?.label}. Cancelled and
          unpaid orders are excluded.
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
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Average</th>
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
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-500">
                      {bucket.orders > 0
                        ? formatPence(Math.round(bucket.revenue / bucket.orders))
                        : '—'}
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
                    {summary?.orders ?? 0}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-800">
                    {formatPence(summary?.averagePence ?? 0)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-brand-600">
                    {formatPence(summary?.revenuePence ?? 0)}
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
              {best.slice(0, 8).map((entry, index) => {
                // Matched by the name snapshotted on the order line, so an item
                // the shop has since renamed simply falls back to the icon.
                const item = itemsByName.get(entry.name);

                return (
                  <li key={entry.name} className="flex items-center gap-3 px-5 py-3">
                    <span className="w-4 text-xs tabular-nums text-ink-500">{index + 1}</span>
                    <Thumb
                      imageId={item?.imageId}
                      emoji={item?.emoji}
                      className="h-8 w-8 shrink-0"
                      rounded="rounded-md"
                      emojiClass="text-base"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
                      {entry.name}
                    </span>
                    <span className="text-xs tabular-nums text-ink-500">×{entry.quantity}</span>
                    <span className="w-16 text-right text-sm tabular-nums text-ink-950">
                      {formatPence(entry.revenuePence)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
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
      <p className={`mt-0.5 flex items-center gap-1 text-xs ${toneClass}`}>
        {tone === 'up' && <TrendUpIcon className="h-3 w-3" />}
        {tone === 'down' && <TrendDownIcon className="h-3 w-3" />}
        {hint}
      </p>
    </div>
  );
}
