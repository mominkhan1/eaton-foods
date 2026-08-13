import { useState } from 'react';
import { useOrder } from '../context/OrderContext';
import { ORDER_TYPE, orderSetup } from '../data/store';
import { formatTime, formatDateTime } from '../lib/hours';
import AddressModal from './AddressModal';
import TimingModal from './TimingModal';
import { StorefrontIcon, ScooterIcon, PinIcon, ClockIcon } from './Icons';

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

  /*
   * A tighter wording for phones.
   *
   * The bar has to stay one row on a 360px screen, and "ASAP · ~10 mins" plus
   * the segmented control plus the status chip does not fit. This drops the
   * words that are inferable from context rather than shrinking the type,
   * which would hurt legibility for the sake of two syllables.
   */
  const timingLabelShort =
    timing.mode === 'scheduled' && timing.slot
      ? formatTime(new Date(timing.slot))
      : storeOpen
        ? `~${quote.minutes} min`
        : opensAt
          ? formatTime(opensAt)
          : 'Closed';

  return (
    <>
      <div className="border-b border-surface-200 bg-surface-50">
        {/*
          One row at every width.

          On phones this is a single non-wrapping flex line: the controls are
          how you switch between collection and delivery, so pushing them onto
          a second row costs vertical space right where the menu should be.
          It scrolls sideways if a long delivery address makes it overflow,
          rather than reflowing and shifting everything below it.

          From `sm` it becomes three grid tracks, so the controls sit dead
          centre of the page rather than centred in whatever space the status
          chip leaves over.
        */}
        <div
          className="no-scrollbar mx-auto flex max-w-6xl items-center gap-1.5 overflow-x-auto px-3 py-2.5 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-2 sm:overflow-x-visible sm:px-4"
        >
          <span className="hidden sm:block" aria-hidden="true" />

          <div className="flex shrink-0 items-center gap-1.5 sm:flex-wrap sm:justify-center sm:gap-2">
            <div className="inline-flex shrink-0 rounded-full bg-surface-0 p-1">
              <SegmentButton
                active={orderType === ORDER_TYPE.PICKUP}
                onClick={() => switchTo(ORDER_TYPE.PICKUP)}
              >
                <StorefrontIcon className="h-4 w-4" />
                {/* "Collect" on phones — both are ordinary takeaway wording,
                    and the shorter one buys the room to stay on one line. The
                    two halves must not be separated by a newline: JSX turns
                    that into a space and the button reads "Collect ion". */}
                <span>
                  Collect<span className="hidden sm:inline">ion</span>
                </span>
              </SegmentButton>
              {orderSetup.isDeliveryOn && (
                <SegmentButton
                  active={orderType === ORDER_TYPE.DELIVERY}
                  onClick={() => switchTo(ORDER_TYPE.DELIVERY)}
                >
                  <ScooterIcon className="h-4 w-4" />
                  <span>Delivery</span>
                </SegmentButton>
              )}
            </div>

            {orderType === ORDER_TYPE.DELIVERY && (
              <button
                type="button"
                onClick={() => setAddressOpen(true)}
                className="inline-flex max-w-[9rem] shrink-0 items-center gap-1.5 truncate rounded-full border border-surface-300 px-3 py-2 text-xs text-ink-500 hover:border-brand-500 hover:text-ink-800 sm:max-w-[16rem] sm:px-3.5"
              >
                <PinIcon className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                {deliveryAddress ? deliveryAddress.postcode : 'Address'}
                <span className="hidden sm:inline">
                  {deliveryAddress ? ` · ${deliveryAddress.line1}` : ''}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setTimingOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-surface-300 px-3 py-2 text-xs text-ink-500 hover:border-brand-500 hover:text-ink-800 sm:px-3.5"
            >
              <ClockIcon className="h-3.5 w-3.5 shrink-0 text-brand-600" />
              {/* Same control, less wording on a narrow screen. */}
              <span className="sm:hidden">{timingLabelShort}</span>
              <span className="hidden sm:inline">{timingLabel}</span>
            </button>
          </div>

          <span
            className={`chip shrink-0 whitespace-nowrap sm:justify-self-end ${
              storeOpen ? 'bg-leaf-500/15 text-leaf-500' : 'bg-chilli-500/15 text-chilli-500'
            }`}
          >
            {storeOpen ? (
              <>
                Open<span className="hidden sm:inline"> now</span>
              </>
            ) : (
              'Closed'
            )}
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
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors sm:px-4 ${
        active ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-800'
      }`}
    >
      {children}
    </button>
  );
}
