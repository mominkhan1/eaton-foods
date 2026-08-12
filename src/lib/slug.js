/** URL-safe id derived from a name, kept unique against `existing`. */
export function slugify(name, existing = [], fallback = 'item') {
  const base =
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || fallback;

  if (!existing.includes(base)) return base;

  let suffix = 2;
  while (existing.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
