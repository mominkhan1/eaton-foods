import { useState } from 'react';
import { useCart } from '../context/CartContext';
import { evaluatePromo } from '../lib/pricing';
import { formatPence } from '../lib/money';
import { useCatalog } from '../context/CatalogContext';

const MESSAGES = {
  'unknown-code': "That code isn't recognised.",
  'below-minimum': null, // filled in with the shortfall below
};

export default function PromoField() {
  const { promoCode, setPromoCode, totals } = useCart();
  const { promo } = useCatalog();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);

  if (!promo.isOn) return null;

  function apply(event) {
    event.preventDefault();
    const result = evaluatePromo(draft, totals.subtotal);

    if (!result.valid) {
      setError(
        result.reason === 'below-minimum'
          ? `Spend ${formatPence(result.minimum - totals.subtotal)} more to use this code.`
          : (MESSAGES[result.reason] ?? 'That code cannot be used.'),
      );
      return;
    }

    setError(null);
    setPromoCode(draft.trim().toUpperCase());
    setDraft('');
  }

  if (promoCode && totals.discount > 0) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-leaf-500/40 bg-leaf-500/10 px-4 py-3">
        <span className="text-sm text-leaf-500">
          <span className="font-semibold">{promoCode}</span> applied — you saved{' '}
          {formatPence(totals.discount)}
        </span>
        <button
          type="button"
          onClick={() => setPromoCode(null)}
          className="text-xs text-ink-500 underline hover:text-ink-800"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={apply}>
      <div className="flex gap-2">
        <input
          className="field uppercase"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          placeholder="Promo code"
          aria-label="Promo code"
        />
        <button type="submit" className="btn-secondary shrink-0" disabled={!draft.trim()}>
          Apply
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-chilli-500">{error}</p>}
    </form>
  );
}
