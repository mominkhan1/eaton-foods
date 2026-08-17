# Eat On — Welwyn Garden City

Online ordering for **Eat On** (The Food Table Ltd), The Howard Centre,
Howardsgate, Welwyn Garden City AL8 6HA. Halal.
React + Vite + Tailwind v4, with a PHP/MySQL backend.

The menu in [src/data/menu.js](src/data/menu.js) is transcribed from the
printed board: 7 categories, 18 items, 6 option groups. Run `npm run menu` to
print it and check it against the board.

The ordering flow deliberately mirrors the Next Order platform used by
`morleys-fried-chicken-hatfield.nextorder.com`; the visual design does not.

```bash
npm install
npm run dev      # shop: http://localhost:5173   admin: /admin  (passcode 1234)
npm run build
npm run lint     # catches undefined refs and React-hook mistakes
npm test         # logic smoke test, 85 assertions
npm run menu     # print the seeded menu to check against the board
```

**Run `npm run lint`.** A production build compiles a call to a name that no
longer exists — the result is a `ReferenceError` at runtime and a blank screen,
with nothing failing at build time. That has already happened once here. The
linter's `no-undef` catches it; the `react-hooks` rules catch the state-in-effect
patterns that make modals reset unpredictably.

## The flow

1. **Order-type gate** — collection or delivery, shown before the menu is usable.
   Delivery requires a postcode that clears the area check.
2. **Service bar** — persistent strip to switch order type, edit the address and
   pick ASAP vs a scheduled slot. Switching order type re-runs every
   availability rule downstream.
3. **Menu** — the full menu sits on the landing page, not behind a click.
   [MenuBrowser](src/components/MenuBrowser.jsx) renders the sticky category
   rail, search, and every published item grouped by category; `/` and `/menu`
   both use it, so they cannot drift apart.
4. **Item modal** — size first (the size carries the price), then modifier
   groups, quantity and free-text notes. It is mounted with
   `key={item.id}`, so opening a different item remounts it and the state
   initialisers do the resetting — no reset effect to get wrong.
5. **Basket drawer** — line editing, promo code, free-delivery progress,
   minimum-order enforcement, collection-only conflict detection.
6. **Checkout** — customer details, address/timing recap, and payment.
7. **Thank you** — `/thank-you/:reference`, reached once, straight from
   checkout. The reference sits on a tear-off docket, with when it will be
   ready, what happens next, and where it is going.
8. **Payment** — PayPal, plus **Google Pay and Apple Pay** where the shop has
   turned them on. All three are the same PayPal order underneath: the amount
   is attached server-side from the stored total, and the captured figure is
   checked against it before anything is marked paid. Customers without a
   PayPal account pay by card on PayPal's own page, so no card details reach
   this site. **The kitchen is only told about an order once the payment
   clears** — otherwise every abandoned checkout would put a ticket on the
   pass. Setup and go-live: [server/DEPLOYMENT.md](server/DEPLOYMENT.md) §8;
   the two wallets are §8.6 and ship switched off.

   The wallets differ from the PayPal button in one way worth knowing: the
   PayPal order is created **pinned** to the PayPal wallet
   (`payment_source.paypal`), which is what produces the no-popup PAY_NOW
   flow — and a pinned order cannot then accept a Google Pay or Apple Pay
   token. So those two create the order plain and let the wallet attach its own
   source at confirm time. The payment source is therefore part of the
   idempotency key, or backing out of one button and tapping another hands you
   back the first one's order.
9. **Tracking** — `/order/:reference`, the durable link. It is what the
   confirmation email points at and what **Track order** resolves to, so
   opening it days later gives the status rather than the celebration. The
   timeline advances when the kitchen advances it, not on a clock.

## Admin panel — `/admin`

