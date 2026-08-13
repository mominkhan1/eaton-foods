/**
 * The icon set.
 *
 * Hand-drawn inline SVG rather than an icon package: the whole set is smaller
 * than the import statement for one, there is no dependency to keep current,
 * and the shapes can be drawn for a takeaway rather than borrowed from a
 * generic dashboard kit.
 *
 * HOW THEY ARE DRAWN. Bold filled silhouettes on a 24×24 grid, echoing the
 * chunky food-truck logo. Weight and negative space are what make an icon
 * readable at 16px, not detail — so shapes are few, large and separated, and
 * anything that would become a smudge at that size is left out.
 *
 * EVERY icon paints `currentColor`, so colour is the caller's decision: the
 * service bar tints them brand orange, the admin nav inherits the active tab's
 * white, and a disabled control fades them with the surrounding text.
 *
 * SIZE comes from `className` (`h-5 w-5`), never from width/height attributes,
 * so one icon serves a 16px chip and a 48px empty state.
 *
 * Holes are drawn with `fillRule="evenodd"` — a wheel is one path with the rim
 * and the hub in it, not two elements, so it stays a single shape when the
 * colour changes.
 */

/**
 * Shared attributes.
 *
 * `aria-hidden` because every icon here sits beside its own visible label or
 * an aria-label on the control — announcing "burger" before the word "Menu"
 * would just make a screen reader say it twice. `focusable="false"` keeps
 * older Edge from putting them in the tab order.
 */
function Svg({ children, className = 'h-5 w-5', ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

// ── Food ───────────────────────────────────────────────────────────────────

/** Three stacked bands: bun, filling, bun. The gaps are what read as a burger. */
export function BurgerIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3c-4.5 0-8.2 2.4-8.9 5.6-.15.75.44 1.4 1.2 1.4h15.4c.76 0 1.35-.65 1.2-1.4C20.2 5.4 16.5 3 12 3Z" />
      <path d="M4 11.6h16a1.5 1.5 0 0 1 0 3H4a1.5 1.5 0 0 1 0-3Z" />
      <path d="M4.4 16.4h15.2c.72 0 1.3.6 1.25 1.32A3.9 3.9 0 0 1 17 21.2H7a3.9 3.9 0 0 1-3.85-3.48c-.05-.72.53-1.32 1.25-1.32Z" />
    </Svg>
  );
}

/**
 * A drumstick: meat, bone, and the two lobes of the knuckle.
 *
 * Three separate shapes rather than one outline. A drumstick drawn as a single
 * silhouette turns into an unreadable lump below about 24px — it is the joint
 * between the round end and the straight bone that says "chicken".
 */
export function DrumstickIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="15" cy="8.7" r="6.1" />
      <path d="M11.35 10.55a1.7 1.7 0 0 1 2.4 2.4l-4.2 4.2a1.7 1.7 0 0 1-2.4-2.4Z" />
      <circle cx="9.5" cy="17.1" r="2.4" />
      <circle cx="7.2" cy="14.8" r="2.4" />
    </Svg>
  );
}

// ── Service ────────────────────────────────────────────────────────────────

/** Awning over a shopfront, with the doorway cut into the body. */
export function StorefrontIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4.3 3.4h15.4a1.2 1.2 0 0 1 1.12.77l1.6 4.2A1 1 0 0 1 21.48 9.7H2.52a1 1 0 0 1-.94-1.33l1.6-4.2A1.2 1.2 0 0 1 4.3 3.4Z" />
      <path d="M4.4 11.4h15.2v8.4a1.2 1.2 0 0 1-1.2 1.2h-3.6v-4.4a1.2 1.2 0 0 0-1.2-1.2h-3.2a1.2 1.2 0 0 0-1.2 1.2V21H5.6a1.2 1.2 0 0 1-1.2-1.2Z" />
    </Svg>
  );
}

/**
 * Moped: delivery box, deck, fork and handlebar, on two ring wheels.
 *
 * Built from four separated bars rather than one traced outline, so each part
 * stays legible when the whole thing is 16px wide. The deck stops exactly at
 * the top of the wheels — overlapping them would fill in the hubs and turn
 * the wheels into solid discs.
 */
