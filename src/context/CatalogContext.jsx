import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  getCatalog,
  getHours,
  getBanners,
  getPromo,
  subscribe,
} from '../lib/repository';
import {
  sortByDisplayOrder,
  isPublished,
  resolveModifierGroups,
} from '../data/menu';
import { isBannerRenderable } from '../data/banners';

const CatalogContext = createContext(null);

/**
 * Live view of the menu and trading hours.
 *
 * Subscribes to the repository, so an edit in the admin panel — including one
 * made in another browser tab — re-renders the customer site immediately.
 */
export function CatalogProvider({ children }) {
  const [version, setVersion] = useState(0);

  useEffect(() => subscribe(() => setVersion((current) => current + 1)), []);

  const catalog = getCatalog();
  const hours = getHours();
  const bannerState = getBanners();
  const promo = getPromo();

  const value = useMemo(() => {
    const categories = sortByDisplayOrder(catalog.categories);
    const publishedItems = catalog.items.filter(isPublished);
    const allBanners = sortByDisplayOrder(bannerState.slides);

    return {
      // Admin views want everything; the storefront wants published only.
      allCategories: categories,
      allItems: catalog.items,
      modifierGroups: catalog.modifierGroups,
      categories,
      items: publishedItems,
      popularItems: publishedItems.filter((item) => item.popular),
      hours,
      allBanners,
      // A slide with no heading would render as an empty hero.
      banners: allBanners.filter((slide) => isPublished(slide) && isBannerRenderable(slide)),
      bannerSettings: bannerState.settings,
      promo,
      version,
    };
    // `version` is the invalidation signal — catalog/hours are mutable module
    // state, so they are not reliable dependencies on their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const context = useContext(CatalogContext);
  if (!context) throw new Error('useCatalog must be used inside a CatalogProvider');
  return context;
}

/** Helpers bound to the current catalog. */
export function useCatalogHelpers() {
  const { items, allItems, categories, modifierGroups } = useCatalog();

  const findItem = useCallback(
    (itemId) => allItems.find((item) => item.id === itemId) ?? null,
    [allItems],
  );

  const findCategory = useCallback(
    (categoryId) => categories.find((category) => category.id === categoryId) ?? null,
    [categories],
  );

  const itemsForCategory = useCallback(
    (categoryId) => items.filter((item) => item.categoryId === categoryId),
    [items],
  );

  const modifierGroupsFor = useCallback(
    (item) => resolveModifierGroups(item, modifierGroups),
    [modifierGroups],
  );

  return { findItem, findCategory, itemsForCategory, modifierGroupsFor };
}
