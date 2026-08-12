import { useState } from 'react';
import { useOrder } from '../context/OrderContext';
import { ORDER_TYPE, orderSetup } from '../data/store';
import { formatTime, formatDateTime } from '../lib/hours';
import AddressModal from './AddressModal';
import TimingModal from './TimingModal';

/**
 * The persistent "how and when" strip.
 *
 * Switching order type here re-runs every availability rule downstream: item
 * cards grey out, blocked basket lines surface, and the timing quote changes.
 */
export default function ServiceBar() {
  const { orderType, setOrderType, deliveryAddress, timing, quote, storeOpen, opensAt } = useOrder();
  const [addressOpen, setAddressOpen] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);

  function switchTo(next) {
    if (next === orderType) return;
    if (next === ORDER_TYPE.DELIVERY && !deliveryAddress) {
      setAddressOpen(true);
      return;
    }
    setOrderType(next);
  }

  const timingLabel =
    timing.mode === 'scheduled' && timing.slot
      ? formatDateTime(new Date(timing.slot))
      : storeOpen
        ? `ASAP · ~${quote.minutes} mins`
        : opensAt
          ? `Opens ${formatTime(opensAt)}`
          : 'Closed';

  return (
    <>
      <div className="border-b border-surface-200 bg-surface-50">
        {/*
          Three tracks so the controls sit dead centre of the page rather than
          centred in whatever space the status chip leaves over. Below `sm` it
          collapses to one column and everything stacks, centred.
        */}
        <div className="mx-auto grid max-w-6xl items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_auto_1fr]">
          <span className="hidden sm:block" aria-hidden="true" />

          <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="inline-flex rounded-full bg-surface-0 p-1">
            <SegmentButton
              active={orderType === ORDER_TYPE.PICKUP}
              onClick={() => switchTo(ORDER_TYPE.PICKUP)}
            >
              🏪 Collection
            </SegmentButton>
            {orderSetup.isDeliveryOn && (
              <SegmentButton
                active={orderType === ORDER_TYPE.DELIVERY}
                onClick={() => switchTo(ORDER_TYPE.DELIVERY)}
              >
                🛵 Delivery
              </SegmentButton>
            )}
          </div>

          {orderType === ORDER_TYPE.DELIVERY && (
            <button
              type="button"
              onClick={() => setAddressOpen(true)}
              className="max-w-[16rem] truncate rounded-full border border-surface-300 px-3.5 py-2 text-xs text-ink-500 hover:border-brand-500 hover:text-ink-800"
            >
              📍 {deliveryAddress ? `${deliveryAddress.line1}, ${deliveryAddress.postcode}` : 'Add your address'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setTimingOpen(true)}
            className="rounded-full border border-surface-300 px-3.5 py-2 text-xs text-ink-500 hover:border-brand-500 hover:text-ink-800"
          >
            🕒 {timingLabel}
          </button>
          </div>

          <span
            className={`chip justify-self-center sm:justify-self-end ${
              storeOpen ? 'bg-leaf-500/15 text-leaf-500' : 'bg-chilli-500/15 text-chilli-500'
            }`}
          >
            {storeOpen ? 'Open now' : 'Closed'}
          </span>
        </div>
      </div>

      <AddressModal open={addressOpen} onClose={() => setAddressOpen(false)} />
      <TimingModal open={timingOpen} onClose={() => setTimingOpen(false)} />
    </>
  );
}

function SegmentButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-800'
      }`}
    >
      {children}
    </button>
  );
}