| Screen | What it does |
|---|---|
| **Orders** | Live queue, expand for items/customer/address, advance status, cancel. New orders chime, flash the tab title and fire a desktop notification. |
| **Menu** | Two tabs. *Categories & items*: add/edit/delete categories and food items, including sizes and prices; hide an item without deleting it. *Option groups*: build the choice blocks themselves — name, min/max picks, and priced options. |
| **Banners** | The homepage hero is a slider the shop owns: eyebrow, heading, orange second line, description, photo, two buttons, and rotation speed. Reorder, hide, delete, with a live miniature preview while editing. |
| **Hours** | Weekly schedule editor, holiday closures, and a manual **Auto / Open / Closed** override that beats the schedule. |
| **Reports** | Revenue on **daily / weekly / monthly** filters — KPI tiles, a column chart, a full breakdown table and best sellers. |

Edits are live: change the menu or flip the shop closed and the storefront
picks it up on its next load, on every device.

### Where the data lives

Everything mutable — the menu, option groups, trading hours, hero slides, the
coupon, photos and orders — is stored in **MySQL** and read and written through
the PHP API in [server/api/](server/api/). Nothing that a customer needs to see
is kept in the browser.

[src/lib/repository.js](src/lib/repository.js) is the only module that talks to
the catalog endpoints. It holds the API's response in memory and hands it out
synchronously, because the whole render tree asks for the menu during render;
writes are async and re-read what the server actually stored. Orders do not go
through it at all — they are fetched per screen, since the kitchen list and a
customer's own order have nothing in common but the shape.

