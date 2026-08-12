import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useOrder } from '../context/OrderContext';
import { formatPence } from '../lib/money';
import { lineUnitPence } from '../lib/pricing';
import OrderSummary from './OrderSummary';
import PromoField from './PromoField';
import Thumb from './Thumb';

export default function CartDrawer() {
  const navigate = useNavigate();
  const {
    lines,
    isOpen,
    closeCart,
    setQuantity,
    removeLine,
    totals,
    isEmpty,
    canCheckout,
    blockedLines,
    removeBlockedLines,
  } = useCart();
  const { orderType } = useOrder();

  useEffect(() => {
    if (!isOpen) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') closeCart();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, closeCart]);

  if (!isOpen) return null;

  function goToCheckout() {
    closeCart();
    navigate('/checkout');
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={closeCart} aria-hidden="true" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your basket"
        className="relative flex h-full w-full max-w-md flex-col border-l border-surface-200 bg-surface-50"
      >
        <header className="flex items-center justify-between border-b border-surface-200 px-5 py-4">
          <h2 className="text-2xl text-ink-950">Your basket</h2>
          <button
            type="button"
            onClick={closeCart}
            aria-label="Close basket"
            className="rounded-full p-1 text-ink-500 hover:bg-surface-100 hover:text-ink-800"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isEmpty ? (
            <div className="grid place-items-center py-16 text-center">
              <span className="text-5xl" aria-hidden="true">🍗</span>
              <p className="mt-4 font-semibold text-ink-800">Your basket is empty</p>
              <p className="mt-1 text-sm text-ink-500">Add something from the menu to get going.</p>
            </div>
          ) : (
            <>
              {blockedLines.length > 0 && (
                <div className="mb-4 rounded-xl border border-chilli-500/40 bg-chilli-500/10 p-4">
                  <p className="text-sm text-chilli-500">
                    {blockedLines.length === 1 ? 'One item is' : `${blockedLines.length} items are`}{' '}
                    collection only and can't be delivered.
                  </p>
                  <button
                    type="button"
                    onClick={removeBlockedLines}
                    className="mt-2 text-sm font-semibold text-chilli-500 underline"
                  >
                    Remove {blockedLines.length === 1 ? 'it' : 'them'}
                  </button>
                </div>
              )}

              <ul className="grid gap-3">
                {lines.map((line) => {
                  const blocked = blockedLines.some((candidate) => candidate.lineId === line.lineId);
                  return (
                    <li
                      key={line.lineId}
                      className={`card p-3 ${blocked ? 'border-chilli-500/40' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <Thumb
                          imageId={line.imageId}
                          emoji={line.emoji}
                          className="h-12 w-12 shrink-0"
                          rounded="rounded-lg"
                          emojiClass="text-xl"
                        />

                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-ink-950">{line.name}</p>
                          {line.sizeName && line.sizeName !== 'Serve' && (
                            <p className="text-xs text-ink-500">{line.sizeName}</p>
                          )}
                          {line.modifiers.length > 0 && (
                            <p className="mt-0.5 text-xs text-ink-500">
                              {line.modifiers.map((modifier) => modifier.optionName).join(' · ')}
                            </p>
                          )}
                          {line.notes && (
                            <p className="mt-0.5 text-xs italic text-ink-500">“{line.notes}”</p>
                          )}
                        </div>

                        <span className="text-sm tabular-nums text-ink-800">
                          {formatPence(lineUnitPence(line) * line.quantity)}
                        </span>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-1 rounded-full border border-surface-300 p-0.5">
                          <QtyButton
                            onClick={() => setQuantity(line.lineId, line.quantity - 1)}
                            label="Decrease quantity"
                          >
                            −
                          </QtyButton>
                          <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                          <QtyButton
                            onClick={() => setQuantity(line.lineId, line.quantity + 1)}
                            label="Increase quantity"
                          >
                            +
                          </QtyButton>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeLine(line.lineId)}
                          className="text-xs text-ink-500 underline hover:text-chilli-500"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4">
                <PromoField />
              </div>
            </>
          )}
        </div>

        {!isEmpty && (
          <footer className="border-t border-surface-200 px-5 py-4">
            {totals.freeDeliveryShortfall > 0 && (
              <p className="mb-3 rounded-xl bg-surface-0 px-4 py-2.5 text-xs text-ink-500">
                Spend {formatPence(totals.freeDeliveryShortfall)} more for free delivery.
              </p>
            )}

            {!totals.meetsMinimum && (
              <p className="mb-3 rounded-xl bg-chilli-500/10 px-4 py-2.5 text-xs text-chilli-500">
                Delivery minimum not met — add {formatPence(totals.minimumShortfall)} more, or
                switch to collection.
              </p>
            )}

            <OrderSummary />

            <button
              type="button"
              onClick={goToCheckout}
              disabled={!canCheckout}
              className="btn-primary mt-4 w-full"
            >
              Go to checkout
            </button>

            <p className="mt-2 text-center text-xs text-ink-500">
              {orderType === 'delivery' ? 'Delivering to your address' : 'Collection from Rusholme'}
            </p>
          </footer>
        )}
      </aside>
    </div>
  );
}

function QtyButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-full text-ink-800 hover:bg-surface-100"
    >
      {children}
    </button>
  );
}
