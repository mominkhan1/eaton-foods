import { useMemo, useState } from 'react';
import Modal from '../components/Modal';
import { useCatalog } from '../context/CatalogContext';
import {
  saveCategory,
  deleteCategory,
  saveItem,
  deleteItem,
  setItemPublished,
} from '../lib/repository';
import { ORDER_TYPE } from '../data/store';
import { toPence, formatPence } from '../lib/money';
import { fromPrice, describeGroupRule } from '../data/menu';
import { slugify } from '../lib/slug';
import AdminOptionGroups from './AdminOptionGroups';
import ImageField from './ImageField';
import Thumb from '../components/Thumb';
import { deleteImage } from '../lib/images';
import { useAdminAction } from './useAdminAction';
import { CloseIcon } from '../components/Icons';

export default function AdminMenu() {
  const { allCategories, allItems, modifierGroups } = useCatalog();
  const { run, busy, error } = useAdminAction();

  const [tab, setTab] = useState('items');
  const [categoryDraft, setCategoryDraft] = useState(null);
  const [itemDraft, setItemDraft] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [notice, setNotice] = useState(null);

  const itemsByCategory = useMemo(() => {
    const map = new Map();
    for (const item of allItems) {
      if (!map.has(item.categoryId)) map.set(item.categoryId, []);
      map.get(item.categoryId).push(item);
    }
    return map;
  }, [allItems]);

  const shownCategories =
    activeCategory === 'all'
      ? allCategories
      : allCategories.filter((category) => category.id === activeCategory);

  async function onDeleteCategory(category) {
    setNotice(null);

    const { ok, result } = await run(() => deleteCategory(category.id));
    if (!ok) return;

    if (!result.ok) {
      setNotice(
        `“${category.name}” still has ${result.count} item${result.count === 1 ? '' : 's'}. Move or delete them first.`,
      );
      return;
    }

    // The row is gone, so the photo is no longer in use — `force` is not
    // needed, but the delete is deliberately not awaited into an error: a
    // leftover file is a tidiness problem, not something to report as a
    // failed deletion.
    if (category.imageId) deleteImage(category.imageId);
  }

  async function onDeleteItem(item) {
    setNotice(null);
    const { ok } = await run(() => deleteItem(item.id));
    if (ok && item.imageId) deleteImage(item.imageId);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl text-ink-950">Menu</h1>

        <div className="inline-flex rounded-full bg-surface-50 p-1">
          <TabButton active={tab === 'items'} onClick={() => setTab('items')}>
            Categories &amp; items
          </TabButton>
          <TabButton active={tab === 'options'} onClick={() => setTab('options')}>
            Option groups
          </TabButton>
        </div>
      </div>

      {tab === 'options' ? (
        <div className="mt-5">
          <AdminOptionGroups />
        </div>
      ) : (
        <ItemsTab
          allCategories={allCategories}
          allItems={allItems}
          itemsByCategory={itemsByCategory}
          shownCategories={shownCategories}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          notice={notice}
          error={error}
          busy={busy}
          onDeleteCategory={onDeleteCategory}
          onDeleteItem={onDeleteItem}
          onSetPublished={(item) =>
            run(() => setItemPublished(item.id, item.isPublished === false))
          }
          setCategoryDraft={setCategoryDraft}
          setItemDraft={setItemDraft}
        />
      )}

      <CategoryEditor
        draft={categoryDraft}
        existingIds={allCategories.map((category) => category.id)}
        nextOrder={allCategories.length + 1}
        onClose={() => setCategoryDraft(null)}
      />

      <ItemEditor
        draft={itemDraft}
        categories={allCategories}
        modifierGroups={modifierGroups}
        existingIds={allItems.map((item) => item.id)}
        onClose={() => setItemDraft(null)}
      />
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
        active ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-800'
      }`}
    >
      {children}
    </button>
  );
}

function ItemsTab({
  allCategories,
  allItems,
  itemsByCategory,
  shownCategories,
  activeCategory,
  setActiveCategory,
  notice,
  error,
  busy,
  onDeleteCategory,
  onDeleteItem,
  onSetPublished,
  setCategoryDraft,
  setItemDraft,
}) {
  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-500">
          {allCategories.length} categories · {allItems.length} items
        </span>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setCategoryDraft({ isNew: true, name: '', emoji: '🍽️', description: '' })}
            className="btn-secondary px-4 py-2 text-xs"
          >
            + Category
          </button>
          <button
            type="button"
            onClick={() =>
              setItemDraft({
                isNew: true,
                name: '',
                description: '',
                emoji: '🍽️',
                categoryId: allCategories[0]?.id ?? '',
                popular: false,
                collectionOnly: false,
                sizes: [{ id: 'std', name: 'Serve', price: '' }],
                modifierGroups: [],
              })
            }
            className="btn-primary px-4 py-2 text-xs"
            disabled={allCategories.length === 0}
          >
            + Food item
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">
          {error}
        </p>
      )}

      {notice && (
        <p className="mt-4 rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">
          {notice}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <FilterChip active={activeCategory === 'all'} onClick={() => setActiveCategory('all')}>
          All
        </FilterChip>
        {allCategories.map((category) => (
          <FilterChip
            key={category.id}
            active={activeCategory === category.id}
            onClick={() => setActiveCategory(category.id)}
          >
            {category.emoji} {category.name}
          </FilterChip>
        ))}
      </div>

      <div className="mt-6 grid gap-5">
        {shownCategories.map((category) => {
          const items = itemsByCategory.get(category.id) ?? [];

          return (
            <section key={category.id} className="card overflow-hidden">
              <header className="flex flex-wrap items-center gap-3 border-b border-surface-200 px-4 py-3">
                <Thumb
                  imageId={category.imageId}
                  emoji={category.emoji}
                  className="h-10 w-10 shrink-0"
                  rounded="rounded-lg"
                  emojiClass="text-xl"
                />
                <span>
                  <span className="block font-semibold text-ink-950">{category.name}</span>
                  <span className="block text-xs text-ink-500">
                    {items.length} item{items.length === 1 ? '' : 's'}
                    {category.description ? ` · ${category.description}` : ''}
                  </span>
                </span>

                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCategoryDraft({ ...category, isNew: false })}
                    className="btn-ghost px-3 py-1.5 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteCategory(category)}
                    disabled={busy}
                    className="btn-ghost px-3 py-1.5 text-xs hover:text-chilli-500 disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </header>

              {items.length === 0 ? (
                <p className="px-4 py-6 text-sm text-ink-500">Nothing in this category yet.</p>
              ) : (
                <ul className="divide-y divide-surface-200">
                  {items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Thumb
                        imageId={item.imageId}
                        emoji={item.emoji}
                        className="h-11 w-11 shrink-0"
                        rounded="rounded-lg"
                        emojiClass="text-lg"
                      />

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink-950">{item.name}</span>
                          {item.popular && (
                            <span className="chip bg-brand-500/12 text-brand-600">Popular</span>
                          )}
                          {item.orderTypes && (
                            <span className="chip bg-surface-0 text-ink-500">Collection only</span>
                          )}
                          {item.isPublished === false && (
                            <span className="chip bg-chilli-500/15 text-chilli-500">Hidden</span>
                          )}
                        </span>
                        {item.description && (
                          <span className="block truncate text-xs text-ink-500">
                            {item.description}
                          </span>
                        )}
                      </span>

                      <span className="text-sm tabular-nums text-ink-800">
                        {item.sizes.length > 1 && 'from '}
                        {formatPence(toPence(fromPrice(item)))}
                      </span>

                      <span className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => onSetPublished(item)}
                          disabled={busy}
                          className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-40"
                          title={item.isPublished === false ? 'Show on the menu' : 'Hide from the menu'}
                        >
                          {item.isPublished === false ? 'Show' : 'Hide'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setItemDraft({
                              ...item,
                              isNew: false,
                              collectionOnly: Boolean(item.orderTypes),
                              sizes: item.sizes.map((size) => ({ ...size, price: String(size.price) })),
                              modifierGroups: item.modifierGroups ?? [],
                            })
                          }
                          className="btn-ghost px-3 py-1.5 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteItem(item)}
                          disabled={busy}
                          className="btn-ghost px-3 py-1.5 text-xs hover:text-chilli-500 disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

    </>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-brand-600 text-white' : 'bg-surface-50 text-ink-500 hover:text-ink-800'
      }`}
    >
      {children}
    </button>
  );
}

