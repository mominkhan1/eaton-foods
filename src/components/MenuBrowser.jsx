import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import CategoryNav from './CategoryNav';
import MenuItemCard from './MenuItemCard';
import ItemModal from './ItemModal';
import Thumb from './Thumb';
import { useCatalog } from '../context/CatalogContext';

/**
 * The full menu: sticky category rail, search, and every published item
 * grouped by category.
 *
 * Shared by the landing page and `/menu` so the two can never drift apart.
 */
export default function MenuBrowser({ id = 'menu' }) {
  const location = useLocation();
  const { categories, items } = useCatalog();

  const [query, setQuery] = useState('');
  const [activeItem, setActiveItem] = useState(null);

  // Links elsewhere in the app arrive as #category-burgers.
  useEffect(() => {
    if (!location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return categories
      .map((category) => ({
        category,
        items: items.filter(
          (item) =>
            item.categoryId === category.id &&
            (!needle ||
              item.name.toLowerCase().includes(needle) ||
              item.description?.toLowerCase().includes(needle)),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [query, categories, items]);

  const total = items.length;

  return (
    <div id={id}>
      <CategoryNav />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <label className="block">
          <span className="sr-only">Search the menu</span>
          <input
            type="search"
            className="field"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${total} items — wings, burger, family…`}
          />
        </label>

        {sections.length === 0 && (
          <p className="py-16 text-center text-ink-500">
            {total === 0
              ? 'The menu is empty. Add some items in the admin panel.'
              : `Nothing matches “${query}”. Try a different search.`}
          </p>
        )}

        {sections.map(({ category, items: categoryItems }) => (
          <section key={category.id} id={`category-${category.id}`} className="pt-10">
            <div className="mb-4 flex items-center gap-3">
              <Thumb
                imageId={category.imageId}
                emoji={category.emoji}
                className="h-12 w-12 shrink-0"
                emojiClass="text-2xl"
              />
              <div>
                <h2 className="text-3xl text-ink-950">{category.name}</h2>
                {category.description && (
                  <p className="mt-0.5 text-sm text-ink-500">{category.description}</p>
                )}
              </div>
            </div>

            {/* Two across even on the narrowest phone — a single column turns
                a 7-category menu into a very long scroll. Tighter gap there,
                since the columns themselves are narrow. */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {categoryItems.map((item) => (
                <MenuItemCard key={item.id} item={item} onSelect={setActiveItem} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <ItemModal
        item={activeItem}
        open={Boolean(activeItem)}
        onClose={() => setActiveItem(null)}
      />
    </div>
  );
}
