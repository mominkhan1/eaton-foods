import { useState } from 'react';
import Modal from '../components/Modal';
import Thumb from '../components/Thumb';
import ImageField from './ImageField';
import { useCatalog } from '../context/CatalogContext';
import {
  saveBanner,
  deleteBanner,
  setBannerPublished,
  moveBanner,
  saveBannerSettings,
  savePromo,
} from '../lib/repository';
import { deleteImage } from '../lib/images';
import { useAdminAction } from './useAdminAction';
import {
  AUTOPLAY_MIN_SECONDS,
  AUTOPLAY_MAX_SECONDS,
  isBannerRenderable,
} from '../data/banners';
import { isBrowserHref, hasLink } from '../lib/links';
import { slugify } from '../lib/slug';
import { formatPence, toPence } from '../lib/money';

/**
 * The first-order coupon.
 *
 * Text fields keep a local draft and save when they lose focus; the checkbox
 * saves straight through. Saving on every keystroke would be a request per
 * character, and worse, would briefly store a half-typed code — `EATON1` is a
 * live coupon for as long as it takes to type the `0`.
 *
 * The server clamps the percentage and minimum on write, so a nonsense number
 * still cannot reach the basket maths.
 */
function CouponCard() {
  const { promo } = useCatalog();
  const { run, busy, error } = useAdminAction();

  // Keyed by the stored value, so a save (or another manager's edit arriving
  // on the next load) replaces the draft rather than fighting it.
  const [draft, setDraft] = useState(promo);
  const [editingKey, setEditingKey] = useState(null);

  if (draft !== promo && editingKey === null) setDraft(promo);

  function field(key) {
    return {
      value: draft[key] ?? '',
      disabled: !promo.isOn || busy,
      onFocus: () => setEditingKey(key),
      onChange: (event) => setDraft({ ...draft, [key]: event.target.value }),
      onBlur: async () => {
        setEditingKey(null);
        if (draft[key] === promo[key]) return;
        await run(() => savePromo({ [key]: draft[key] }));
      },
    };
  }

  return (
    <section className="card mt-3 p-4">
      <h2 className="text-xl text-ink-950">Coupon</h2>
      <p className="mt-1 text-sm text-ink-500">
        The offer strip across the top of the shop, and the code the basket accepts.
      </p>

      <label className="mt-4 flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={promo.isOn}
          disabled={busy}
          onChange={(event) => run(() => savePromo({ isOn: event.target.checked }))}
          className="h-4 w-4 accent-brand-500"
        />
        <span className="text-sm text-ink-800">Offer is running</span>
      </label>

      {error && (
        <p className="mt-3 rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">{error}</p>
      )}

      <div className={`mt-4 grid gap-4 sm:grid-cols-2 ${promo.isOn ? '' : 'opacity-50'}`}>
        <Labelled label="Code" hint="Customers type this at checkout. Stored upper-case.">
          <input type="text" {...field('code')} className="field font-mono uppercase" />
        </Labelled>

        <Labelled label="Headline" hint="The bold text in the strip.">
          <input type="text" {...field('title')} className="field" />
        </Labelled>

        <Labelled label="Message" hint="The lighter line beside it. Hidden on small screens.">
          <input type="text" {...field('message')} className="field" />
        </Labelled>

        <Labelled label="Button text" hint="Links through to the menu.">
          <input type="text" {...field('buttonText')} className="field" />
        </Labelled>

        <Labelled label="Discount" hint="Percentage off the basket subtotal.">
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              {...field('percentage')}
              className="field w-24 tabular-nums"
            />
            <span className="text-sm text-ink-500">% off</span>
          </span>
        </Labelled>

        <Labelled label="Minimum spend" hint="Below this the code is refused, with the shortfall shown.">
          <span className="flex items-center gap-2">
            <span className="text-sm text-ink-500">£</span>
            <input
              type="number"
              min={0}
              step="0.01"
              {...field('minimumSpend')}
              className="field w-28 tabular-nums"
            />
          </span>
        </Labelled>
      </div>

      <p className="mt-4 rounded-xl bg-surface-0 px-4 py-3 text-xs text-ink-500">
        Live now:{' '}
        {promo.isOn ? (
          <>
            <strong className="text-ink-800">{promo.code || '(no code)'}</strong> gives{' '}
            <strong className="text-ink-800">{promo.percentage}%</strong> off baskets over{' '}
            <strong className="text-ink-800">{formatPence(toPence(promo.minimumSpend))}</strong>.
          </>
        ) : (
          'the offer strip is hidden and the basket refuses every code.'
        )}
      </p>
    </section>
  );
}

