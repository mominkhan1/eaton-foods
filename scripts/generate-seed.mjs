/**
 * Generates server/seed.sql from the existing seed modules.
 *
 * The menu is ~460 lines of JavaScript. Re-typing it as SQL would guarantee a
 * transcription error somewhere, and the two copies would drift the first time
 * someone edits the menu. So this reads the real modules and emits the insert
 * statements, and can be re-run whenever src/data/ changes.
 *
 *   npm run seed:sql
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { seedCategories, seedMenuItems, seedModifierGroups } from '../src/data/menu.js';
import { seedShifts, seedClosedDates, storeConfig, orderSetup } from '../src/data/store.js';
import { seedBanners, seedBannerSettings } from '../src/data/banners.js';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../server/seed.sql');

/** MySQL string literal. Backslash matters: MySQL treats it as an escape. */
function q(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function bool(value) {
  return value ? 1 : 0;
}

function money(value) {
  return Number(value).toFixed(2);
}

function json(value) {
  return q(JSON.stringify(value));
}

const lines = [];

lines.push('-- ---------------------------------------------------------------');
lines.push('-- Eat On — seed data.');
lines.push('--');
lines.push('-- GENERATED FILE — do not edit by hand.');
lines.push('-- Regenerate with:  npm run seed:sql');
lines.push('--');
lines.push('-- Import AFTER schema.sql. Safe to re-run: every insert upserts, so');
lines.push('-- re-importing refreshes the menu without touching orders or staff.');
lines.push('-- ---------------------------------------------------------------');
lines.push('');
lines.push('SET NAMES utf8mb4;');
lines.push('SET FOREIGN_KEY_CHECKS = 0;');
lines.push('');

// ── Categories ─────────────────────────────────────────────────────────────

lines.push('-- Categories');
for (const category of seedCategories) {
  lines.push(
    `INSERT INTO categories (id, name, description, emoji, image_id, display_order, is_published) VALUES (` +
      `${q(category.id)}, ${q(category.name)}, ${q(category.description)}, ${q(category.emoji)}, ` +
      `${q(category.imageId)}, ${category.displayOrder ?? 0}, 1) ` +
      `ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description), ` +
      `emoji=VALUES(emoji), display_order=VALUES(display_order);`,
  );
}
lines.push('');

// ── Option groups ──────────────────────────────────────────────────────────

lines.push('-- Option groups');
for (const group of Object.values(seedModifierGroups)) {
  lines.push(
    `INSERT INTO modifier_groups (id, name, min_select, max_select) VALUES (` +
      `${q(group.id)}, ${q(group.name)}, ${group.min ?? 0}, ${group.max ?? 1}) ` +
      `ON DUPLICATE KEY UPDATE name=VALUES(name), min_select=VALUES(min_select), max_select=VALUES(max_select);`,
  );

  group.options.forEach((option, index) => {
    lines.push(
      `INSERT INTO modifier_options (group_id, option_key, name, price, is_available, display_order) VALUES (` +
        `${q(group.id)}, ${q(option.id)}, ${q(option.name)}, ${money(option.price)}, 1, ${index}) ` +
        `ON DUPLICATE KEY UPDATE name=VALUES(name), price=VALUES(price), display_order=VALUES(display_order);`,
    );
  });
}
lines.push('');

// ── Items ──────────────────────────────────────────────────────────────────

lines.push('-- Items, sizes and option-group links');
seedMenuItems.forEach((item, index) => {
  lines.push(
    `INSERT INTO items (id, category_id, name, description, emoji, image_id, is_popular, ` +
      `is_published, display_order, order_types) VALUES (` +
      `${q(item.id)}, ${q(item.categoryId)}, ${q(item.name)}, ${q(item.description)}, ` +
      `${q(item.emoji)}, ${q(item.imageId)}, ${bool(item.popular)}, 1, ${index}, ` +
      `${item.orderTypes ? json(item.orderTypes) : 'NULL'}) ` +
      `ON DUPLICATE KEY UPDATE category_id=VALUES(category_id), name=VALUES(name), ` +
      `description=VALUES(description), emoji=VALUES(emoji), is_popular=VALUES(is_popular), ` +
      `display_order=VALUES(display_order), order_types=VALUES(order_types);`,
  );

  (item.sizes ?? []).forEach((size, sizeIndex) => {
    lines.push(
      `INSERT INTO item_sizes (item_id, size_key, name, price, note, display_order) VALUES (` +
        `${q(item.id)}, ${q(size.id)}, ${q(size.name)}, ${money(size.price)}, ` +
        `${q(size.note)}, ${sizeIndex}) ` +
        `ON DUPLICATE KEY UPDATE name=VALUES(name), price=VALUES(price), ` +
        `note=VALUES(note), display_order=VALUES(display_order);`,
    );
  });

  (item.modifierGroups ?? []).forEach((groupId, groupIndex) => {
    lines.push(
      `INSERT INTO item_modifier_groups (item_id, group_id, display_order) VALUES (` +
        `${q(item.id)}, ${q(groupId)}, ${groupIndex}) ` +
        `ON DUPLICATE KEY UPDATE display_order=VALUES(display_order);`,
    );
  });
});
lines.push('');

// ── Trading hours ──────────────────────────────────────────────────────────
//
// Shifts have no natural key, so this replaces the set rather than upserting.
// Safe on re-import: hours are configuration, not history.

lines.push('-- Trading hours');
lines.push('DELETE FROM shifts;');
for (const shift of seedShifts) {
  lines.push(
    `INSERT INTO shifts (day_of_week, start_second, end_second, no_delivery, no_pickup) VALUES (` +
      `${shift.day}, ${shift.start}, ${shift.end}, ${bool(shift.noDelivery)}, ${bool(shift.noPickup)});`,
  );
}
lines.push('');

for (const closed of seedClosedDates) {
  lines.push(
    `INSERT INTO closed_dates (closed_date, reason) VALUES (${q(closed.date)}, ${q(closed.reason)}) ` +
      `ON DUPLICATE KEY UPDATE reason=VALUES(reason);`,
  );
}
lines.push('');

// ── Banners ────────────────────────────────────────────────────────────────

// The column names are the editor's vocabulary one step removed: title is the
// heading, subtitle the orange second line, body the description.
lines.push('-- Hero banners');
seedBanners.forEach((slide, index) => {
  lines.push(
    `INSERT INTO banners (id, eyebrow, title, subtitle, body, price_note, price, ` +
      `button_text, button_href, button2_text, button2_href, show_store_status, ` +
      `image_id, background_image_id, display_order, is_published) VALUES (` +
      `${q(slide.id)}, ${q(slide.eyebrow)}, ${q(slide.heading)}, ${q(slide.headingAccent)}, ` +
      `${q(slide.description)}, ${q(slide.priceNote)}, ${q(slide.price)}, ` +
      `${q(slide.primaryLabel)}, ${q(slide.primaryHref)}, ` +
      `${q(slide.secondaryLabel)}, ${q(slide.secondaryHref)}, ` +
      `${bool(slide.showStoreStatus ?? false)}, ` +
      `${q(slide.imageId)}, ${q(slide.backgroundImageId)}, ${slide.displayOrder ?? index + 1}, ` +
      `${bool(slide.isPublished ?? true)}) ` +
      `ON DUPLICATE KEY UPDATE eyebrow=VALUES(eyebrow), title=VALUES(title), ` +
      `subtitle=VALUES(subtitle), body=VALUES(body), price_note=VALUES(price_note), ` +
      `price=VALUES(price), button_text=VALUES(button_text), button_href=VALUES(button_href), ` +
      `button2_text=VALUES(button2_text), button2_href=VALUES(button2_href), ` +
      `show_store_status=VALUES(show_store_status), display_order=VALUES(display_order);`,
  );
});
lines.push('');

// ── Settings ───────────────────────────────────────────────────────────────

lines.push('-- Settings (JSON singletons)');
const settings = {
  store_config: storeConfig,
  order_setup: orderSetup,
  promo: orderSetup.promo,
  banner_settings: seedBannerSettings,
  manual_status: { value: 'auto' },
};

for (const [key, value] of Object.entries(settings)) {
  lines.push(
    `INSERT INTO settings (setting_key, value_json) VALUES (${q(key)}, ${json(value)}) ` +
      `ON DUPLICATE KEY UPDATE value_json=VALUES(value_json);`,
  );
}
lines.push('');

lines.push('SET FOREIGN_KEY_CHECKS = 1;');
lines.push('');

writeFileSync(outputPath, lines.join('\n'), 'utf8');

const counts = {
  categories: seedCategories.length,
  items: seedMenuItems.length,
  optionGroups: Object.keys(seedModifierGroups).length,
  shifts: seedShifts.length,
  banners: seedBanners.length,
};

console.log(`Wrote ${outputPath}`);
console.log(
  `  ${counts.categories} categories, ${counts.items} items, ` +
    `${counts.optionGroups} option groups, ${counts.shifts} shifts, ${counts.banners} banners`,
);
