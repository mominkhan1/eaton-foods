/**
 * Where a hero button should point.
 *
 * The shop types these by hand, so the renderer has to work out whether a
 * value is an in-app route (React Router `Link`), or something the browser
 * should handle itself — an on-page anchor, a phone number, an email, or an
 * external site (plain `<a>`).
 */

const BROWSER_PREFIXES = ['#', 'tel:', 'mailto:', 'sms:', 'http://', 'https://', '//'];

export function isBrowserHref(href) {
  if (!href) return false;
  const value = String(href).trim().toLowerCase();
  return BROWSER_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** External links leave the site and need the usual rel hardening. */
export function isExternalHref(href) {
  if (!href) return false;
  const value = String(href).trim().toLowerCase();
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('//');
}

/** A button only renders when it has both a label and a destination. */
export function hasLink(label, href) {
  return Boolean(String(label ?? '').trim() && String(href ?? '').trim());
}
