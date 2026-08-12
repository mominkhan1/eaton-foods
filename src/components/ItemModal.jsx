import { useMemo, useState } from 'react';
import Modal from './Modal';
import { isItemAvailableFor, describeGroupRule } from '../data/menu';
import { useCatalogHelpers } from '../context/CatalogContext';
import Thumb from './Thumb';
import { buildLine, lineUnitPence } from '../lib/pricing';
import { toPence, formatPence } from '../lib/money';
import { useCart } from '../context/CartContext';
import { useOrder } from '../context/OrderContext';

/**
 * Item configurator.
 *
 * The `key` remounts the configurator whenever a different item is opened, so
 * its state initialisers do the resetting. An effect that reset state on an
 * `item` change was the previous approach; it is easy to get subtly wrong and
 * causes a cascading render on every open.
 */
export default function ItemModal({ item, open, onClose }) {
  if (!item || !open) return null;
  return <ItemConfigurator key={item.id} item={item} onClose={onClose} />;
}

/**
 * Size first (it carries the base price), then modifier groups. A group with
 * `min >= 1` is required and blocks Add until answered; `max > 1` renders as
 * checkboxes and stops accepting once full.
 */
function ItemConfigurator({ item, onClose }) {
  const { addLine, openCart } = useCart();
  const { orderType } = useOrder();
  const { modifierGroupsFor } = useCatalogHelpers();

  const groups = useMemo(() => modifierGroupsFor(item), [item, modifierGroupsFor]);

  const [sizeId, setSizeId] = useState(() => item.sizes[0].id);
  const [selections, setSelections] = useState(() =>
    Object.fromEntries(
      modifierGroupsFor(item).map((group) => [
        group.id,
        // Pre-select the first option of a required single-choice group so
        // the common path is one tap.
        group.min >= 1 && group.max === 1 ? [group.options[0].id] : [],
      ]),
    ),
  );
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const size = item.sizes.find((candidate) => candidate.id === sizeId) ?? item.sizes[0];
  const available = isItemAvailableFor(item, orderType);

  function toggleOption(group, optionId) {
    setSelections((current) => {
      const chosen = current[group.id] ?? [];

      if (group.max === 1) {
        return { ...current, [group.id]: [optionId] };
      }

      if (chosen.includes(optionId)) {
        return { ...current, [group.id]: chosen.filter((id) => id !== optionId) };
      }

      if (chosen.length >= group.max) return current;

      return { ...current, [group.id]: [...chosen, optionId] };
    });
  }

  const selectedModifiers = groups.flatMap((group) =>
    (selections[group.id] ?? []).map((optionId) => {
      const option = group.options.find((candidate) => candidate.id === optionId);
      return {
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        pricePence: toPence(option.price),
      };
    }),
  );

  const missingGroups = groups.filter(
    (group) => group.min >= 1 && (selections[group.id] ?? []).length < group.min,
  );

  const previewLine = buildLine({ item, size, selectedModifiers, quantity, notes });
  const unit = lineUnitPence(previewLine);

  function onAdd() {
    if (missingGroups.length > 0) {
      setShowErrors(true);
      return;
    }
    addLine(previewLine);
    onClose();
    openCart();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={item.name}
      size="md"
      footer={
        <div className="flex items-center gap-3">
          <QuantityStepper value={quantity} onChange={setQuantity} />
          <button
            type="button"
            onClick={onAdd}
            disabled={!available}
            className="btn-primary flex-1 justify-between"
          >
            <span>{available ? 'Add to basket' : 'Collection only'}</span>
            <span className="tabular-nums">{formatPence(unit * quantity)}</span>
          </button>
        </div>
      }
    >
      <div className="grid gap-5">
        {item.imageId ? (
          // With a real photo, lead with it full-width — it is the best thing
          // on the screen for selling the item.
          <div>
            <Thumb
              imageId={item.imageId}
              emoji={item.emoji}
              alt={item.name}
              className="h-48 w-full sm:h-56"
              rounded="rounded-2xl"
            />
            {item.description && (
              <p className="mt-3 text-sm text-ink-500">{item.description}</p>
            )}
            {item.badge && (
              <span className="chip mt-2 inline-block bg-brand-500/12 text-brand-600">
                {item.badge}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <Thumb
              imageId={null}
              emoji={item.emoji}
              className="h-16 w-16 shrink-0"
              rounded="rounded-2xl"
            />
            <div>
              {item.description && <p className="text-sm text-ink-500">{item.description}</p>}
              {item.badge && (
                <span className="chip mt-2 inline-block bg-brand-500/12 text-brand-600">
                  {item.badge}
                </span>
              )}
            </div>
          </div>
        )}

        {!available && (
          <p className="rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">
            This one is collection only — switch to collection to order it.
          </p>
        )}

        {item.sizes.length > 1 && (
          <section>
            <GroupHeading title="Choose a size" required />
            <div className="grid gap-2">
              {item.sizes.map((candidate) => (
                <OptionRow
                  key={candidate.id}
                  type="radio"
                  checked={candidate.id === size.id}
                  onChange={() => setSizeId(candidate.id)}
                  label={candidate.name}
                  note={candidate.note}
                  price={formatPence(toPence(candidate.price))}
                />
              ))}
            </div>
          </section>
        )}

        {groups.map((group) => {
          const chosen = selections[group.id] ?? [];
          const isMissing = showErrors && group.min >= 1 && chosen.length < group.min;

          return (
            <section key={group.id}>
              <GroupHeading
                title={group.name}
                required={group.min >= 1}
                hint={group.max > 1 || group.min > 1 ? describeGroupRule(group) : null}
                error={
                  isMissing
                    ? group.min > 1
                      ? `Choose at least ${group.min}`
                      : 'Please choose an option'
                    : null
                }
              />
              <div className="grid gap-2">
                {group.options.map((option) => {
                  const checked = chosen.includes(option.id);
                  const atLimit = group.max > 1 && !checked && chosen.length >= group.max;

                  return (
                    <OptionRow
                      key={option.id}
                      type={group.max === 1 ? 'radio' : 'checkbox'}
                      checked={checked}
                      disabled={atLimit}
                      onChange={() => toggleOption(group, option.id)}
                      label={option.name}
                      price={option.price > 0 ? `+ ${formatPence(toPence(option.price))}` : null}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold uppercase tracking-wider text-ink-500">
            Special requests
          </span>
          <textarea
            className="field resize-none"
            rows={2}
            maxLength={200}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Extra crispy, no salt on the fries…"
          />
        </label>
      </div>
    </Modal>
  );
}

function GroupHeading({ title, required, hint, error }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-800">{title}</h3>
      {required && <span className="chip bg-surface-0 text-ink-500">Required</span>}
      {hint && <span className="text-xs text-ink-500">{hint}</span>}
      {error && <span className="text-xs text-chilli-500">{error}</span>}
    </div>
  );
}

function OptionRow({ type, checked, disabled, onChange, label, note, price }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
        checked ? 'border-brand-500 bg-brand-500/8' : 'border-surface-300 hover:border-surface-300/80'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <input
        type={type}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-4 w-4 accent-brand-500"
      />
      <span className="flex-1">
        <span className="block text-sm text-ink-800">{label}</span>
        {note && <span className="block text-xs text-ink-500">{note}</span>}
      </span>
      {price && <span className="text-sm tabular-nums text-ink-500">{price}</span>}
    </label>
  );
}

function QuantityStepper({ value, onChange }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-surface-300 p-1">
      <StepperButton onClick={() => onChange(Math.max(1, value - 1))} label="Decrease quantity">
        −
      </StepperButton>
      <span className="w-6 text-center text-sm tabular-nums">{value}</span>
      <StepperButton onClick={() => onChange(Math.min(50, value + 1))} label="Increase quantity">
        +
      </StepperButton>
    </div>
  );
}

function StepperButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-full text-lg text-ink-800 hover:bg-surface-100"
    >
      {children}
    </button>
  );
}
