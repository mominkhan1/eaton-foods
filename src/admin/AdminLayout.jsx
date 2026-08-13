import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAdminAuth, AdminLogin } from './AdminAuth';
import { useCatalog } from '../context/CatalogContext';
import { storeConfig } from '../data/store';
import { getHours, setManualStatus, MANUAL_STATUS, subscribe } from '../lib/repository';
import { isStoreOpen, isScheduledOpen, formatTime, nextOpenAt } from '../lib/hours';
import { useOrderFeed } from './useOrderFeed';
import { armAudio } from '../lib/alerts';
import mark from '../assets/eat-on-mark.webp';

/*
 * `permission` mirrors what the API enforces for each area. Hiding a tab is a
 * courtesy so the kitchen tablet is not cluttered with pages it would only be
 * refused from — the real check happens server-side on every request.
 */
const NAV = [
  { to: '/admin', end: true, label: 'Orders', icon: '🧾', permission: 'orders.view' },
  { to: '/admin/menu', label: 'Menu', icon: '🍔', permission: 'menu.manage' },
  { to: '/admin/banners', label: 'Banners', icon: '🖼️', permission: 'banners.manage' },
  { to: '/admin/hours', label: 'Hours', icon: '🕒', permission: 'hours.manage' },
  { to: '/admin/reports', label: 'Reports', icon: '📊', permission: 'reports.view' },
];