export function ScooterIcon(props) {
  return (
    <Svg {...props}>
      {/* delivery box */}
      <path d="M4.2 4h4.4a1.8 1.8 0 0 1 1.8 1.8v3.8a1.8 1.8 0 0 1-1.8 1.8H4.2a1.8 1.8 0 0 1-1.8-1.8V5.8A1.8 1.8 0 0 1 4.2 4Z" />
      {/* deck, spanning both wheels */}
      <path d="M6.6 11.8h10.2a1.4 1.4 0 0 1 0 2.8H6.6a1.4 1.4 0 0 1 0-2.8Z" />
      {/* fork */}
      <path d="M16.9 4.6a1.4 1.4 0 0 1 1.4 1.4v5a1.4 1.4 0 0 1-2.8 0V6a1.4 1.4 0 0 1 1.4-1.4Z" />
      {/* handlebar */}
      <path d="M15.4 2.6h3.8a1.3 1.3 0 0 1 0 2.6h-3.8a1.3 1.3 0 0 1 0-2.6Z" />
      <path
        fillRule="evenodd"
        d="M6.6 14.7a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6Zm0 2.05a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"
      />
      <path
        fillRule="evenodd"
        d="M17.4 14.7a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6Zm0 2.05a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"
      />
    </Svg>
  );
}

/** Map pin. */
export function PinIcon(props) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 2.2a7.4 7.4 0 0 0-7.4 7.4c0 5.2 6.4 11.4 6.68 11.66a1.05 1.05 0 0 0 1.44 0C13 21 19.4 14.8 19.4 9.6A7.4 7.4 0 0 0 12 2.2Zm0 4.9a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z"
      />
    </Svg>
  );
}

/** Clock — the hands are cut out of the disc so it survives shrinking. */
export function ClockIcon(props) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 2.2a9.8 9.8 0 1 0 0 19.6 9.8 9.8 0 0 0 0-19.6Zm1.2 4.6a1.2 1.2 0 0 0-2.4 0v5.2c0 .38.18.74.48.96l3.2 2.4a1.2 1.2 0 0 0 1.44-1.92l-2.72-2.04Z"
      />
    </Svg>
  );
}

/** Lightning bolt — "as soon as possible". */
export function BoltIcon(props) {
  return (
    <Svg {...props}>
      <path d="M13.6 1.8a.8.8 0 0 1 .77 1.02L12.6 9.4h5.2a.9.9 0 0 1 .7 1.47l-9.4 11.5a.8.8 0 0 1-1.4-.68L9.5 15H4.3a.9.9 0 0 1-.7-1.47l9.3-11.4a.8.8 0 0 1 .7-.33Z" />
    </Svg>
  );
}

// ── Commerce ───────────────────────────────────────────────────────────────

/** Shopping basket. */
export function BasketIcon(props) {
  return (
    <Svg {...props}>
      <path d="M8.9 2.6a1.15 1.15 0 0 1 1.6.3L13.1 6.8h5.5l1.7-3.9a1.15 1.15 0 1 1 2.1.92L21.1 6.8h.6a1.2 1.2 0 0 1 0 2.4h-.35l-1.5 9.2A3 3 0 0 1 16.9 21H7.1a3 3 0 0 1-2.96-2.6l-1.5-9.2H2.3a1.2 1.2 0 1 1 0-2.4h.6L1.6 3.82a1.15 1.15 0 1 1 2.1-.92l1.7 3.9h5.5L8.6 4.2a1.15 1.15 0 0 1 .3-1.6Zm-.4 9.4a1.1 1.1 0 0 0-1.1 1.1v3.4a1.1 1.1 0 0 0 2.2 0v-3.4a1.1 1.1 0 0 0-1.1-1.1Zm7 0a1.1 1.1 0 0 0-1.1 1.1v3.4a1.1 1.1 0 0 0 2.2 0v-3.4a1.1 1.1 0 0 0-1.1-1.1Z" />
    </Svg>
  );
}

