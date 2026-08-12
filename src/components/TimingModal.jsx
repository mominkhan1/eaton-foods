import { useMemo, useState } from 'react';
import Modal from './Modal';
import { useOrder } from '../context/OrderContext';
import { scheduleSlots, formatTime } from '../lib/hours';

/** ASAP vs a scheduled slot. Slots come from the trading-hours engine. */
export default function TimingModal({ open, onClose }) {
  const { orderType, timing, setTiming, storeOpen, opensAt, quote, canPreOrder, now } = useOrder();

  const days = useMemo(
    () => (open ? scheduleSlots(orderType, now) : []),
    [open, orderType, now],
  );

  const [activeDay, setActiveDay] = useState(0);
  const day = days[Math.min(activeDay, Math.max(days.length - 1, 0))];

  function chooseAsap() {
    setTiming({ mode: 'asap', slot: null });
    onClose();
  }

  function chooseSlot(value) {
    setTiming({ mode: 'scheduled', slot: value });
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="When do you want it?" size="sm">
      <div className="grid gap-4">
        <button
          type="button"
          onClick={chooseAsap}
          disabled={!storeOpen}
          className={`card flex items-center gap-3 p-4 text-left disabled:opacity-50 ${
            timing.mode === 'asap' ? 'border-brand-500' : ''
          }`}
        >
          <span className="text-2xl" aria-hidden="true">⚡</span>
          <span className="flex-1">
            <span className="block font-semibold text-ink-950">As soon as possible</span>
            <span className="block text-sm text-ink-500">
              {storeOpen
                ? `Ready in about ${quote.minutes} minutes`
                : opensAt
                  ? `Unavailable — we reopen at ${formatTime(opensAt)}`
                  : 'Unavailable while closed'}
            </span>
          </span>
        </button>

        {canPreOrder && days.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-500">
              Schedule for later
            </h3>

            <div className="mb-3 flex gap-2 overflow-x-auto no-scrollbar">
              {days.map((candidate, index) => (
                <button
                  key={candidate.dateKey}
                  type="button"
                  onClick={() => setActiveDay(index)}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold ${
                    index === activeDay
                      ? 'bg-brand-600 text-white'
                      : 'bg-surface-0 text-ink-500 hover:text-ink-800'
                  }`}
                >
                  {candidate.label}
                </button>
              ))}
            </div>

            <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1">
              {day?.slots.map((slot) => (
                <button
                  key={slot.value}
                  type="button"
                  onClick={() => chooseSlot(slot.value)}
                  className={`rounded-xl border px-2 py-2.5 text-sm tabular-nums transition-colors ${
                    timing.slot === slot.value
                      ? 'border-brand-500 bg-brand-500/10 text-brand-600'
                      : 'border-surface-300 text-ink-800 hover:border-brand-500'
                  }`}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {canPreOrder && days.length === 0 && (
          <p className="text-sm text-ink-500">No slots available at the moment.</p>
        )}
      </div>
    </Modal>
  );
}
