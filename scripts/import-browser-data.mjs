/**
 * Turn a browser export into committable files.
 *
 * Reads eaton-export.json (produced by scripts/export-browser-data.js) and
 * writes two things:
 *
 *   public/uploads/<id>.<ext>   the real photo files
 *   server/local-data.sql       the menu, banners and promo as SQL
 *
 * Run with:  npm run import:browser
 *
 * The SQL upserts, so importing it is safe to repeat and will not disturb
 * orders, staff or takings.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const exportPath = resolve(root, 'eaton-export.json');

if (!existsSync(exportPath)) {
  console.error('\n  eaton-export.json not found in the project root.\n');
  console.error('  Run scripts/export-browser-data.js in your browser console first');
  console.error('  (on http://localhost:5173, the origin that holds your data),');
  console.error('  then move the downloaded file here.\n');
  process.exit(1);
}

const data = JSON.parse(readFileSync(exportPath, 'utf8'));

console.log(`\n  Reading export from ${data.origin} (${data.exportedAt})`);

// ── Photos ─────────────────────────────────────────────────────────────────

const uploadsDir = resolve(root, 'public/uploads');
mkdirSync(uploadsDir, { recursive: true });

const EXT = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const imageRows = [];

for (const image of data.images ?? []) {
  const comma = image.dataUrl.indexOf(',');
  if (comma === -1) continue;

  const bytes = Buffer.from(image.dataUrl.slice(comma + 1), 'base64');
  const ext = EXT[image.type] ?? 'webp';
  const filename = `${image.id}.${ext}`;

  writeFileSync(resolve(uploadsDir, filename), bytes);

  imageRows.push({ id: image.id, filename, mime: image.type, size: bytes.length });
}

console.log(`  Wrote ${imageRows.length} photo(s) to public/uploads/`);

// ── SQL ────────────────────────────────────────────────────────────────────

const q = (v) => {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
};
const bool = (v) => (v ? 1 : 0);
const money = (v) => Number(v ?? 0).toFixed(2);

const lines = [
  '-- ---------------------------------------------------------------',
  '-- Eat On — data exported from a browser.',
  '--',
  '-- GENERATED FILE. Regenerate with: npm run import:browser',
  `-- Source origin: ${data.origin}`,
  `-- Exported:      ${data.exportedAt}`,
  '--',
  '-- Import AFTER schema.sql. Every statement upserts, so re-running it',
  '-- refreshes the menu without touching orders, staff or takings.',
  '-- ---------------------------------------------------------------',
  '',
  'SET NAMES utf8mb4;',
  'SET FOREIGN_KEY_CHECKS = 0;',
  '',
];

// Images must exist before anything references them.
if (imageRows.length) {
  lines.push('-- Photos (files live in public_html/uploads/)');
  for (const img of imageRows) {
    lines.push(
      `INSERT INTO images (id, filename, mime, size_bytes) VALUES (` +
        `${q(img.id)}, ${q(img.filename)}, ${q(img.mime)}, ${img.size}) ` +
        `ON DUPLICATE KEY UPDATE filename=VALUES(filename), mime=VALUES(mime), size_bytes=VALUES(size_bytes);`,
    );
  }
  lines.push('');
}

const catalog = data.localStorage?.['eaton.catalog.v3'];

if (catalog) {
  lines.push('-- Categories');
  for (const c of catalog.categories ?? []) {
    lines.push(
      `INSERT INTO categories (id, name, description, emoji, image_id, display_order, is_published) VALUES (` +
        `${q(c.id)}, ${q(c.name)}, ${q(c.description)}, ${q(c.emoji)}, ${q(c.imageId)}, ` +
        `${c.displayOrder ?? 0}, ${bool(c.isPublished ?? true)}) ` +
        `ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description), ` +
        `emoji=VALUES(emoji), image_id=VALUES(image_id), display_order=VALUES(display_order), ` +
        `is_published=VALUES(is_published);`,
    );
  }
  lines.push('');

  lines.push('-- Option groups');
  for (const g of Object.values(catalog.modifierGroups ?? {})) {
    lines.push(
      `INSERT INTO modifier_groups (id, name, min_select, max_select) VALUES (` +
        `${q(g.id)}, ${q(g.name)}, ${g.min ?? 0}, ${g.max ?? 1}) ` +
        `ON DUPLICATE KEY UPDATE name=VALUES(name), min_select=VALUES(min_select), max_select=VALUES(max_select);`,
    );
    (g.options ?? []).forEach((o, i) => {
      lines.push(
        `INSERT INTO modifier_options (group_id, option_key, name, price, is_available, display_order) VALUES (` +
          `${q(g.id)}, ${q(o.id)}, ${q(o.name)}, ${money(o.price)}, ${bool(o.isAvailable ?? true)}, ${i}) ` +
          `ON DUPLICATE KEY UPDATE name=VALUES(name), price=VALUES(price), ` +
          `is_available=VALUES(is_available), display_order=VALUES(display_order);`,
      );
    });
  }
  lines.push('');

  lines.push('-- Items, sizes and option-group links');
  (catalog.items ?? []).forEach((item, index) => {
    lines.push(
      `INSERT INTO items (id, category_id, name, description, emoji, image_id, is_popular, ` +
        `is_published, display_order, order_types) VALUES (` +
        `${q(item.id)}, ${q(item.categoryId)}, ${q(item.name)}, ${q(item.description)}, ` +
        `${q(item.emoji)}, ${q(item.imageId)}, ${bool(item.popular)}, ` +
        `${bool(item.isPublished ?? true)}, ${item.displayOrder ?? index}, ` +
        `${item.orderTypes ? q(JSON.stringify(item.orderTypes)) : 'NULL'}) ` +
        `ON DUPLICATE KEY UPDATE category_id=VALUES(category_id), name=VALUES(name), ` +
        `description=VALUES(description), emoji=VALUES(emoji), image_id=VALUES(image_id), ` +
        `is_popular=VALUES(is_popular), is_published=VALUES(is_published), ` +
        `display_order=VALUES(display_order), order_types=VALUES(order_types);`,
    );

    (item.sizes ?? []).forEach((s, i) => {
      lines.push(
        `INSERT INTO item_sizes (item_id, size_key, name, price, note, display_order) VALUES (` +
          `${q(item.id)}, ${q(s.id)}, ${q(s.name)}, ${money(s.price)}, ${q(s.note)}, ${i}) ` +
          `ON DUPLICATE KEY UPDATE name=VALUES(name), price=VALUES(price), ` +
          `note=VALUES(note), display_order=VALUES(display_order);`,
      );
    });

    (item.modifierGroups ?? []).forEach((groupId, i) => {
      lines.push(
        `INSERT INTO item_modifier_groups (item_id, group_id, display_order) VALUES (` +
          `${q(item.id)}, ${q(groupId)}, ${i}) ON DUPLICATE KEY UPDATE display_order=VALUES(display_order);`,
      );
    });
  });
  lines.push('');
}

const banners = data.localStorage?.['eaton.banners.v1'];

if (banners) {
  lines.push('-- Hero banners');
  (banners.slides ?? []).forEach((s, i) => {
    lines.push(
      `INSERT INTO banners (id, title, subtitle, body, button_text, button_href, image_id, ` +
        `background_image_id, display_order, is_published) VALUES (` +
        `${q(s.id)}, ${q(s.title)}, ${q(s.subtitle)}, ${q(s.body)}, ${q(s.buttonText)}, ` +
        `${q(s.buttonHref)}, ${q(s.imageId)}, ${q(s.backgroundImageId)}, ` +
        `${s.displayOrder ?? i + 1}, ${bool(s.isPublished ?? true)}) ` +
        `ON DUPLICATE KEY UPDATE title=VALUES(title), subtitle=VALUES(subtitle), body=VALUES(body), ` +
        `button_text=VALUES(button_text), button_href=VALUES(button_href), image_id=VALUES(image_id), ` +
        `background_image_id=VALUES(background_image_id), display_order=VALUES(display_order), ` +
        `is_published=VALUES(is_published);`,
    );
  });

  if (banners.settings) {
    lines.push(
      `INSERT INTO settings (setting_key, value_json) VALUES ('banner_settings', ` +
        `${q(JSON.stringify(banners.settings))}) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json);`,
    );
  }
  lines.push('');
}

const promo = data.localStorage?.['eaton.promo.v1'];
if (promo) {
  lines.push('-- Promo');
  lines.push(
    `INSERT INTO settings (setting_key, value_json) VALUES ('promo', ${q(JSON.stringify(promo))}) ` +
      `ON DUPLICATE KEY UPDATE value_json=VALUES(value_json);`,
  );
  lines.push('');
}

const hours = data.localStorage?.['eaton.hours.v2'];
if (hours?.shifts?.length) {
  lines.push('-- Trading hours (replaces the set; hours are config, not history)');
  lines.push('DELETE FROM shifts;');
  for (const s of hours.shifts) {
    lines.push(
      `INSERT INTO shifts (day_of_week, start_second, end_second, no_delivery, no_pickup) VALUES (` +
        `${s.day}, ${s.start}, ${s.end}, ${bool(s.noDelivery)}, ${bool(s.noPickup)});`,
    );
  }
  if (hours.manualStatus) {
    lines.push(
      `INSERT INTO settings (setting_key, value_json) VALUES ('manual_status', ` +
        `${q(JSON.stringify({ value: hours.manualStatus }))}) ` +
        `ON DUPLICATE KEY UPDATE value_json=VALUES(value_json);`,
    );
  }
  lines.push('');
}

lines.push('SET FOREIGN_KEY_CHECKS = 1;');
lines.push('');

const sqlPath = resolve(root, 'server/local-data.sql');
writeFileSync(sqlPath, lines.join('\n'), 'utf8');

console.log(`  Wrote ${sqlPath}`);
console.log('\n  Summary');
console.log(`    categories : ${catalog?.categories?.length ?? 0}`);
console.log(`    items      : ${catalog?.items?.length ?? 0}`);
console.log(`    banners    : ${banners?.slides?.length ?? 0}`);
console.log(`    photos     : ${imageRows.length}`);
console.log('\n  Commit public/uploads/ and server/local-data.sql, then import');
console.log('  local-data.sql in phpMyAdmin after schema.sql.\n');
