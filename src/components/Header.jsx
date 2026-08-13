import { Link, NavLink } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { storeConfig } from '../data/store';
import { formatPence } from '../lib/money';
import logo from '../assets/eat-on-logo.webp';

export default function Header() {
  const { totals, openCart } = useCart();

  return (
    <header className="sticky top-0 z-30 border-b border-surface-200 bg-surface-0/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link to="/" className="flex items-center" aria-label={`${storeConfig.name} home`}>
          {/*
            The full lockup, on its own — it already carries the "EAT ON"
            wordmark, so the text beside it was saying the same thing twice.
            The name now comes from the artwork, which is why the link keeps an
            aria-label: there is no readable text left in here.

            The negative bottom margin is what makes it straddle both bars. It
            shortens the margin box the header measures itself against while
            the artwork keeps its full height, so the logo hangs past the
            header border and over the service bar without making the header
            itself any taller. The header is `z-30` and clips nothing, so the
            overhang paints on top of the bar below.
          */}
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            width={140}
            height={140}
            // 140×140 from `sm` up. A phone header cannot carry that: the
            // overhang lands straight on the centred Collection / Delivery
            // pills in the bar below, so it steps down to 92 there.
            className="-mb-8 h-[92px] w-[92px] shrink-0 sm:-mb-16 sm:h-[140px] sm:w-[140px]"
          />
        </Link>

        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          <HeaderLink to="/">Home</HeaderLink>
          <HeaderLink to="/menu">Menu</HeaderLink>
          <HeaderLink to="/track">Track order</HeaderLink>
        </nav>

        <button
          type="button"
          onClick={openCart}
          className="btn-primary ml-auto sm:ml-0"
          aria-label={`Basket, ${totals.itemCount} items, ${formatPence(totals.total)}`}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M3 4h2l1.6 8.4a1 1 0 001 .8h7a1 1 0 001-.8L17 7H6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="8.5" cy="16.5" r="1.2" fill="currentColor" />
            <circle cx="14.5" cy="16.5" r="1.2" fill="currentColor" />
          </svg>
          <span className="tabular-nums">
            {totals.itemCount > 0 ? formatPence(totals.total) : 'Basket'}
          </span>
          {totals.itemCount > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-xs font-semibold text-brand-600">
              {totals.itemCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

function HeaderLink({ to, children }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `rounded-full px-4 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-surface-50 text-ink-950' : 'text-ink-500 hover:text-ink-800'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