function CategoryEditor({ draft, existingIds, nextOrder, onClose }) {
  const { run, busy } = useAdminAction();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  // Seed local state the first time a given draft appears.
  if (draft && (!form || form.__key !== (draft.id ?? 'new'))) {
    setForm({
      __key: draft.id ?? 'new',
      name: draft.name ?? '',
      emoji: draft.emoji ?? '🍽️',
      description: draft.description ?? '',
      imageId: draft.imageId ?? null,
    });
    setError(null);
  }

  if (!draft || !form) return null;

  async function onSubmit(event) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError('Give the category a name.');
      return;
    }

    const { ok, error: failure } = await run(() =>
      saveCategory({
        id: draft.isNew ? slugify(form.name, existingIds) : draft.id,
        name: form.name.trim(),
        emoji: form.emoji.trim() || '🍽️',
        description: form.description.trim(),
        imageId: form.imageId,
        displayOrder: draft.isNew ? nextOrder : draft.displayOrder,
        isPublished: draft.isPublished ?? true,
      }),
    );

    // The modal stays open on a failure, so the shop does not lose what it
    // typed to an error it might want to correct.
    if (!ok) {
      setError(failure?.message ?? 'That category could not be saved.');
      return;
    }

    setForm(null);
    onClose();
  }

  return (
    <Modal
      open
      onClose={() => {
        setForm(null);
        onClose();
      }}
      title={draft.isNew ? 'New category' : 'Edit category'}
      size="sm"
    >
      <form onSubmit={onSubmit} className="grid gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-500">Name</span>
          <input
            className="field"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Loaded Fries"
            autoFocus
          />
        </label>

        <ImageField
          value={form.imageId}
          onChange={(imageId) => setForm({ ...form, imageId })}
          emoji={form.emoji}
          label="Category photo"
        />

        <label className="block">
          <span className="mb-1 block text-sm text-ink-500">
            Icon <span className="text-ink-500/70">— used when there is no photo</span>
          </span>
          <input
            className="field"
            value={form.emoji}
            onChange={(event) => setForm({ ...form, emoji: event.target.value })}
            placeholder="🍟"
            maxLength={4}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-ink-500">
            Description <span className="text-ink-500/70">(optional)</span>
          </span>
          <input
            className="field"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Shown under the category heading"
          />
        </label>

        {error && <p className="text-sm text-chilli-500">{error}</p>}

        <button type="submit" className="btn-primary mt-1" disabled={busy}>
          {busy ? 'Saving…' : draft.isNew ? 'Add category' : 'Save changes'}
        </button>
      </form>
    </Modal>
  );
}