/** Credit card. */
export function CardIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3.4 4.6h17.2a2.2 2.2 0 0 1 2.2 2.2v1.4H1.2V6.8a2.2 2.2 0 0 1 2.2-2.2Z" />
      <path
        fillRule="evenodd"
        d="M1.2 10.6h21.6v6.6a2.2 2.2 0 0 1-2.2 2.2H3.4a2.2 2.2 0 0 1-2.2-2.2Zm3.4 4.2a1.1 1.1 0 0 0 0 2.2h3.6a1.1 1.1 0 0 0 0-2.2Z"
      />
    </Svg>
  );
}

/** A phone, for the wallet payment options. */
export function PhoneIcon(props) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M7 1.6h10a2.6 2.6 0 0 1 2.6 2.6v15.6A2.6 2.6 0 0 1 17 22.4H7a2.6 2.6 0 0 1-2.6-2.6V4.2A2.6 2.6 0 0 1 7 1.6Zm3.4 2.6a1 1 0 0 0 0 2h3.2a1 1 0 0 0 0-2Zm1.6 12a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z"
      />
    </Svg>
  );
}

/** Receipt with a torn bottom edge — orders. */
export function ReceiptIcon(props) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M4.6 2.6a1.2 1.2 0 0 1 1.24-.08L8 3.7l2.16-1.18a1.2 1.2 0 0 1 1.15 0L13.47 3.7l2.16-1.18a1.2 1.2 0 0 1 1.15 0L18.94 3.7l2.16-1.18A1.2 1.2 0 0 1 22.9 3.6v14.6a3.6 3.6 0 0 1-3.6 3.6H5.9a3.6 3.6 0 0 1-3.6-3.6V3.6c0-.42.22-.8.58-1.02Zm3.3 5.2a1.1 1.1 0 0 0 0 2.2h9.4a1.1 1.1 0 0 0 0-2.2Zm0 4.4a1.1 1.1 0 1 0 0 2.2h9.4a1.1 1.1 0 0 0 0-2.2Z"
      />
    </Svg>
  );
}

// ── Admin ──────────────────────────────────────────────────────────────────

/** A framed picture with a sun and a hill — banners. */
export function ImageIcon(props) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M4 3.4h16A2.6 2.6 0 0 1 22.6 6v12A2.6 2.6 0 0 1 20 20.6H4A2.6 2.6 0 0 1 1.4 18V6A2.6 2.6 0 0 1 4 3.4Zm12.2 3a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8ZM3.8 18v-1.5l4.3-4.6a1.1 1.1 0 0 1 1.62.02l3.1 3.5 2.06-1.9a1.1 1.1 0 0 1 1.52.03l3.8 3.9v.55Z"
      />
    </Svg>
  );
}

/** Bar chart — reports. */
export function ChartIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3.2 13.4a1.4 1.4 0 0 1 1.4-1.4h2a1.4 1.4 0 0 1 1.4 1.4v7.2a1.4 1.4 0 0 1-1.4 1.4h-2a1.4 1.4 0 0 1-1.4-1.4Z" />
      <path d="M9.9 8.6a1.4 1.4 0 0 1 1.4-1.4h2a1.4 1.4 0 0 1 1.4 1.4v12a1.4 1.4 0 0 1-1.4 1.4h-2a1.4 1.4 0 0 1-1.4-1.4Z" />
      <path d="M16.6 3.4A1.4 1.4 0 0 1 18 2h2a1.4 1.4 0 0 1 1.4 1.4v17.2A1.4 1.4 0 0 1 20 22h-2a1.4 1.4 0 0 1-1.4-1.4Z" />
    </Svg>
  );
}

/** Calendar — the weekly schedule. */
export function CalendarIcon(props) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M7.6 1.8a1.2 1.2 0 0 1 1.2 1.2v1h6.4V3a1.2 1.2 0 0 1 2.4 0v1h1.2A2.8 2.8 0 0 1 21.6 6.8V19A2.8 2.8 0 0 1 18.8 21.8H5.2A2.8 2.8 0 0 1 2.4 19V6.8A2.8 2.8 0 0 1 5.2 4h1.2V3a1.2 1.2 0 0 1 1.2-1.2ZM4.8 9.6v9.4c0 .22.18.4.4.4h13.6a.4.4 0 0 0 .4-.4V9.6Z"
      />
    </Svg>
  );
}