export default function AdminLayout() {
  const { isAuthed, status, user, signOut, can } = useAdminAuth();
  const [, setTick] = useState(0);

  // The badge counts orders nobody has opened yet. The count comes from the
  // API rather than being derived here: the tab can be open on a phone in the
  // office while the orders arrive on the tablet in the kitchen.
  const { unacknowledgedCount } = useOrderFeed({
    scope: 'active',
    enabled: isAuthed && can('orders.view'),
  });

  const { error: catalogError, reload: reloadCatalog } = useCatalog();

  /*
   * The catalog is loaded by the provider above this component, which starts
   * before the session probe has finished — so on a cold load the admin
   * endpoints refuse it and the panel would otherwise sit on the seed data
   * forever. Re-read once, after the sign-in is confirmed.
   *
   * The ref is what stops this from becoming a retry loop: a second failure
   * leaves the banner below, and retrying is then the shop's decision.
   */
  const retriedRef = useRef(false);

  useEffect(() => {
    if (!isAuthed || !catalogError || retriedRef.current) return;
    retriedRef.current = true;
    reloadCatalog();
  }, [isAuthed, catalogError, reloadCatalog]);

  // Repository changes and a slow clock both refresh the header state.
  useEffect(() => {
    const unsubscribe = subscribe(() => setTick((value) => value + 1));
    const id = setInterval(() => setTick((value) => value + 1), 20000);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, []);

  // Waiting on the session probe. Showing the login form here would flash it
  // at an already-signed-in shop on every page refresh.
  if (status === 'checking') {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-100">
        <p className="text-sm text-ink-500">Loading…</p>
      </div>
    );
  }

  if (!isAuthed) return <AdminLogin />;

  const canManageHours = can('hours.manage');
  const visibleNav = NAV.filter((entry) => can(entry.permission));

  const { manualStatus } = getHours();
  const open = isStoreOpen();
  const scheduled = isScheduledOpen();
  const pending = unacknowledgedCount;
  const opensAt = nextOpenAt();

  function cycleStatus(next) {
    // A refused override (a dropped connection, a role without the
    // permission) must not leave the header claiming a state the shop is not
    // actually in, so the buttons follow the stored value rather than an
    // optimistic local one.
    setManualStatus(next).catch(() => setTick((value) => value + 1));
  }

  return (
    // The first click here also unlocks audio for the new-order chime.
    <div className="flex min-h-screen flex-col bg-surface-100" onClickCapture={armAudio}>
      <header className="sticky top-0 z-30 border-b border-surface-200 bg-surface-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/admin" className="flex items-center gap-2.5">
            <img src={mark} alt="" aria-hidden="true" width={57} height={36} className="h-9 w-auto" />
            <span className="leading-none">
              <span className="block font-display text-xl tracking-wider text-ink-950">
                {storeConfig.name}
              </span>
              <span className="block text-[0.6rem] uppercase tracking-[0.2em] text-ink-500">
                Admin
              </span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <StatusPill open={open} manualStatus={manualStatus} />

            {/* Forcing the shop open or shut is a manager decision, not a
                kitchen one — a staff login sees the state but cannot change it. */}
            {canManageHours && (
              <div className="inline-flex rounded-full bg-surface-50 p-1">
                <StatusButton
                  active={manualStatus === MANUAL_STATUS.AUTO}
                  onClick={() => cycleStatus(MANUAL_STATUS.AUTO)}
                  title={`Follow the schedule (currently ${scheduled ? 'open' : 'closed'})`}
                >
                  Auto
                </StatusButton>
                <StatusButton
                  active={manualStatus === MANUAL_STATUS.OPEN}
                  onClick={() => cycleStatus(MANUAL_STATUS.OPEN)}
                  title="Force open, ignoring the schedule"
                >
                  Open
                </StatusButton>
                <StatusButton
                  active={manualStatus === MANUAL_STATUS.CLOSED}
                  onClick={() => cycleStatus(MANUAL_STATUS.CLOSED)}
                  title="Force closed, ignoring the schedule"
                >
                  Closed
                </StatusButton>
              </div>
            )}

            {user && (
              <span className="hidden text-right text-xs leading-tight text-ink-500 sm:block">
                <span className="block font-medium text-ink-800">{user.name}</span>
                <span className="block capitalize">{user.role}</span>
              </span>
            )}

            <Link to="/" className="btn-secondary px-4 py-2 text-xs">
              View shop
            </Link>
            <button type="button" onClick={signOut} className="btn-ghost px-3 py-2 text-xs">
              Sign out
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 no-scrollbar">
          {visibleNav.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              end={entry.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-800'
                }`
              }
            >
              <span aria-hidden="true">{entry.icon}</span>
              {entry.label}
              {entry.label === 'Orders' && pending > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-chilli-500 px-1 text-xs font-bold text-white">
                  {pending}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </header>

      {catalogError && (
        <div className="border-b border-chilli-500/30 bg-chilli-500/10">
          <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2 text-xs text-chilli-500">
            The menu could not be loaded ({catalogError.message}) — the screens below may be out of
            date.
            <button
              type="button"
              onClick={reloadCatalog}
              className="btn-ghost px-2 py-1 text-xs underline"
            >
              Retry
            </button>
          </p>
        </div>
      )}

      {manualStatus !== MANUAL_STATUS.AUTO && (
        <div className="border-b border-brand-500/30 bg-brand-500/10">
          <p className="mx-auto max-w-7xl px-4 py-2 text-xs text-brand-600">
            Manual override active — the shop is forced{' '}
            <strong>{manualStatus === MANUAL_STATUS.OPEN ? 'open' : 'closed'}</strong>, ignoring
            the schedule
            {manualStatus === MANUAL_STATUS.CLOSED && opensAt
              ? ` (which would reopen it at ${formatTime(opensAt)})`
              : ''}
            . Switch back to <strong>Auto</strong> when the rush is over.
          </p>
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function StatusPill({ open, manualStatus }) {
  return (
    <span
      className={`chip flex items-center gap-1.5 ${
        open ? 'bg-leaf-500/15 text-leaf-500' : 'bg-chilli-500/15 text-chilli-500'
      }`}
    >
      <span aria-hidden="true">{open ? '●' : '○'}</span>
      {open ? 'Open' : 'Closed'}
      {manualStatus !== MANUAL_STATUS.AUTO && <span className="opacity-70">(manual)</span>}
    </span>
  );
}

function StatusButton({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-800'
      }`}
    >
      {children}
    </button>
  );
}
