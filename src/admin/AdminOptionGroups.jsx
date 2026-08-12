import { useState } from 'react';
import Modal from '../components/Modal';
import { useCatalog } from '../context/CatalogContext';
import {
  saveModifierGroup,
  deleteModifierGroup,
} from '../lib/repository';
import { describeGroupRule } from '../data/menu';
import { slugify } from '../lib/slug';
import { toPence, formatPence } from '../lib/money';

/**
 * Option-group manager.
 *
 * A group is the "Choose your side" / "Add extras" block on an item. The shop
 * builds them here and attaches them to items from the item editor.
 */
export default function AdminOptionGroups() {
  const { modifierGroups, allItems } = useCatalog();
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [notice, setNotice] = useState(null);

  const groups = Object.values(modifierGroups).sort((a, b) => a.name.localeCompare(b.name));

  function usageFor(groupId) {
    return allItems.filter((item) => (item.modifierGroups ?? []).includes(groupId));
  }

  function onDelete(group) {
    const result = deleteModifierGroup(group.id);

    if (!result.ok) {
      // Offer the detach-and-delete path rather than dead-ending.
      setConfirmDelete({ group, ...result });
      return;
    }

    setNotice(`Deleted “${group.name}”.`);
  }

  function forceDelete() {
    const { group } = confirmDelete;
    const result = deleteModifierGroup(group.id, { force: true });
    setConfirmDelete(null);
    setNotice(
      `Deleted “${group.name}” and removed it from ${result.detachedFrom} item${
        result.detachedFrom === 1 ? '' : 's'
      }.`,
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-500">
          {groups.length} group{groups.length === 1 ? '' : 's'} · attach them to items from the item
          editor
        </p>

        <button
          type="button"
          onClick={() =>
            setDraft({
              isNew: true,
              name: '',
              min: 1,
              max: 1,
              options: [{ id: '', name: '', price: '0' }],
            })
          }
          className="btn-primary ml-auto px-4 py-2 text-xs"
        >
          + Option group
        </button>
      </div>

      {notice && (
        <p className="mt-4 rounded-xl bg-surface-50 px-4 py-3 text-sm text-ink-500">{notice}</p>
      )}

      {groups.length === 0 ? (
        <div className="card mt-5 grid place-items-center py-16 text-center">
          <span className="text-4xl" aria-hidden="true">🧩</span>
          <p className="mt-3 font-semibold text-ink-800">No option groups yet</p>
          <p className="mt-1 max-w-sm text-sm text-ink-500">
            Build one for things like spice level, a choice of side, or paid extras.
          </p>
        </div>
      ) : (
        <ul className="mt-5 grid gap-3 lg:grid-cols-2">
          {groups.map((group) => {
            const usage = usageFor(group.id);

            return (
              <li key={group.id} className="card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-ink-950">{group.name}</h3>
                    <p className="mt-0.5 text-xs text-ink-500">{describeGroupRule(group)}</p>
                  </div>

                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...group,
                          isNew: false,
                          options: group.options.map((option) => ({
                            ...option,
                            price: String(option.price),
                          })),
                        })
                      }
                      className="btn-ghost px-3 py-1.5 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(group)}
                      className="btn-ghost px-3 py-1.5 text-xs hover:text-chilli-500"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {group.options.map((option) => (
                    <li
                      key={option.id}
                      className="rounded-full bg-surface-0 px-3 py-1 text-xs text-ink-800"
                    >
                      {option.name}
                      {option.price > 0 && (
                        <span className="ml-1 tabular-nums text-brand-600">
                          +{formatPence(toPence(option.price))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                <p className="mt-3 border-t border-surface-200 pt-2.5 text-xs text-ink-500">
                  {usage.length === 0 ? (
                    'Not used by any item yet.'
                  ) : (
                    <>
                      Used by {usage.length} item{usage.length === 1 ? '' : 's'}:{' '}
                      <span className="text-ink-800">
                        {usage
                          .slice(0, 3)
                          .map((item) => item.name)
                          .join(', ')}
                        {usage.length > 3 && ` +${usage.length - 3} more`}
                      </span>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <GroupEditor
        draft={draft}
        existingIds={groups.map((group) => group.id)}
        onClose={() => setDraft(null)}
        onSaved={(name) => setNotice(`Saved “${name}”.`)}
      />

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Group is in use"
        size="sm"
      >
        {confirmDelete && (
          <>
            <p className="text-sm text-ink-500">
              “{confirmDelete.group.name}” is attached to {confirmDelete.count} item
              {confirmDelete.count === 1 ? '' : 's'}:
            </p>
            <ul className="mt-3 grid gap-1 text-sm text-ink-800">
              {confirmDelete.items.slice(0, 8).map((name) => (
                <li key={name}>· {name}</li>
              ))}
              {confirmDelete.items.length > 8 && (
                <li className="text-ink-500">+{confirmDelete.items.length - 8} more</li>
              )}
            </ul>

            <p className="mt-4 rounded-xl bg-chilli-500/10 px-4 py-3 text-xs text-chilli-500">
              Deleting it will remove the group from those items. Anything already in a customer's
              basket keeps the options they picked.
            </p>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="btn-secondary flex-1"
              >
                Keep it
              </button>
              <button type="button" onClick={forceDelete} className="btn-primary flex-1">
                Delete anyway
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function GroupEditor({ draft, existingIds, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  // Seed local state the first time a given draft appears.
  if (draft && (!form || form.__key !== (draft.id ?? 'new'))) {
    setForm({
      __key: draft.id ?? 'new',
      name: draft.name ?? '',
      min: String(draft.min ?? 0),
      max: String(draft.max ?? 1),
      options: draft.options?.length ? draft.options : [{ id: '', name: '', price: '0' }],
    });
    setError(null);
  }

  if (!draft || !form) return null;

  function close() {
    setForm(null);
    setError(null);
    onClose();
  }

  function updateOption(index, patch) {
    const options = [...form.options];
    options[index] = { ...options[index], ...patch };
    setForm({ ...form, options });
  }

  function addOption() {
    setForm({ ...form, options: [...form.options, { id: '', name: '', price: '0' }] });
  }

  function removeOption(index) {
    if (form.options.length === 1) return;
    setForm({ ...form, options: form.options.filter((_, position) => position !== index) });
  }

  const min = Number(form.min);
  const max = Number(form.max);
  const preview = describeGroupRule({ min, max });

  function onSubmit(event) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError('Give the group a name.');
      return;
    }
    if (!Number.isInteger(min) || min < 0) {
      setError('Minimum must be 0 or more.');
      return;
    }
    if (!Number.isInteger(max) || max < 1) {
      setError('Maximum must be at least 1.');
      return;
    }
    if (max < min) {
      setError('Maximum cannot be below the minimum.');
      return;
    }

    const named = form.options.filter((option) => option.name.trim());
    if (named.length === 0) {
      setError('Add at least one option.');
      return;
    }
    // A group that demands more picks than it offers can never be satisfied,
    // and would block Add to basket forever.
    if (named.length < min) {
      setError(`This asks for ${min} choices but only has ${named.length}.`);
      return;
    }

    const ids = [];
    const options = named.map((option) => {
      const id = option.id || slugify(option.name, ids, 'option');
      ids.push(id);

      const price = Number(option.price === '' ? 0 : option.price);
      return { id, name: option.name.trim(), price };
    });

    if (options.some((option) => !Number.isFinite(option.price) || option.price < 0)) {
      setError('Option prices must be 0 or more.');
      return;
    }
    if (new Set(options.map((option) => option.name.toLowerCase())).size !== options.length) {
      setError('Two options share a name.');
      return;
    }

    const id = draft.isNew ? slugify(form.name, existingIds, 'group') : draft.id;
    saveModifierGroup({ id, name: form.name.trim(), min, max, options });

    onSaved?.(form.name.trim());
    close();
  }

  return (
    <Modal
      open
      onClose={close}
      title={draft.isNew ? 'New option group' : 'Edit option group'}
      size="lg"
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-500">Group name</span>
          <input
            className="field"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Choose your side"
            autoFocus
          />
          <span className="mt-1 block text-xs text-ink-500/80">
            Shown as the heading above the options on the item.
          </span>
        </label>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-800">
            How many can they pick?
          </legend>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-ink-500">Minimum</span>
              <input
                type="number"
                min="0"
                className="field w-24 tabular-nums"
                value={form.min}
                onChange={(event) => setForm({ ...form, min: event.target.value })}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-ink-500">Maximum</span>
              <input
                type="number"
                min="1"
                className="field w-24 tabular-nums"
                value={form.max}
                onChange={(event) => setForm({ ...form, max: event.target.value })}
              />
            </label>

            <p className="pb-3 text-sm text-ink-500">
              →{' '}
              <span className="font-semibold text-brand-600">
                {Number.isFinite(min) && Number.isFinite(max) && max >= min && max >= 1
                  ? preview
                  : '—'}
              </span>
            </p>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <PresetButton onClick={() => setForm({ ...form, min: '1', max: '1' })}>
              Pick one (required)
            </PresetButton>
            <PresetButton onClick={() => setForm({ ...form, min: '0', max: '1' })}>
              Pick one (optional)
            </PresetButton>
            <PresetButton onClick={() => setForm({ ...form, min: '0', max: '5' })}>
              Any extras
            </PresetButton>
          </div>

          <p className="mt-2 text-xs text-ink-500/80">
            Minimum 0 makes the group optional. Set both to 1 for a straight either/or like spice
            level.
          </p>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-800">
            Options
          </legend>
          <p className="mb-2 text-xs text-ink-500">
            Leave the price at 0 for a free choice. Anything above 0 is added to the item price.
          </p>

          <div className="grid gap-2">
            {form.options.map((option, index) => (
              <div key={index} className="flex gap-2">
                <input
                  className="field flex-1"
                  value={option.name}
                  onChange={(event) => updateOption(index, { name: event.target.value })}
                  placeholder="BBQ Beans"
                  aria-label={`Option ${index + 1} name`}
                />
                <div className="relative w-28">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">
                    £
                  </span>
                  <input
                    className="field pl-7 tabular-nums"
                    value={option.price}
                    onChange={(event) => updateOption(index, { price: event.target.value })}
                    placeholder="0.00"
                    inputMode="decimal"
                    aria-label={`Option ${index + 1} extra charge`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeOption(index)}
                  disabled={form.options.length === 1}
                  className="btn-ghost px-3 disabled:opacity-30"
                  aria-label={`Remove option ${index + 1}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button type="button" onClick={addOption} className="btn-secondary mt-2 px-4 py-2 text-xs">
            + Add option
          </button>
        </fieldset>

        {error && (
          <p className="rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">{error}</p>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={close} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1">
            {draft.isNew ? 'Create group' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PresetButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-surface-0 px-3 py-1.5 text-xs text-ink-500 hover:text-ink-800"
    >
      {children}
    </button>
  );
}