/** A bell — the new-order alert. */
export function BellIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 1.8a1.3 1.3 0 0 1 1.3 1.3v.72a6.9 6.9 0 0 1 5.6 6.78v3.05l1.6 2.7a1.2 1.2 0 0 1-1.03 1.85H4.53A1.2 1.2 0 0 1 3.5 16.35l1.6-2.7V10.6a6.9 6.9 0 0 1 5.6-6.78V3.1A1.3 1.3 0 0 1 12 1.8Z" />
      <path d="M9.2 19.4h5.6a2.8 2.8 0 0 1-5.6 0Z" />
    </Svg>
  );
}

/** Interlocking blocks — option groups. */
export function OptionsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3 4.6A1.6 1.6 0 0 1 4.6 3h5.2a1.6 1.6 0 0 1 1.6 1.6v5.2a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 9.8Z" />
      <path d="M12.8 14.2a1.6 1.6 0 0 1 1.6-1.6h5.2a1.6 1.6 0 0 1 1.6 1.6v5.2a1.6 1.6 0 0 1-1.6 1.6h-5.2a1.6 1.6 0 0 1-1.6-1.6Z" />
      <path
        fillRule="evenodd"
        d="M17 2.6a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Zm0 2.4a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"
      />
      <path
        fillRule="evenodd"
        d="M7.2 12.2a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Zm0 2.4a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"
      />
    </Svg>
  );
}

// ── Feedback and controls ──────────────────────────────────────────────────

/** A tick in a disc — order confirmed. */
export function CheckSealIcon(props) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 1.8a10.2 10.2 0 1 0 0 20.4 10.2 10.2 0 0 0 0-20.4Zm5.06 7.7a1.3 1.3 0 0 0-1.92-1.75l-4.9 5.36-2.34-2.2a1.3 1.3 0 1 0-1.78 1.9l3.3 3.1a1.3 1.3 0 0 0 1.85-.08Z"
      />
    </Svg>
  );
}

/** Solid disc — the open/closed dot. */
export function DotIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="6.4" />
    </Svg>
  );
}

/** Hollow disc — the closed counterpart to DotIcon. */
export function DotOutlineIcon(props) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 5.6a6.4 6.4 0 1 1 0 12.8 6.4 6.4 0 0 1 0-12.8Zm0 2.6a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"
      />
    </Svg>
  );
}

export function ChevronUpIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 7.6c.34 0 .67.13.92.38l6 6a1.3 1.3 0 0 1-1.84 1.84L12 10.74l-5.08 5.08a1.3 1.3 0 0 1-1.84-1.84l6-6c.25-.25.58-.38.92-.38Z" />
    </Svg>
  );
}

export function ChevronDownIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 16.4c-.34 0-.67-.13-.92-.38l-6-6a1.3 1.3 0 0 1 1.84-1.84L12 13.26l5.08-5.08a1.3 1.3 0 0 1 1.84 1.84l-6 6c-.25.25-.58.38-.92.38Z" />
    </Svg>
  );
}

/** Filled triangles for the report deltas — direction at a glance. */
export function TrendUpIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 5.6a1.1 1.1 0 0 1 .92.5l6.6 10.2a1.1 1.1 0 0 1-.92 1.7H5.4a1.1 1.1 0 0 1-.92-1.7l6.6-10.2a1.1 1.1 0 0 1 .92-.5Z" />
    </Svg>
  );
}

export function TrendDownIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 18.4a1.1 1.1 0 0 1-.92-.5L4.48 7.7A1.1 1.1 0 0 1 5.4 6h13.2a1.1 1.1 0 0 1 .92 1.7l-6.6 10.2a1.1 1.1 0 0 1-.92.5Z" />
    </Svg>
  );
}

/** A cross, for remove buttons. */
export function CloseIcon(props) {
  return (
    <Svg {...props}>
      <path d="M5.5 3.7a1.3 1.3 0 0 0-1.8 1.8L10.2 12l-6.5 6.5a1.3 1.3 0 1 0 1.8 1.8l6.5-6.5 6.5 6.5a1.3 1.3 0 0 0 1.8-1.8L13.8 12l6.5-6.5a1.3 1.3 0 0 0-1.8-1.8L12 10.2Z" />
    </Svg>
  );
}
