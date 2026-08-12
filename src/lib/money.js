/**
 * Money helpers.
 *
 * Everything in the cart is held in pence (integers) so that repeated
 * additions never drift. Prices in the menu data are written as pounds for
 * readability and converted on the way in.
 */

export function toPence(pounds) {
  return Math.round(Number(pounds) * 100);
}

export function toPounds(pence) {
  return pence / 100;
}

export function formatPence(pence) {
  return `£${(pence / 100).toFixed(2)}`;
}

export function formatPounds(pounds) {
  return `£${Number(pounds).toFixed(2)}`;
}

/** Percentage of a pence amount, rounded to the nearest penny. */
export function percentOf(pence, percentage) {
  return Math.round((pence * percentage) / 100);
}
