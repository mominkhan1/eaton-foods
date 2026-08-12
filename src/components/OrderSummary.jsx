import { useCart } from '../context/CartContext';
import { useOrder } from '../context/OrderContext';
import { useCatalog } from '../context/CatalogContext';
import { formatPence } from '../lib/money';
import { orderSetup, ORDER_TYPE } from '../data/store';

/** Totals breakdown, shared by the basket drawer and the checkout page. */
export default function OrderSummary() {
  const { totals } = useCart();
  const { orderType } = useOrder();
  const { promo } = useCatalog();

  return (
    <dl className="grid gap-1.5 text-sm">
      <Row label="Subtotal" value={formatPence(totals.subtotal)} />

      {totals.discount > 0 && (
        <Row
          label={`Promo (${promo.code})`}
          value={`− ${formatPence(totals.discount)}`}
          tone="positive"
        />
      )}

      {orderType === ORDER_TYPE.DELIVERY && (
        <Row
          label="Delivery"
          value={totals.delivery === 0 ? 'Free' : formatPence(totals.delivery)}
          tone={totals.delivery === 0 ? 'positive' : undefined}
        />
      )}

      {totals.surcharge > 0 && (
        <Row
          label={`Service charge (${orderSetup.platformSurchargePercentage}% + ${formatPence(
            orderSetup.platformSurchargeAmt * 100,
          )})`}
          value={formatPence(totals.surcharge)}
        />
      )}

      <div className="mt-2 flex items-baseline justify-between border-t border-surface-200 pt-3">
        <dt className="font-display text-xl tracking-wide text-ink-950">Total</dt>
        <dd className="font-display text-xl tabular-nums text-brand-600">
          {formatPence(totals.total)}
        </dd>
      </div>
    </dl>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className={`tabular-nums ${tone === 'positive' ? 'text-leaf-500' : 'text-ink-800'}`}>
        {value}
      </dd>
    </div>
  );
}
