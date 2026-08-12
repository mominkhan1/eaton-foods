import { fromPrice, isItemAvailableFor } from '../data/menu';
import { toPence, formatPence } from '../lib/money';
import { useOrder } from '../context/OrderContext';
import Thumb from './Thumb';

/**
 * Menu card.
 *
 * Photo-led and full-width within its grid cell — a 4:3 image at this size is
 * the thing that actually sells the item, so it gets the space rather than a
 * thumbnail beside the text.
 *
 * Everything inside is a `<span>`: a `<button>` may not contain block-level
 * elements, and `<div>`s here produce invalid HTML.
 */
export default function MenuItemCard({ item, onSelect }) {
  const { orderType } = useOrder();
  const available = isItemAvailableFor(item, orderType);
  const hasChoices = item.sizes.length > 1;

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`card group flex h-full w-full flex-col overflow-hidden text-left
                  transition-colors hover:border-brand-500 ${available ? '' : 'opacity-60'}`}
    >
      <span className="relative block w-full overflow-hidden bg-surface-0">
        <Thumb
          imageId={item.imageId}
          emoji={item.emoji}
          alt={item.name}
          className="aspect-[4/3] w-full transition-transform duration-300 group-hover:scale-[1.04]"
          rounded="rounded-none"
          emojiClass="text-6xl sm:text-7xl"
        />

        <span className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {item.popular && (
            <span className="chip bg-brand-600 text-white shadow">Popular</span>
          )}
          {!available && (
            <span className="chip bg-surface-0/95 text-chilli-600 shadow">Collection only</span>
          )}
        </span>
      </span>

      {/* Everything here steps down a size below `sm`: two cards across a
          360px phone leaves roughly 150px of content width, and the desktop
          padding and type sizes crowd it. */}
      <span className="flex flex-1 flex-col p-3 sm:p-4">
        <span className="text-base font-semibold leading-tight text-ink-950 sm:text-lg">
          {item.name}
        </span>

        {item.description && (
          <span className="mt-1 line-clamp-2 text-xs leading-snug text-ink-500 sm:mt-1.5 sm:text-sm">
            {item.description}
          </span>
        )}

        <span className="mt-auto flex items-center justify-between gap-2 pt-3 sm:gap-3 sm:pt-4">
          <span className="text-sm font-semibold tabular-nums text-brand-600 sm:text-base">
            {hasChoices && (
              <span className="mr-1 text-xs font-normal text-ink-500">from</span>
            )}
            {formatPence(toPence(fromPrice(item)))}
          </span>

          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-0 text-lg
                       text-ink-500 transition-colors group-hover:bg-brand-500
                       group-hover:text-white sm:h-9 sm:w-9 sm:text-xl"
            aria-hidden="true"
          >
            +
          </span>
        </span>
      </span>
    </button>
  );
}