Two things are still browser-local on purpose, and neither is a source of
truth: the basket, and the list of order references *this* browser has placed
(the "recent orders" convenience on the tracking page — there is no customer
login, and an endpoint that listed orders by phone number would be a way to
read somebody else's).

### Option groups

A group is the "Choose your side" / "Add extras" block on an item. The shop
builds them on **Menu → Option groups** and attaches them from the item editor.

Each group carries a **min** and a **max**, which together express every rule
the storefront enforces — `1/1` is a straight either/or like spice level, `0/5`
is optional extras, `2/4` is "pick two to four sides". A single helper,
`describeGroupRule()` in [src/data/menu.js](src/data/menu.js), turns those
numbers into the sentence shown to *both* the shop and the customer, so a rule
can never be described one way in the admin and another on the item.

Two guards worth knowing about:

- A group whose `min` exceeds its option count can never be satisfied and would
  block **Add to basket** forever. The editor refuses to save it.
- Deleting a group that items still reference is refused, and names the items.
  Confirming detaches it from every one of them in the same write, so no item is
  left pointing at a group that no longer exists. (A dangling reference degrades
  quietly anyway — `resolveModifierGroups` drops it rather than rendering
  `undefined`.)

### The hero slider

[HeroSlider](src/components/HeroSlider.jsx) renders whatever slides the shop
has published, in their order. Details that matter:

- **Rotation pauses on hover, on keyboard focus, and while the tab is hidden.**
  A carousel that keeps moving under someone's cursor is the classic way these
  become unusable, and a background tab should not burn through every slide.
- **`prefers-reduced-motion` disables autoplay and the fade** outright.
- **One slide is a hero, not a carousel** — no arrows, dots or timer appear.
- **Buttons route themselves.** `#menu` scrolls, `/track` goes through the
  router, `tel:`/`mailto:`/`https:` are plain anchors (external ones get
  `rel="noopener noreferrer"`). See [src/lib/links.js](src/lib/links.js).
- A button renders only when it has **both** a label and a link; the editor
  warns about either half on its own rather than shipping a dead button.
- **The open/closed line is app state, not editable copy.** Slides opt into
  showing it with a checkbox; they can never contain a stale trading status.
- Autoplay seconds are clamped to 3–30 on the way into storage, so a typo
  cannot produce a 0-second carousel.

### Photos

Categories and items each take an uploaded photo, which then appears on the
storefront cards, category headers, the item modal, the basket, and the
kitchen's order list. Drag-and-drop or browse, on **Menu → Categories & items**.

**Where they're stored.** On the server, under `public/uploads/`, with a row in
the `images` table. The API returns each photo's public URL alongside its id
everywhere an id appears — in the catalog, in the banners, in the upload
response — so the browser never has to look one up or guess a filename.

**Every upload is downscaled in the browser before it is sent** — capped at
900px on the long edge and re-encoded to WebP (JPEG on older Safari). A phone
camera produces 4–8MB files; a menu card renders at roughly 200px, so sending
the original would be ~40× more bytes than anyone can see, over a shop's
uplink. The field reports the saved dimensions and size so the shop can see
what happened.

The server validates independently — it decides the type by inspecting the
bytes, never from the filename or the declared content type, and generates the
stored name itself. A `.jpg` that is really a `.php` is the classic way to get
code execution on shared hosting.

**Deleting a photo is refused while anything still points at it**, because the
foreign keys are `ON DELETE SET NULL` and a delete would otherwise succeed and
silently blank a menu card. Replacing one uploads first and only removes the
old file once the record points at the new one, so a failed upload never
destroys the existing picture.

**The emoji is the fallback, not a placeholder.** A shop will always have items
it hasn't photographed, and an empty grey box looks broken in a way an emoji
does not. Every item keeps its `emoji` field, and
[Thumb](src/components/Thumb.jsx) falls back to it when there is no photo, when
the photo is still loading, or when the blob has gone missing.

Three details that would otherwise bite:

- **A failed upload never destroys the existing photo** — the old blob is
  deleted only after the replacement has stored successfully.
- **Basket lines snapshot `imageId`** alongside the price, so deleting a photo
  mid-order degrades to the emoji rather than showing a broken image.
- **Orphaned blobs are swept up.** Deleting an item or category removes its
  photo, and the Menu screen prunes anything unreferenced whenever the catalog
  changes — which catches resets and tabs closed mid-edit.

### Alerting

Three channels, because a busy kitchen misses any one of them: a Web Audio
chime (no asset to fail), a flashing tab title, and a desktop notification.
Browsers block audio until the page is interacted with, so the chime is armed
by the first click anywhere in the panel.

### The revenue chart

Single series, so one hue and no legend — the heading names it. The bar colour
`#e2670f` was validated against the `#221a12` card surface (lightness band,
chroma floor, ≥3:1 contrast) rather than eyeballed. Buckets are cut in the
store's timezone, so a 1am order on a late-night shift lands on the day the
shop calls it. Cancelled orders are excluded from revenue but still counted, so
the cancellation rate stays visible. The same figures appear in a table below
the chart.

## Data model

The reference platform models a menu as **category → item → sizes[]**, where the
*size* carries the price. Two consequences worth preserving:

- **The meal upgrade is a size, not a modifier.** The board prices "MAKE IT A
  MEAL" at +£2.49, so `On its own £6.99` / `Make it a meal £9.48` is one priced
  selection rather than a base price plus an add-on. `mealSizes()` in
  [src/data/menu.js](src/data/menu.js) derives the second size from
  `MEAL_UPCHARGE`, and a test asserts every main carries exactly that gap — so
  a price change can't leave one item out of step.
- **Items can be restricted per order type.** `orderTypes: [ORDER_TYPE.PICKUP]`
  is how "collection only" works. The basket re-validates on every order-type
  switch — otherwise a customer adds an in-store slush, flips to delivery, and
  the order is unfulfillable. See `blockedLines` in
  [src/context/CartContext.jsx](src/context/CartContext.jsx).

## Where the rules live

| Concern | File |
|---|---|
| **Catalog, hours, banners, promo — the API-backed store** | [src/lib/repository.js](src/lib/repository.js) |
| The only module that talks to the API | [src/lib/api.js](src/lib/api.js) |
| Server: routing, catalog, orders, settings | [server/api/](server/api/) |
| Store details, fees, promo (static config) | [src/data/store.js](src/data/store.js) |
| Menu seed data + pure helpers | [src/data/menu.js](src/data/menu.js) |
| Live catalog + hours for the UI | [src/context/CatalogContext.jsx](src/context/CatalogContext.jsx) |
| Trading hours, override, ASAP quote, slots | [src/lib/hours.js](src/lib/hours.js) |
| Delivery geofence, postcodes | [src/lib/geo.js](src/lib/geo.js) |
| Totals, surcharges, promo | [src/lib/pricing.js](src/lib/pricing.js) |
| Order placement, status | [src/lib/orders.js](src/lib/orders.js) |
| Payment SDK loading, wallet eligibility | [src/lib/paypalSdk.js](src/lib/paypalSdk.js) |
| Report windows, weekly/monthly roll-up | [src/lib/reports.js](src/lib/reports.js) |
| Chime, tab flash, notifications | [src/lib/alerts.js](src/lib/alerts.js) |
| Photo upload, downscaling, URL lookup | [src/lib/images.js](src/lib/images.js) |
| Hero slides + rotation settings | [src/data/banners.js](src/data/banners.js) |
| Hero button link routing | [src/lib/links.js](src/lib/links.js) |

The catalog and hours are **seeded** from `src/data/*` on first run and then
owned by the repository, so admin edits survive a refresh. "Reset to seed"
buttons on the Menu and Hours screens undo everything.

### Trading hours

Late-night trading is expressed as **two shift rows per day** — a
12:00→23:59 shift plus a 00:00→01:00 (weeknight) or 00:00→02:00 (weekend)
shift. This is how the reference store does it, and it avoids wrap-around
arithmetic entirely.

All hours reasoning happens in `Europe/London` via `Intl`, not the browser's
timezone, so a customer ordering from abroad still sees the shop's real state.

### Delivery area

The reference store uses a **radius-only** geofence. A 5km circle around the
shop spills into districts that aren't worth driving to, so this checks the
**postcode district as well** and reports which of the two tests failed
(`invalid-postcode`, `outside-districts`, `outside-radius`).

### Money

Everything in the basket is held in **pence as integers** so repeated additions
never drift. Menu prices are written in pounds for readability and converted on
the way in.

Billing order is `subtotal → promo discount → delivery fee → surcharge → total`,
with the surcharge charged on the *discounted* subtotal.

## Open questions on the menu

Two things the printed board does not settle:

1. **BBQ Royale has no price on the board.** Seeded at £6.99 to match Holy
   Smash — confirm before going live.
2. **The meal drink is an optional group, not a required one.** "Make it a
   meal" is a *size*, and the configurator cannot yet show a group for one size
   only, so a required drink choice would also block people ordering the burger
   on its own. It is therefore `min 0` and labelled *"Meal drink — if you are
   making it a meal"*. The clean fix is per-size modifier groups; say the word
   and I'll add them.

## Not yet wired up

These are deliberate stubs, each isolated to one function:

- **Geocoding.** `geocodePostcodeStub()` derives a stable pseudo-location near
  the shop so the radius check has something to work against in development.
  Replace with a real geocoder. The delivery area is currently decided by
  postcode district, which does not depend on it.
- **Driver tracking.** The status timeline is advanced by hand from the kitchen
  screen. The real system gets this pushed from the POS.
- **Customer accounts.** No login. Details are remembered in `localStorage`,
  and the tracking page's "recent orders" is this browser's own list of
  references — deliberately not a server lookup, since without a login an
  endpoint that listed orders by phone number would be a way to read
  somebody else's.
- **Store configuration.** `storeConfig` and `orderSetup` in
  [src/data/store.js](src/data/store.js) are still static in the front end. The
  API serves them at `/api/config` and there is no admin screen that edits
  them, so the two copies are kept in step by hand — the defaults in
  [server/api/lib/settings.php](server/api/lib/settings.php) mirror that file.

## Configuring for a different shop

Almost everything is in [src/data/store.js](src/data/store.js): address,
coordinates (the geofence centre), radius, served postcode districts, prep
times, fees, minimum order, surcharge rates and the promo. Trading hours are the
`storeShifts` array in the same file.
