/** Print the seeded menu, for eyeballing against the printed board. */
import {
  seedCategories,
  seedMenuItems,
  seedModifierGroups,
  resolveModifierGroups,
} from '../src/data/menu.js';

console.log(
  `CATEGORIES ${seedCategories.length} | ITEMS ${seedMenuItems.length} | OPTION GROUPS ${Object.keys(seedModifierGroups).length}`,
);

for (const category of seedCategories) {
  const items = seedMenuItems.filter((item) => item.categoryId === category.id);
  console.log(`\n${category.emoji} ${category.name.toUpperCase()}`);
  for (const item of items) {
    const sizes = item.sizes.map((s) => `${s.name} £${s.price.toFixed(2)}`).join('  |  ');
    console.log(`   ${item.name}  ::  ${sizes}`);
    const groups = resolveModifierGroups(item, seedModifierGroups);
    if (groups.length) console.log(`        ${groups.map((g) => g.name.split(' —')[0]).join(' · ')}`);
  }
}

console.log('\nOPTION GROUPS');
for (const group of Object.values(seedModifierGroups)) {
  console.log(
    `   ${group.name}  [min ${group.min} / max ${group.max}]\n      ${group.options
      .map((o) => o.name + (o.price ? ` +£${o.price.toFixed(2)}` : ''))
      .join(', ')}`,
  );
}
