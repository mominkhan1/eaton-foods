import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCatalog } from '../context/CatalogContext';

export default function PromoBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { promo } = useCatalog();

  if (!promo.isOn || dismissed) return null;

  return (
    <div className="bg-brand-600 text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 text-sm">
        <span className="font-semibold">{promo.title}</span>
        <span className="hidden opacity-80 sm:inline">{promo.message}</span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 font-mono text-xs font-semibold">
          {promo.code}
        </span>

        <Link to="/menu" className="ml-auto shrink-0 font-semibold underline">
          {promo.buttonText}
        </Link>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss offer"
          className="shrink-0 rounded-full p-1 hover:bg-white/20"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
