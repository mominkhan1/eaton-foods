import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Thumb, { useImageUrl } from './Thumb';
import { BurgerIcon } from './Icons';
import { BrushPatch, Splash, DashedArrow } from './HeroDecor';
import { useCatalog } from '../context/CatalogContext';
import { useOrder } from '../context/OrderContext';
import { formatTime } from '../lib/hours';
import { isBrowserHref, isExternalHref, hasLink } from '../lib/links';

/**
 * Homepage hero slider.
 *
 * Content comes from the repository, so the shop edits every slide from the
 * admin panel. Autoplay pauses on hover, on keyboard focus, and while the tab
 * is hidden — an unattended carousel that keeps moving under someone's cursor
 * is the classic way these become unusable.
 */
export default function HeroSlider() {
  const { banners, bannerSettings, categories } = useCatalog();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const regionRef = useRef(null);

  const count = banners.length;
  // A single slide is a hero, not a carousel: no controls, no timer.
  const isCarousel = count > 1;

  const go = useCallback(
    (next) => setIndex(((next % count) + count) % count),
    [count],
  );

  // Keep the index valid if the shop deletes or unpublishes the active slide.
  const safeIndex = count > 0 ? Math.min(index, count - 1) : 0;
  const slide = banners[safeIndex];

  useEffect(() => {
    if (!isCarousel || paused || !bannerSettings.isAutoplayOn) return undefined;

    // Someone who asked for less motion should not get an auto-advancing hero.
    const reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return undefined;

    const id = setInterval(
      () => setIndex((current) => (current + 1) % count),
      Math.max(3, bannerSettings.autoplaySeconds) * 1000,
    );
    return () => clearInterval(id);
  }, [isCarousel, paused, bannerSettings.isAutoplayOn, bannerSettings.autoplaySeconds, count]);

  // A background tab should not race through every slide.
  useEffect(() => {
    function onVisibility() {
      setPaused(document.hidden);
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  function onKeyDown(event) {
    if (!isCarousel) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(safeIndex - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(safeIndex + 1);
    }
  }

  if (!slide) return null;

  return (
    <section
      ref={regionRef}
      // Cream ground rather than the page white — it is what separates the
      // banner from the menu below it now that the fire wash is gone.
      className="relative overflow-hidden border-b border-surface-200 bg-surface-50"
      aria-roledescription={isCarousel ? 'carousel' : undefined}
      aria-label={isCarousel ? 'Offers and highlights' : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={onKeyDown}
    >
      <SlideBackdrop slide={slide} />

      <div
        // Remounting on the slide id restarts the fade-in for each slide.
        key={slide.id}
        // Uneven columns: the food is the thing that sells the banner, so the
        // visual side gets the larger share rather than a straight half.
        className="animate-hero-in relative mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:py-20 md:grid-cols-[1fr_1.45fr] md:items-center"
        aria-roledescription={isCarousel ? 'slide' : undefined}
        aria-label={isCarousel ? `${safeIndex + 1} of ${count}` : undefined}
      >
        <div className="relative z-10">
          {slide.eyebrow && (
            // Amber, not surface-50 — that is the hero's own ground now, so the
            // chip had no edge against it at all.
            <span className="chip inline-block bg-amber-100 text-brand-700">{slide.eyebrow}</span>
          )}

          {/*
            The headline is the whole point of the banner, so it runs as large
            as the grid allows. `leading-[0.82]` closes the gap Bebas Neue
            leaves between stacked lines at display sizes.
          */}
          <h1 className="mt-3 text-5xl leading-[0.84] text-ink-950 sm:text-6xl lg:text-7xl">
            {slide.heading}
            {slide.headingAccent && (
              <>
                <br />
                {/*
                  Brush script, tilted, and deliberately *smaller* than the
                  display line. Accents here are whole phrases rather than the
                  single word the reference uses, so at full size they wrap and
                  swamp the headline they are supposed to decorate.
                */}
                <span className="mt-2 inline-block font-script text-[0.62em] normal-case leading-[1.1] tracking-normal text-brand-500 -rotate-2">
                  {slide.headingAccent}
                </span>
              </>
            )}
          </h1>

          {slide.description && (
            <p className="mt-5 max-w-md text-ink-500">{slide.description}</p>
          )}

          {(slide.priceNote || slide.price) && (
            <div className="mt-6 flex items-end gap-3">
              {slide.priceNote && (
                <span className="pb-1.5 text-sm font-semibold uppercase tracking-[0.18em] text-ink-500">
                  {slide.priceNote}
                </span>
              )}
              {slide.price && (
                <span className="font-display text-5xl leading-none tracking-wide text-brand-500 sm:text-6xl">
                  {slide.price}
                </span>
              )}
            </div>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <HeroButton
              label={slide.primaryLabel}
              href={slide.primaryHref}
              className="btn-primary px-7 py-3.5 text-base"
            />
            <HeroButton
              label={slide.secondaryLabel}
              href={slide.secondaryHref}
              className="btn-secondary px-6 py-3.5"
            />
          </div>

          {slide.showStoreStatus && <StoreStatusLine />}
        </div>

        {/* Points from the headline across to the food. Hidden below `md`,
            where the two stack and it would point at nothing. */}
        {slide.imageId && (
          <DashedArrow className="pointer-events-none absolute left-1/2 top-10 z-20 hidden w-28 -translate-x-32 md:block lg:top-14 lg:w-32" />
        )}

        <HeroVisual slide={slide} categories={categories} />
      </div>

      {isCarousel && (
        <div className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 pb-6">
          <ArrowButton label="Previous slide" onClick={() => go(safeIndex - 1)}>
            ‹
          </ArrowButton>
          <ArrowButton label="Next slide" onClick={() => go(safeIndex + 1)}>
            ›
          </ArrowButton>

          <div className="flex gap-2" role="tablist" aria-label="Choose a slide">
            {banners.map((candidate, position) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={position === safeIndex}
                aria-label={candidate.heading || `Slide ${position + 1}`}
                onClick={() => go(position)}
                className={`h-2 rounded-full transition-all ${
                  position === safeIndex
                    ? 'w-8 bg-brand-500'
                    : 'w-2 bg-surface-200 hover:bg-ink-400'
                }`}
              />
            ))}
          </div>

          <span className="ml-auto text-xs tabular-nums text-ink-500/80">
            {safeIndex + 1} / {count}
          </span>
        </div>
      )}
    </section>
  );
}

/**
 * What sits behind a slide.
 *
 * With a background photo: the photo, plus a scrim that is opaque under the
 * text column and clears by the right-hand side. Hero text over an unknown
 * uploaded photo is the classic way a banner becomes unreadable — the shop
 * picks the picture, so the contrast floor has to be built in rather than
 * left to whichever image they choose.
 *
 * Without one: the warm radial wash the hero has always had.
 */
function SlideBackdrop({ slide }) {
  const url = useImageUrl(slide.backgroundImageId);

  if (!url) {
    return (
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          background:
            'radial-gradient(60rem 30rem at 80% -10%, var(--color-brand-500), transparent 60%)',
        }}
        aria-hidden="true"
      />
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <img
        src={url}
        alt=""
        decoding="async"
        className="h-full w-full object-cover"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(100deg, rgb(255 255 255 / 97%) 0%, rgb(255 255 255 / 92%) 30%,' +
            ' rgb(255 255 255 / 55%) 62%, rgb(255 255 255 / 20%) 100%)',
        }}
      />
    </div>
  );
}

/** The live open/closed line — app state, never editable content. */
function StoreStatusLine() {
  const { storeOpen, opensAt, quote, orderType } = useOrder();

  return (
    <p className="mt-5 text-sm text-ink-500">
      {storeOpen ? (
        <>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-leaf-500" />
          Open now · {orderType === 'delivery' ? 'delivering' : 'ready'} in ~{quote.minutes} mins
        </>
      ) : (
        <>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-chilli-500" />
          Closed · reopens {opensAt ? formatTime(opensAt) : 'soon'} — order ahead now
        </>
      )}
    </p>
  );
}

/**
 * The product shot on the paint patch.
 *
 * Deliberately not `Thumb`: that fills its box with `object-cover` on an
 * opaque tile, which is right for a menu card and wrong here — it would crop a
 * cut-out to a rectangle and paint a white square over the brush stroke behind
 * it. `object-contain` on a transparent ground keeps a PNG cut-out intact, and
 * still shows an ordinary photo whole.
 */
function HeroCutout({ imageId, alt }) {
  const url = useImageUrl(imageId);

  if (!url) {
    return (
      <span
        className="relative z-10 grid aspect-[6/5] w-full place-items-center text-8xl"
        aria-hidden="true"
      >
        <BurgerIcon className="h-24 w-24 text-brand-500/30" />
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      decoding="async"
      className="relative z-10 aspect-[6/5] w-full object-contain drop-shadow-2xl"
    />
  );
}

/**
 * A slide's own photo when it has one; otherwise the category tiles, so the
 * hero still looks composed before any images are uploaded.
 */
function HeroVisual({ slide, categories }) {
  if (slide.imageId) {
    return (
      // No max-width, and it bleeds toward the section edge on wide screens —
      // the section clips the overflow, which is the intended effect.
      // A little past the container edge, but not so far the section's
      // overflow-hidden starts slicing the food off.
      <div className="relative mx-auto w-full md:-mr-4 lg:-mr-8">
        {/* Paint patch, rotated and run wider than the food it sits under, so
            it reads as a stroke laid down behind rather than a frame around. */}
        <BrushPatch className="absolute inset-0 h-full w-full scale-[1.22] -rotate-3" />

        <Splash className="absolute -top-4 left-0 z-20 w-20 sm:-top-7 sm:w-28" flip />
        <Splash className="absolute -bottom-2 right-2 z-20 w-16 sm:w-24" />

        {/* Only a small inset now, so the food runs as large as the patch
            allows while the stroke still shows on every side. */}
        <div className="relative mx-auto w-[96%]">
          <HeroCutout imageId={slide.imageId} alt={slide.heading ?? ''} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      {categories.slice(0, 6).map((category, position) => (
        <Thumb
          key={category.id}
          imageId={category.imageId}
          emoji={category.emoji}
          className={`aspect-square w-full border border-surface-200 ${
            position % 2 === 0 ? 'translate-y-3' : ''
          }`}
          rounded="rounded-3xl"
          emojiClass="text-4xl sm:text-5xl"
        />
      ))}
    </div>
  );
}

/** Router link for in-app routes; plain anchor for #, tel:, mailto: and http. */
function HeroButton({ label, href, className }) {
  if (!hasLink(label, href)) return null;

  const target = href.trim();

  if (isBrowserHref(target)) {
    const external = isExternalHref(target);
    return (
      <a
        href={target}
        className={className}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {label}
      </a>
    );
  }

  return (
    <Link to={target} className={className}>
      {label}
    </Link>
  );
}

function ArrowButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-full border border-surface-300 text-xl
                 leading-none text-ink-500 transition-colors hover:border-brand-500
                 hover:text-ink-800"
    >
      {children}
    </button>
  );
}
