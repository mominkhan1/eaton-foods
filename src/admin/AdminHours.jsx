import { useState } from 'react';
import {
  getHours,
  saveShifts,
  saveClosedDates,
  setManualStatus,
  resetHours,
  MANUAL_STATUS,
} from '../lib/repository';
import { DAY_NAMES, isScheduledOpen, isStoreOpen, nextOpenAt, formatTime } from '../lib/hours';
import { useCatalog } from '../context/CatalogContext';

const DAYS = [1, 2, 3, 4, 5, 6, 7];

function secondsToInput(seconds) {
  const total = Math.round(seconds / 60);
  const hour = Math.min(23, Math.floor(total / 60));
  const minute = total % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function inputToSeconds(value) {
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 3600 + minute * 60;
}

export default function AdminHours() {
  // `version` from the catalog context re-renders this on any repository write.
  useCatalog();

  const { shifts, closedDates, manualStatus } = getHours();
  const [notice, setNotice] = useState(null);
  const [newDate, setNewDate] = useState('');
  const [newReason, setNewReason] = useState('');

  function updateShift(target, patch) {
    const next = shifts.map((shift) =>
      shift === target || (shift.day === target.day && shift.start === target.start)
        ? { ...shift, ...patch }
        : shift,
    );
    saveShifts(next);
    setNotice(null);
  }

  function updateTime(shift, field, value) {
    const seconds = inputToSeconds(value);
    if (seconds === null) return;

    // An end before its start would silently close the shift for the whole
    // day, so refuse it rather than storing an unsatisfiable window.
    const start = field === 'start' ? seconds : shift.start;
    const end = field === 'end' ? seconds : shift.end;

    if (end <= start) {
      setNotice('A shift has to end after it starts. Use the second row for after-midnight hours.');
      return;
    }

    updateShift(shift, { [field]: seconds });
  }

  function addShift(day) {
    saveShifts([...shifts, { day, start: 12 * 3600, end: 22 * 3600, noDelivery: false, noPickup: false }]);
  }

  function removeShift(target) {
    saveShifts(
      shifts.filter(
        (shift) => !(shift.day === target.day && shift.start === target.start && shift.end === target.end),
      ),
    );
  }

  function addClosedDate(event) {
    event.preventDefault();
    if (!newDate) return;
    saveClosedDates([...closedDates, { date: newDate, reason: newReason.trim() || 'Closed' }]);
    setNewDate('');
    setNewReason('');
  }

  const open = isStoreOpen();
  const scheduled = isScheduledOpen();
  const opensAt = nextOpenAt();

  return (
    <div>
      <h1 className="text-4xl text-ink-950">Opening times</h1>

      <section className="card mt-5 p-5">
        <h2 className="text-xl text-ink-950">Right now</h2>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span
            className={`chip ${open ? 'bg-leaf-500/15 text-leaf-500' : 'bg-chilli-500/15 text-chilli-500'}`}
          >
            {open ? '● Open' : '○ Closed'}
          </span>

          <p className="text-sm text-ink-500">
            The schedule says <strong className="text-ink-800">{scheduled ? 'open' : 'closed'}</strong>
            {!scheduled && opensAt && ` until ${formatTime(opensAt)}`}.
          </p>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <OverrideCard
            active={manualStatus === MANUAL_STATUS.AUTO}
            onClick={() => setManualStatus(MANUAL_STATUS.AUTO)}
            title="Follow the schedule"
            body="Normal operation — the times below decide."
            icon="🗓️"
          />
          <OverrideCard
            active={manualStatus === MANUAL_STATUS.OPEN}
            onClick={() => setManualStatus(MANUAL_STATUS.OPEN)}
            title="Force open"
            body="Take orders even outside the schedule."
            icon="🟢"
          />
          <OverrideCard
            active={manualStatus === MANUAL_STATUS.CLOSED}
            onClick={() => setManualStatus(MANUAL_STATUS.CLOSED)}
            title="Force closed"
            body="Stop new orders now — kitchen backed up, fryer down."
            icon="🔴"
          />
        </div>
      </section>

      {notice && (
        <p className="mt-4 rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">{notice}</p>
      )}

      <section className="card mt-4 overflow-hidden">
        <header className="border-b border-surface-200 px-5 py-4">
          <h2 className="text-xl text-ink-950">Weekly schedule</h2>
          <p className="mt-1 text-sm text-ink-500">
            Late-night trading uses two rows: one ending at 23:59, and a second from 00:00 for the
            hours after midnight.
          </p>
        </header>

        <div className="divide-y divide-surface-200">
          {DAYS.map((day) => {
            const dayShifts = shifts
              .filter((shift) => shift.day === day)
              .sort((a, b) => a.start - b.start);

            return (
              <div key={day} className="flex flex-wrap items-start gap-4 px-5 py-4">
                <h3 className="w-28 shrink-0 pt-2 text-sm font-semibold text-ink-950">
                  {DAY_NAMES[day]}
                </h3>

                <div className="grid flex-1 gap-2">
                  {dayShifts.length === 0 && (
                    <p className="py-2 text-sm text-ink-500">Closed all day.</p>
                  )}

                  {dayShifts.map((shift) => (
                    <div
                      key={`${shift.day}-${shift.start}-${shift.end}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input
                        type="time"
                        className="field w-32 tabular-nums"
                        value={secondsToInput(shift.start)}
                        onChange={(event) => updateTime(shift, 'start', event.target.value)}
                        aria-label={`${DAY_NAMES[day]} opening time`}
                      />
                      <span className="text-ink-500">→</span>
                      <input
                        type="time"
                        className="field w-32 tabular-nums"
                        value={secondsToInput(shift.end)}
                        onChange={(event) => updateTime(shift, 'end', event.target.value)}
                        aria-label={`${DAY_NAMES[day]} closing time`}
                      />

                      <label className="ml-2 flex cursor-pointer items-center gap-2 text-xs text-ink-500">
                        <input
                          type="checkbox"
                          checked={shift.noDelivery}
                          onChange={(event) =>
                            updateShift(shift, { noDelivery: event.target.checked })
                          }
                          className="h-3.5 w-3.5 accent-brand-500"
                        />
                        No delivery
                      </label>

                      <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-500">
                        <input
                          type="checkbox"
                          checked={shift.noPickup}
                          onChange={(event) =>
                            updateShift(shift, { noPickup: event.target.checked })
                          }
                          className="h-3.5 w-3.5 accent-brand-500"
                        />
                        No collection
                      </label>

                      <button
                        type="button"
                        onClick={() => removeShift(shift)}
                        className="btn-ghost ml-auto px-2 py-1 text-xs hover:text-chilli-500"
                        aria-label="Remove this shift"
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => addShift(day)}
                    className="btn-ghost w-fit px-0 text-xs"
                  >
                    + Add a shift
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card mt-4 p-5">
        <h2 className="text-xl text-ink-950">Holiday closures</h2>
        <p className="mt-1 text-sm text-ink-500">
          The shop is shut all day on these dates whatever the schedule says.
        </p>

        <ul className="mt-4 grid gap-2">
          {closedDates.length === 0 && (
            <li className="text-sm text-ink-500">No closures set.</li>
          )}
          {closedDates.map((closed) => (
            <li
              key={closed.date}
              className="flex items-center gap-3 rounded-xl border border-surface-300 px-4 py-2.5"
            >
              <span className="text-sm tabular-nums text-ink-800">{closed.date}</span>
              <span className="text-sm text-ink-500">{closed.reason}</span>
              <button
                type="button"
                onClick={() =>
                  saveClosedDates(closedDates.filter((entry) => entry.date !== closed.date))
                }
                className="btn-ghost ml-auto px-2 py-1 text-xs hover:text-chilli-500"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={addClosedDate} className="mt-3 flex flex-wrap gap-2">
          <input
            type="date"
            className="field w-auto"
            value={newDate}
            onChange={(event) => setNewDate(event.target.value)}
            aria-label="Closure date"
          />
          <input
            className="field w-auto flex-1"
            value={newReason}
            onChange={(event) => setNewReason(event.target.value)}
            placeholder="Reason (e.g. Christmas Day)"
            aria-label="Closure reason"
          />
          <button type="submit" className="btn-secondary px-4 py-2 text-sm" disabled={!newDate}>
            Add closure
          </button>
        </form>
      </section>

      <div className="mt-8 border-t border-surface-200 pt-5">
        <button
          type="button"
          onClick={() => {
            resetHours();
            setNotice(null);
          }}
          className="btn-ghost px-0 text-xs hover:text-chilli-500"
        >
          Reset hours to the seed schedule
        </button>
      </div>
    </div>
  );
}

function OverrideCard({ active, onClick, title, body, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border p-4 text-left transition-colors ${
        active ? 'border-brand-500 bg-brand-500/8' : 'border-surface-300 hover:border-surface-300/70'
      }`}
    >
      <span className="text-xl" aria-hidden="true">{icon}</span>
      <span className="mt-1.5 block font-semibold text-ink-950">{title}</span>
      <span className="mt-0.5 block text-xs text-ink-500">{body}</span>
    </button>
  );
}
