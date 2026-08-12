import { fromPrice } from '../data/menu';
import { useCatalog } from '../context/CatalogContext';
import Thumb from '../components/Thumb';
import HeroSlider from '../components/HeroSlider';
import MenuBrowser from '../components/MenuBrowser';
import { toPence, formatPence } from '../lib/money';

export default function Home() {
  const { popularItems, categories } = useCatalog();

  return (
    <>
      <HeroSlider />


      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-3xl text-ink-950">Order in three taps</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Step number="1" title="Collection or delivery" body="Tell us how you want it. Delivery checks your postcode against our zone." />
          <Step number="2" title="Build your order" body="Pick a size, add extras, upgrade any main to a meal with fries and a drink." />
          <Step number="3" title="Pay by card" body="Card and Google Pay at checkout, then track it right through to your door." />
        </div>
      </section>

      {popularItems.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-6">
          <h2 className="text-3xl text-ink-950">Most ordered</h2>

          <div className="mt-5 flex gap-3 overflow-x-auto pb-2 no-scrollbar">
            {popularItems.map((item) => (
              <a
                key={item.id}
                href={`#category-${item.categoryId}`}
                className="card flex w-64 shrink-0 items-center gap-3 p-3 transition-colors hover:border-brand-500"
              >
                <Thumb
                  imageId={item.imageId}
                  emoji={item.emoji}
                  alt={item.name}
                  className="h-14 w-14 shrink-0"
                  emojiClass="text-2xl"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink-950">{item.name}</span>
                  <span className="block text-sm tabular-nums text-brand-600">
                    {formatPence(toPence(fromPrice(item)))}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* The whole menu lives on the landing page — no second click to browse. */}
      <section className="mx-auto max-w-6xl px-4 pt-6">
        <h2 className="text-4xl text-ink-950">The menu</h2>
        <p className="mt-1 text-ink-500">
          {categories.length} categories, everything made to order.
        </p>
      </section>

      <MenuBrowser />
    </>
  );
}

function Step({ number, title, body }) {
  return (
    <div className="card p-5">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 font-display text-lg text-white">
        {number}
      </span>
      <h3 className="mt-3 text-xl text-ink-950">{title}</h3>
      <p className="mt-1.5 text-sm text-ink-500">{body}</p>
    </div>
  );
}