function ItemEditor({ draft, categories, modifierGroups, existingIds, onClose }) {
  const { run, busy } = useAdminAction();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  if (draft && (!form || form.__key !== (draft.id ?? 'new'))) {
    setForm({
      __key: draft.id ?? 'new',
      name: draft.name ?? '',
      description: draft.description ?? '',
      emoji: draft.emoji ?? '🍽️',
      categoryId: draft.categoryId ?? categories[0]?.id ?? '',
      popular: Boolean(draft.popular),
      collectionOnly: Boolean(draft.collectionOnly),
      imageId: draft.imageId ?? null,
      sizes: draft.sizes?.length ? draft.sizes : [{ id: 'std', name: 'Serve', price: '' }],
      modifierGroups: draft.modifierGroups ?? [],
    });
    setError(null);
  }

  if (!draft || !form) return null;

  function close() {
    setForm(null);
    onClose();
  }

  function updateSize(index, patch) {
    const sizes = [...form.sizes];
    sizes[index] = { ...sizes[index], ...patch };
    setForm({ ...form, sizes });
  }

  function addSize() {
    setForm({
      ...form,
      sizes: [...form.sizes, { id: `size-${form.sizes.length + 1}`, name: '', price: '' }],
    });
  }

  function removeSize(index) {
    if (form.sizes.length === 1) return;
    setForm({ ...form, sizes: form.sizes.filter((_, position) => position !== index) });
  }

  function toggleGroup(groupId) {
    const chosen = form.modifierGroups.includes(groupId)
      ? form.modifierGroups.filter((id) => id !== groupId)
      : [...form.modifierGroups, groupId];
    setForm({ ...form, modifierGroups: chosen });
  }

  async function onSubmit(event) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError('Give the item a name.');
      return;
    }
    if (!form.categoryId) {
      setError('Pick a category.');
      return;
    }

    const sizes = form.sizes.map((size, index) => ({
      id: size.id || `size-${index + 1}`,
      name: size.name.trim() || 'Serve',
      price: Number(size.price),
      ...(size.note ? { note: size.note } : {}),
    }));

    if (sizes.some((size) => !Number.isFinite(size.price) || size.price <= 0)) {
      setError('Every size needs a price above zero.');
      return;
    }

    const duplicateSizeIds = new Set(sizes.map((size) => size.id)).size !== sizes.length;
    if (duplicateSizeIds) {
      setError('Two sizes share an id — rename one.');
      return;
    }

    const { ok, error: failure } = await run(() =>
      saveItem({
        id: draft.isNew ? slugify(form.name, existingIds) : draft.id,
        categoryId: form.categoryId,
        name: form.name.trim(),
        description: form.description.trim(),
        emoji: form.emoji.trim() || '🍽️',
        imageId: form.imageId,
        popular: form.popular,
        sizes,
        modifierGroups: form.modifierGroups,
        // `null` removes the restriction entirely rather than storing an empty
        // array, which `isItemAvailableFor` would read as "sold nowhere".
        // `undefined` would not survive the JSON round-trip to the API.
        orderTypes: form.collectionOnly ? [ORDER_TYPE.PICKUP] : null,
        isPublished: draft.isPublished ?? true,
      }),
    );

    if (!ok) {
      setError(failure?.message ?? 'That item could not be saved.');
      return;
    }

    close();
  }

  return (
    <Modal open onClose={close} title={draft.isNew ? 'New food item' : 'Edit food item'} size="lg">
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[5rem_1fr]">
          <label className="block">
            <span className="mb-1 block text-sm text-ink-500">Icon</span>
            <input
              className="field text-center text-xl"
              value={form.emoji}
              onChange={(event) => setForm({ ...form, emoji: event.target.value })}
              maxLength={4}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink-500">Name</span>
            <input
              className="field"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Magnum Fillet Burger"
              autoFocus
            />
          </label>
        </div>

        <ImageField
          value={form.imageId}
          onChange={(imageId) => setForm({ ...form, imageId })}
          emoji={form.emoji}
          label="Item photo"
        />

        <label className="block">
          <span className="mb-1 block text-sm text-ink-500">Description</span>
          <textarea
            className="field resize-none"
            rows={2}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Chicken fillet, hash brown, cheese, mayo and lettuce."
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-ink-500">Category</span>
          <select
            className="field"
            value={form.categoryId}
            onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.emoji} {category.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-800">
            Sizes &amp; prices
          </legend>
          <p className="mb-2 text-xs text-ink-500">
            The size carries the price. Add a second size called “Make it a meal” to offer the
            fries-and-drink upgrade.
          </p>

          <div className="grid gap-2">
            {form.sizes.map((size, index) => (
              <div key={index} className="flex gap-2">
                <input
                  className="field flex-1"
                  value={size.name}
                  onChange={(event) => updateSize(index, { name: event.target.value })}
                  placeholder="On its own"
                  aria-label={`Size ${index + 1} name`}
                />
                <div className="relative w-32">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">
                    £
                  </span>
                  <input
                    className="field pl-7 tabular-nums"
                    value={size.price}
                    onChange={(event) => updateSize(index, { price: event.target.value })}
                    placeholder="5.00"
                    inputMode="decimal"
                    aria-label={`Size ${index + 1} price`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeSize(index)}
                  disabled={form.sizes.length === 1}
                  className="btn-ghost px-3 disabled:opacity-30"
                  aria-label={`Remove size ${index + 1}`}
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button type="button" onClick={addSize} className="btn-secondary mt-2 px-4 py-2 text-xs">
            + Add size
          </button>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-800">
            Option groups
          </legend>

          {Object.keys(modifierGroups).length === 0 ? (
            <p className="rounded-xl border border-surface-300 px-4 py-3 text-sm text-ink-500">
              No option groups yet — build one on the <strong>Option groups</strong> tab, then come
              back and attach it here.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.values(modifierGroups).map((group) => (
                <label
                  key={group.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    form.modifierGroups.includes(group.id)
                      ? 'border-brand-500 bg-brand-500/8'
                      : 'border-surface-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.modifierGroups.includes(group.id)}
                    onChange={() => toggleGroup(group.id)}
                    className="h-4 w-4 accent-brand-500"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink-800">{group.name}</span>
                    <span className="block text-xs text-ink-500">
                      {describeGroupRule(group)} · {group.options.length} option
                      {group.options.length === 1 ? '' : 's'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-surface-300 px-3 py-2.5">
            <input
              type="checkbox"
              checked={form.popular}
              onChange={(event) => setForm({ ...form, popular: event.target.checked })}
              className="h-4 w-4 accent-brand-500"
            />
            <span className="text-sm text-ink-800">Show as popular</span>
          </label>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-surface-300 px-3 py-2.5">
            <input
              type="checkbox"
              checked={form.collectionOnly}
              onChange={(event) => setForm({ ...form, collectionOnly: event.target.checked })}
              className="h-4 w-4 accent-brand-500"
            />
            <span className="text-sm text-ink-800">Collection only</span>
          </label>
        </div>

        {error && (
          <p className="rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">{error}</p>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={close} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={busy}>
            {busy ? 'Saving…' : draft.isNew ? 'Add item' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
