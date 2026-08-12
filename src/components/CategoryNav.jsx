import { useEffect, useRef, useState } from 'react';
import { useCatalog } from '../context/CatalogContext';
import Thumb from './Thumb';

/**
 * Sticky category rail.
 *
 * The active category is driven by an IntersectionObserver on the section
 * headings rather than by scroll maths, and the rail auto-scrolls to keep the
 * active chip in view on mobile.
 */
export default function CategoryNav() {
  const { categories } = useCatalog();
  const [activeId, setActiveId] = useState(categories[0]?.id);
  const railRef = useRef(null);

  useEffect(() => {
    const sections = categories
      .map((category) => document.getElementById(`category-${category.id}`))
      .filter(Boolean);

    if (!sections.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible[0]) setActiveId(visible[0].target.id.replace('category-', ''));
      },
      // Band just under the sticky chrome, so a heading counts as "current"
      // once it reaches the top of the readable area.
      { rootMargin: '-140px 0px -70% 0px', threshold: 0 },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [categories]);

  useEffect(() => {
    const chip = railRef.current?.querySelector(`[data-category="${activeId}"]`);
    chip?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeId]);

  return (
    <div className="sticky top-[3.9rem] z-20 border-b border-surface-200 bg-surface-0/90 backdrop-blur">
      <div
        ref={railRef}
        className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 no-scrollbar"
      >
        {categories.map((category) => (
          <a
            key={category.id}
            href={`#category-${category.id}`}
            data-category={category.id}
            className={`flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-4 text-sm font-medium transition-colors ${
              activeId === category.id
                ? 'bg-brand-600 text-white'
                : 'bg-surface-50 text-ink-500 hover:text-ink-800'
            }`}
          >
            <Thumb
              imageId={category.imageId}
              emoji={category.emoji}
              className="h-7 w-7 shrink-0"
              rounded="rounded-full"
              emojiClass="text-sm"
            />
            {category.name}
          </a>
        ))}
      </div>
    </div>
  );
}
