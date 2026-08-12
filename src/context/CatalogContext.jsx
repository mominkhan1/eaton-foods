import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  getCatalog,
  getHours,
  getBanners,
  getPromo,
  hydrate,
  isHydrated,
  getHydrationError,
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
 * Live view of the menu, trading hours, banners and coupon.
 *
 * Loads once from the API and then subscribes to the repository, so an edit in
 * the admin panel re-renders the customer site as soon as the write comes
 * back. `admin` asks for unpublished rows as well — the panel manages hidden
 * items and the storefront must never see them.
 */
export function CatalogProvider({ children, admin = false }) {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(() => !isHydrated());

  useEffect(() => subscribe(() => setVersion((current) => current + 1)), []);

  useEffect(() => {
    const controller = new AbortController();

    // `hydrate` resolves either way — it reports a failure through
    // getHydrationError() rather than rejecting, so the screen can show it
    // with a retry. Only an abort rejects, and that means we are unmounting.
    hydrate({ admin, signal: controller.signal })
      .then(() => setLoading(false))
      .catch(() => {});

    return () => controller.abort();
  }, [admin]);

  const reload = useCallback(async () => {
    setLoading(true);
    await hydrate({ admin });
    setLoading(false);
  }, [admin]);

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

      loading,
      error: getHydrationError(),
      reload,
    };
    // `version` is the invalidation signal — the snapshot is mutable module
    // state, so catalog/hours are not reliable dependencies on their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, loading, reload]);

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