function Labelled({ label, hint, children }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold text-ink-800">{label}</span>
      {children}
      <span className="text-xs text-ink-500/80">{hint}</span>
    </label>
  );
}

const LINK_HINTS = [
  { value: '#menu', label: 'Jump to the menu' },
  { value: '#category-cheesy-rascal', label: 'Jump to a category' },
  { value: '/track', label: 'Track order page' },
  { value: 'tel:+441615550142', label: 'Call the shop' },
];

export default function AdminBanners() {
  const { allBanners, bannerSettings } = useCatalog();
  const { run, busy, error } = useAdminAction();
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState(null);

  const liveCount = allBanners.filter(
    (slide) => slide.isPublished !== false && isBannerRenderable(slide),
  ).length;

  async function onDelete(slide) {
    setNotice(null);

    const { ok } = await run(() => deleteBanner(slide.id));
    if (!ok) return;

    // The slide is gone, so its photos are no longer referenced. Not awaited:
    // a file left on disk is untidy, not a failed deletion.
    if (slide.imageId) deleteImage(slide.imageId);
    if (slide.backgroundImageId) deleteImage(slide.backgroundImageId);

    setNotice(`Deleted “${slide.heading || 'Untitled slide'}”.`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl text-ink-950">Banners</h1>
        <span className="text-sm text-ink-500">
          {allBanners.length} slide{allBanners.length === 1 ? '' : 's'} · {liveCount} live
        </span>

        <button
          type="button"
          onClick={() =>
            setDraft({
              isNew: true,
              eyebrow: '',
              heading: '',
              headingAccent: '',
              description: '',
              imageId: null,
              priceNote: '',
              price: '',
              primaryLabel: 'Start your order',
              primaryHref: '#menu',
              secondaryLabel: '',
              secondaryHref: '',
              showStoreStatus: false,
              isPublished: true,
            })
          }
          className="btn-primary ml-auto px-4 py-2 text-xs"
        >
          + Slide
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">{error}</p>
      )}

      {notice && (
        <p className="mt-4 rounded-xl bg-surface-50 px-4 py-3 text-sm text-ink-500">{notice}</p>
      )}

      {liveCount === 0 && (
        <p className="mt-4 rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">
          No live slides — the homepage will show no hero at all. Publish at least one.
        </p>
      )}

      <section className="card mt-5 flex flex-wrap items-center gap-4 p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={bannerSettings.isAutoplayOn}
            disabled={busy}
            onChange={(event) => run(() => saveBannerSettings({ isAutoplayOn: event.target.checked }))}
            className="h-4 w-4 accent-brand-500"
          />
          <span className="text-sm text-ink-800">Rotate automatically</span>
        </label>

        <label className="flex items-center gap-2">
          <span className="text-sm text-ink-500">Every</span>
          {/* Saved on blur rather than per keystroke — typing "12" would
              otherwise store a 1-second carousel on the way past. */}
          <input
            type="number"
            min={AUTOPLAY_MIN_SECONDS}
            max={AUTOPLAY_MAX_SECONDS}
            defaultValue={bannerSettings.autoplaySeconds}
            key={bannerSettings.autoplaySeconds}
            disabled={!bannerSettings.isAutoplayOn || busy}
            onBlur={(event) => run(() => saveBannerSettings({ autoplaySeconds: event.target.value }))}
            className="field w-20 tabular-nums disabled:opacity-40"
            aria-label="Seconds between slides"
          />
          <span className="text-sm text-ink-500">seconds</span>
        </label>

        <p className="text-xs text-ink-500/80">
          Rotation pauses on hover, on keyboard focus, and for visitors who ask for reduced motion.
        </p>
      </section>

      <CouponCard />

      <section className="card mt-3 p-4">
        <h2 className="text-xl text-ink-950">Embers</h2>
        <p className="mt-1 text-sm text-ink-500">
          Embers drifting up behind the page.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <EffectControl
            label="Drifting embers"
            hint="Sits behind the whole page, including the menu — keep it low."
            enabled={bannerSettings.areEmbersOn}
            busy={busy}
            onToggle={(areEmbersOn) => run(() => saveBannerSettings({ areEmbersOn }))}
            intensity={bannerSettings.emberIntensity}
            onIntensity={(emberIntensity) => run(() => saveBannerSettings({ emberIntensity }))}
          />
        </div>

        <p className="mt-4 rounded-xl bg-surface-0 px-4 py-3 text-xs text-ink-500">
          The embers switch off entirely for visitors who ask for reduced motion.
        </p>
      </section>

      {allBanners.length === 0 ? (
        <div className="card mt-4 grid place-items-center py-16 text-center">
          <span className="text-4xl" aria-hidden="true">🖼️</span>
          <p className="mt-3 font-semibold text-ink-800">No slides yet</p>
          <p className="mt-1 max-w-sm text-sm text-ink-500">
            Add one to put a headline, a photo and a button at the top of the homepage.
          </p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3">
          {allBanners.map((slide, index) => {
            const hidden = slide.isPublished === false;
            const broken = !isBannerRenderable(slide);

            return (
              <li
                key={slide.id}
                className={`card flex flex-wrap items-center gap-4 p-4 ${
                  hidden ? 'opacity-60' : ''
                }`}
              >
                <span className="flex flex-col gap-1">
                  <OrderButton
                    label="Move up"
                    disabled={index === 0 || busy}
                    onClick={() => run(() => moveBanner(slide.id, -1))}
                  >
                    ▲
                  </OrderButton>
                  <OrderButton
                    label="Move down"
                    disabled={index === allBanners.length - 1 || busy}
                    onClick={() => run(() => moveBanner(slide.id, 1))}
                  >
                    ▼
                  </OrderButton>
                </span>

                <Thumb
                  imageId={slide.imageId}
                  emoji="🖼️"
                  className="h-16 w-24 shrink-0"
                  rounded="rounded-lg"
                  emojiClass="text-xl"
                />

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-950">
                      {slide.heading || <em className="text-ink-500">Untitled slide</em>}{' '}
                      <span className="text-brand-600">{slide.headingAccent}</span>
                    </span>
                    {hidden && <span className="chip bg-surface-0 text-ink-500">Hidden</span>}
                    {broken && (
                      <span className="chip bg-chilli-500/15 text-chilli-500">Needs a heading</span>
                    )}
                    {slide.showStoreStatus && (
                      <span className="chip bg-surface-0 text-ink-500">Shows open/closed</span>
                    )}
                  </span>

                  {slide.description && (
                    <span className="mt-0.5 block truncate text-xs text-ink-500">
                      {slide.description}
                    </span>
                  )}

                  <span className="mt-1 flex flex-wrap gap-2 text-xs text-ink-500/80">
                    {hasLink(slide.primaryLabel, slide.primaryHref) && (
                      <span>▸ {slide.primaryLabel} → {slide.primaryHref}</span>
                    )}
                    {hasLink(slide.secondaryLabel, slide.secondaryHref) && (
                      <span>▸ {slide.secondaryLabel} → {slide.secondaryHref}</span>
                    )}
                  </span>
                </span>

                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => run(() => setBannerPublished(slide.id, hidden))}
                    disabled={busy}
                    className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    {hidden ? 'Show' : 'Hide'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...slide, isNew: false })}
                    className="btn-ghost px-3 py-1.5 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(slide)}
                    disabled={busy}
                    className="btn-ghost px-3 py-1.5 text-xs hover:text-chilli-500 disabled:opacity-40"
                  >
                    Delete
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <BannerEditor
        draft={draft}
        existingIds={allBanners.map((slide) => slide.id)}
        onClose={() => setDraft(null)}
        onSaved={(heading) => setNotice(`Saved “${heading}”.`)}
      />
    </div>
  );
}

function EffectControl({ label, hint, enabled, busy, onToggle, intensity, onIntensity }) {
  return (
    <div className="rounded-xl border border-surface-300 p-3">
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(event) => onToggle(event.target.checked)}
          className="h-4 w-4 accent-brand-500"
        />
        <span className="text-sm font-medium text-ink-800">{label}</span>
      </label>

      <p className="mt-1 text-xs text-ink-500/80">{hint}</p>

      <IntensitySlider
        label={label}
        enabled={enabled}
        busy={busy}
        intensity={intensity}
        onCommit={onIntensity}
      />
    </div>
  );
}

/**
 * The slider tracks the drag locally and saves once the shop lets go.
 *
 * A range input fires on every step, so saving from `onChange` would be a
 * request per pixel dragged — twenty writes to cross the track.
 */
function IntensitySlider({ label, enabled, busy, intensity, onCommit }) {
  const [dragging, setDragging] = useState(null);
  const shown = dragging ?? intensity;

  function commit(event) {
    setDragging(null);
    if (Number(event.target.value) !== Number(intensity)) onCommit(event.target.value);
  }

  return (
    <label className="mt-3 flex items-center gap-3">
      <span className="text-xs text-ink-500">Strength</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={shown}
        disabled={!enabled || busy}
        onChange={(event) => setDragging(event.target.value)}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="flex-1 accent-brand-500 disabled:opacity-40"
        aria-label={`${label} strength`}
      />
      <span className="w-9 text-right text-xs tabular-nums text-ink-800">
        {Math.round(shown * 100)}%
      </span>
    </label>
  );
}

function OrderButton({ label, disabled, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-5 w-6 place-items-center rounded text-[0.6rem] text-ink-500
                 hover:bg-surface-100 hover:text-ink-800 disabled:opacity-25"
    >
      {children}
    </button>
  );
}

function BannerEditor({ draft, existingIds, onClose, onSaved }) {
  const { run, busy } = useAdminAction();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  if (draft && (!form || form.__key !== (draft.id ?? 'new'))) {
    setForm({
      __key: draft.id ?? 'new',
      eyebrow: draft.eyebrow ?? '',
      heading: draft.heading ?? '',
      headingAccent: draft.headingAccent ?? '',
      description: draft.description ?? '',
      imageId: draft.imageId ?? null,
      backgroundImageId: draft.backgroundImageId ?? null,
      priceNote: draft.priceNote ?? '',
      price: draft.price ?? '',
      primaryLabel: draft.primaryLabel ?? '',
      primaryHref: draft.primaryHref ?? '',
      secondaryLabel: draft.secondaryLabel ?? '',
      secondaryHref: draft.secondaryHref ?? '',
      showStoreStatus: Boolean(draft.showStoreStatus),
      isPublished: draft.isPublished !== false,
    });
    setError(null);
  }

  if (!draft || !form) return null;

  function close() {
    setForm(null);
    setError(null);
    onClose();
  }

  function set(patch) {
    setForm({ ...form, ...patch });
    setError(null);
  }

  async function onSubmit(event) {
    event.preventDefault();

    if (!form.heading.trim() && !form.headingAccent.trim()) {
      setError('A slide needs a heading, or it renders as an empty hero.');
      return;
    }
    // A label with no destination is a dead button; a destination with no
    // label is invisible. Both are worth catching here.
    if (form.primaryLabel.trim() && !form.primaryHref.trim()) {
      setError('The main button has a label but no link.');
      return;
    }
    if (form.secondaryLabel.trim() && !form.secondaryHref.trim()) {
      setError('The second button has a label but no link.');
      return;
    }

    const id = draft.isNew
      ? slugify(form.heading || form.headingAccent || 'slide', existingIds, 'slide')
      : draft.id;

    const { ok, error: failure } = await run(() =>
      saveBanner({
        id,
        eyebrow: form.eyebrow.trim(),
        heading: form.heading.trim(),
        headingAccent: form.headingAccent.trim(),
        description: form.description.trim(),
        imageId: form.imageId,
        backgroundImageId: form.backgroundImageId,
        priceNote: form.priceNote.trim(),
        price: form.price.trim(),
        primaryLabel: form.primaryLabel.trim(),
        primaryHref: form.primaryHref.trim(),
        secondaryLabel: form.secondaryLabel.trim(),
        secondaryHref: form.secondaryHref.trim(),
        showStoreStatus: form.showStoreStatus,
        isPublished: form.isPublished,
        ...(draft.isNew ? {} : { displayOrder: draft.displayOrder }),
      }),
    );

    if (!ok) {
      setError(failure?.message ?? 'That slide could not be saved.');
      return;
    }

    onSaved?.(form.heading || form.headingAccent);
    close();
  }

  return (
    <Modal open onClose={close} title={draft.isNew ? 'New slide' : 'Edit slide'} size="lg">
      <form onSubmit={onSubmit} className="grid gap-4">
        <Preview form={form} />

        <label className="block">
          <span className="mb-1 block text-sm text-ink-500">
            Eyebrow <span className="text-ink-500/70">— the small pill above the heading</span>
          </span>
          <input
            className="field"
            value={form.eyebrow}
            onChange={(event) => set({ eyebrow: event.target.value })}
            placeholder="Good Food Good Mood"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-ink-500">Heading</span>
            <input
              className="field"
              value={form.heading}
              onChange={(event) => set({ heading: event.target.value })}
              placeholder="Made to order."
              autoFocus
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink-500">
              Second line <span className="text-ink-500/70">— shown in orange</span>
            </span>
            <input
              className="field"
              value={form.headingAccent}
              onChange={(event) => set({ headingAccent: event.target.value })}
              placeholder="Never sat waiting."
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm text-ink-500">Description</span>
          <textarea
            className="field resize-none"
            rows={3}
            value={form.description}
            onChange={(event) => set({ description: event.target.value })}
            placeholder="One or two sentences about what makes this worth ordering."
          />
        </label>

        <ImageField
          value={form.imageId}
          onChange={(imageId) => set({ imageId })}
          emoji="🖼️"
          label="Slide image"
        />
        <p className="-mt-2 text-xs text-ink-500/80">
          Sits on an orange brush stroke in the banner, so a cut-out PNG with a transparent
          background looks best. Without an image the slide shows your category photos instead.
        </p>

        <fieldset className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-800">
            Offer price
          </legend>

          <Labelled label="Label" hint="Small caps above the price.">
            <input
              type="text"
              value={form.priceNote}
              onChange={(event) => set({ priceNote: event.target.value })}
              placeholder="Only"
              className="field"
            />
          </Labelled>

          <Labelled label="Price" hint="Shown big in brand orange. Leave both blank to hide.">
            <input
              type="text"
              value={form.price}
              onChange={(event) => set({ price: event.target.value })}
              placeholder="£6.99"
              className="field"
            />
          </Labelled>
        </fieldset>

        <ImageField
          value={form.backgroundImageId}
          onChange={(backgroundImageId) => set({ backgroundImageId })}
          emoji="🌄"
          label="Background image"
        />
        <p className="-mt-2 text-xs text-ink-500/80">
          Fills the whole banner behind the text. Use a wide, uncluttered shot — the headline
          sits over the left of it, and a white fade keeps that side readable whatever you pick.
        </p>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-800">
            Buttons
          </legend>

          <div className="grid gap-2">
            <ButtonRow
              label="Main button"
              text={form.primaryLabel}
              href={form.primaryHref}
              onText={(value) => set({ primaryLabel: value })}
              onHref={(value) => set({ primaryHref: value })}
              placeholderText="Start your order"
            />
            <ButtonRow
              label="Second button"
              text={form.secondaryLabel}
              href={form.secondaryHref}
              onText={(value) => set({ secondaryLabel: value })}
              onHref={(value) => set({ secondaryHref: value })}
              placeholderText="Call us"
            />
          </div>

          <p className="mt-2 text-xs text-ink-500/80">
            Leave both boxes empty to hide a button. Links:{' '}
            {LINK_HINTS.map((hint, index) => (
              <span key={hint.value}>
                {index > 0 && ' · '}
                <code className="text-brand-600">{hint.value}</code> ({hint.label})
              </span>
            ))}
          </p>
        </fieldset>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-surface-300 px-3 py-2.5">
            <input
              type="checkbox"
              checked={form.showStoreStatus}
              onChange={(event) => set({ showStoreStatus: event.target.checked })}
              className="h-4 w-4 accent-brand-500"
            />
            <span className="text-sm text-ink-800">Show the open/closed line</span>
          </label>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-surface-300 px-3 py-2.5">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(event) => set({ isPublished: event.target.checked })}
              className="h-4 w-4 accent-brand-500"
            />
            <span className="text-sm text-ink-800">Live on the homepage</span>
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
            {busy ? 'Saving…' : draft.isNew ? 'Add slide' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Miniature of the real hero, so the shop can see the copy in place. */
function Preview({ form }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-surface-300 bg-surface-100">
      <div className="grid gap-4 p-5 sm:grid-cols-[1.4fr_1fr] sm:items-center">
        <div>
          {form.eyebrow && (
            <span className="chip inline-block bg-surface-50 text-brand-600">{form.eyebrow}</span>
          )}
          <p className="mt-2 font-display text-2xl leading-tight tracking-wide text-ink-950">
            {form.heading || <span className="text-ink-500/60">Heading</span>}
            {form.headingAccent && (
              <>
                <br />
                <span className="text-brand-600">{form.headingAccent}</span>
              </>
            )}
          </p>
          {form.description && (
            <p className="mt-2 line-clamp-2 text-xs text-ink-500">{form.description}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {hasLink(form.primaryLabel, form.primaryHref) && (
              <span className="rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">
                {form.primaryLabel}
              </span>
            )}
            {hasLink(form.secondaryLabel, form.secondaryHref) && (
              <span className="rounded-full border border-surface-300 px-3 py-1.5 text-xs text-ink-800">
                {form.secondaryLabel}
              </span>
            )}
          </div>
        </div>

        <Thumb
          imageId={form.imageId}
          emoji="🖼️"
          className="aspect-[4/3] w-full border border-surface-200"
          rounded="rounded-xl"
          emojiClass="text-2xl"
        />
      </div>
    </div>
  );
}

function ButtonRow({ label, text, href, onText, onHref, placeholderText }) {
  const dead = text.trim() && !href.trim();
  const invisible = !text.trim() && href.trim();

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input
          className="field flex-1"
          value={text}
          onChange={(event) => onText(event.target.value)}
          placeholder={placeholderText}
          aria-label={`${label} text`}
        />
        <input
          className="field flex-1"
          value={href}
          onChange={(event) => onHref(event.target.value)}
          placeholder="#menu"
          aria-label={`${label} link`}
        />
      </div>

      {(dead || invisible) && (
        <p className="mt-1 text-xs text-chilli-500">
          {dead ? 'This button has no link, so it will not show.' : 'This link has no text, so it will not show.'}
        </p>
      )}
      {!dead && !invisible && href.trim() && !isBrowserHref(href) && (
        <p className="mt-1 text-xs text-ink-500/80">
          Treated as an in-app page. Use <code className="text-brand-600">#menu</code> to scroll
          instead.
        </p>
      )}
    </div>
  );
}
