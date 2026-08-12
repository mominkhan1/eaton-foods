/**
 * Menu data — Eat On, by The Food Table Ltd.
 *
 * Transcribed from the printed menu board. Descriptions stay close to the
 * original wording so the site and the board agree.
 *
 * Shape mirrors the reference platform:
 *
 *   category  →  item  →  sizes[]        (the size carries the price)
 *                      →  modifierGroups[]
 *
 * "MAKE IT A MEAL" is deliberately a *size*, not a modifier: the board prices
 * it as +£2.49 on the item, and a size keeps the basket line to a single
 * priced selection.
 *
 * `orderTypes` on an item restricts where it can be sold. Items that omit it
 * are available on every order type.
 */

/** "MAKE IT A MEAL — £2.49" (fries and a can). */
export const MEAL_UPCHARGE = 2.49;

const round2 = (value) => Math.round(value * 100) / 100;

/** The two-size meal-upgrade pattern used by every main. */
function mealSizes(single) {
  return [
    { id: 'single', name: 'On its own', price: single },
    {
      id: 'meal',
      name: 'Make it a meal',
      price: round2(single + MEAL_UPCHARGE),
      note: `Adds fries and a drink (+£${MEAL_UPCHARGE.toFixed(2)})`,
    },
  ];
}

function one(name, price) {
  return [{ id: 'std', name, price }];
}

export const seedCategories = [
  {
    id: 'beef-burgers',
    name: 'Beef Burgers',
    displayOrder: 1,
    emoji: '🍔',
    description: 'Freshly ground meat patties and nicely seasoned meat.',
    imageId: null,
  },
  {
    id: 'chicken-burgers',
    name: 'Chicken Burgers',
    displayOrder: 2,
    emoji: '🍗',
    description: 'Freshly ground meat patties and nicely battered meat.',
    imageId: null,
  },
  {
    id: 'club-sandwich',
    name: 'Club Sandwich',
    displayOrder: 3,
    emoji: '🥪',
    description: 'All come with fresh vegetables and nicely seasoned meat.',
    imageId: null,
  },
  {
    id: 'cheesy-rascal',
    name: 'Cheesy Rascal',
    displayOrder: 4,
    emoji: '🧀',
    description: 'Give kick to your meal.',
    imageId: null,
  },
  {
    id: 'add-ons',
    name: 'Add Ons',
    displayOrder: 5,
    emoji: '🍟',
    description: '',
    imageId: null,
  },
  {
    id: 'kids-meal',
    name: 'Kids Meal',
    displayOrder: 6,
    emoji: '🧒',
    description: '',
    imageId: null,
  },
  {
    id: 'beverages',
    name: 'Beverages',
    displayOrder: 7,
    emoji: '🥤',
    description: '',
    imageId: null,
  },
];

/**
 * Option groups, derived from the choices the board actually offers.
 *
 * The sauce choice is worded two different ways, so there are two groups: the
 * full list, and the shorter one The Crispy Crunch specifies.
 */
export const seedModifierGroups = {
  sauceChoice: {
    id: 'sauceChoice',
    name: 'Choose your sauce',
    min: 1,
    max: 1,
    options: [
      { id: 'ketchup', name: 'Ketchup', price: 0 },
      { id: 'chilli', name: 'Chilli', price: 0 },
      { id: 'algerian', name: 'Algerian Sauce', price: 0 },
      { id: 'mayonnaise', name: 'Mayonnaise', price: 0 },
    ],
  },

  // "your choice of chilli sauce or mayonnaise" — The Crispy Crunch only.
  crispySauce: {
    id: 'crispySauce',
    name: 'Choose your sauce',
    min: 1,
    max: 1,
    options: [
      { id: 'chilli', name: 'Chilli Sauce', price: 0 },
      { id: 'mayonnaise', name: 'Mayonnaise', price: 0 },
    ],
  },

  /*
   * Optional by necessity: "Make it a meal" is a size, and the configurator
   * cannot yet show a group for one size only. Left at min 0 so it never
   * blocks Add to basket for someone ordering the item on its own.
   */
  mealDrink: {
    id: 'mealDrink',
    name: 'Meal drink — if you are making it a meal',
    min: 0,
    max: 1,
    options: [
      { id: 'coke', name: 'Coca-Cola', price: 0 },
      { id: 'diet-coke', name: 'Diet Coke', price: 0 },
      { id: 'pepsi', name: 'Pepsi', price: 0 },
      { id: 'fanta', name: 'Fanta', price: 0 },
      { id: '7up', name: '7up', price: 0 },
      { id: 'water', name: 'Water', price: 0 },
      { id: 'juice', name: 'Orange Juice', price: 0 },
    ],
  },

  // "Dips & Peri Salt £0.50" from the Add Ons row.
  extraDips: {
    id: 'extraDips',
    name: 'Add dips & peri salt',
    min: 0,
    max: 4,
    options: [
      { id: 'peri-salt', name: 'Peri Salt', price: 0.5 },
      { id: 'ketchup-dip', name: 'Ketchup Dip', price: 0.5 },
      { id: 'chilli-dip', name: 'Chilli Dip', price: 0.5 },
      { id: 'mayo-dip', name: 'Mayonnaise Dip', price: 0.5 },
    ],
  },

  dipType: {
    id: 'dipType',
    name: 'Which dip?',
    min: 1,
    max: 1,
    options: [
      { id: 'peri-salt', name: 'Peri Salt', price: 0 },
      { id: 'ketchup', name: 'Ketchup', price: 0 },
      { id: 'chilli', name: 'Chilli', price: 0 },
      { id: 'mayonnaise', name: 'Mayonnaise', price: 0 },
    ],
  },

  softDrinkChoice: {
    id: 'softDrinkChoice',
    name: 'Which drink?',
    min: 1,
    max: 1,
    options: [
      { id: 'coke', name: 'Coca-Cola', price: 0 },
      { id: 'diet-coke', name: 'Diet Coke', price: 0 },
      { id: 'pepsi', name: 'Pepsi', price: 0 },
      { id: 'fanta', name: 'Fanta', price: 0 },
      { id: '7up', name: '7up', price: 0 },
    ],
  },
};

export const seedMenuItems = [
  // ── Beef Burgers ─────────────────────────────────────────────────────────
  {
    id: 'holy-smash',
    categoryId: 'beef-burgers',
    name: 'Holy Smash',
    description:
      'Marinated organic Angus beef patty topped with caramelised onions, lettuce, cheese and your choice of sauce, served in a freshly toasted brioche bun.',
    emoji: '🍔',
    imageId: null,
    popular: true,
    sizes: mealSizes(6.99),
    modifierGroups: ['sauceChoice', 'mealDrink', 'extraDips'],
  },
  {
    id: 'bbq-royale',
    categoryId: 'beef-burgers',
    name: 'BBQ Royale',
    description:
      'Marinated organic Angus beef patty with a hint of BBQ sauce, topped with caramelised onions, lettuce and cheese, served with your choice of sauce in a freshly toasted brioche bun.',
    emoji: '🍔',
    imageId: null,
    // NOTE: the printed board shows no price for this item. £6.99 matches the
    // other beef burger — confirm before going live.
    sizes: mealSizes(6.99),
    modifierGroups: ['sauceChoice', 'mealDrink', 'extraDips'],
  },

  // ── Chicken Burgers ──────────────────────────────────────────────────────
  {
    id: 'chick-n-bun',
    categoryId: 'chicken-burgers',
    name: "Chick N' Bun",
    description:
      'Battered chicken minced patty cooked to perfection, packed in a freshly toasted seeded burger bun with lettuce and mayonnaise, served with a sauce of your choice.',
    emoji: '🍔',
    imageId: null,
    popular: true,
    sizes: mealSizes(5.99),
    modifierGroups: ['sauceChoice', 'mealDrink', 'extraDips'],
  },
  {
    id: 'crispy-crunch',
    categoryId: 'chicken-burgers',
    name: 'The Crispy Crunch',
    description:
      'Freshly fried battered chicken fillet with lettuce and your choice of chilli sauce or mayonnaise, served in a freshly toasted seeded burger bun.',
    emoji: '🍔',
    imageId: null,
    popular: true,
    sizes: mealSizes(5.99),
    // The board restricts this one to chilli or mayo.
    modifierGroups: ['crispySauce', 'mealDrink', 'extraDips'],
  },

  // ── Club Sandwich ────────────────────────────────────────────────────────
  {
    id: 'triple-threat',
    categoryId: 'club-sandwich',
    name: 'Triple Threat',
    description:
      'Marinated chicken chunks and seasoned vegetables in freshly toasted bread, served with coleslaw and your choice of sauce.',
    emoji: '🥪',
    imageId: null,
    popular: true,
    sizes: mealSizes(6.99),
    modifierGroups: ['sauceChoice', 'mealDrink', 'extraDips'],
  },
  {
    id: 'foggy-bbq',
    categoryId: 'club-sandwich',
    name: 'Foggy BBQ',
    description:
      'Marinated chicken chunks in special BBQ sauce with seasoned vegetables, served in toasted bread with coleslaw and your choice of sauce.',
    emoji: '🥪',
    imageId: null,
    sizes: mealSizes(6.99),
    modifierGroups: ['sauceChoice', 'mealDrink', 'extraDips'],
  },

  // ── Cheesy Rascal ────────────────────────────────────────────────────────
  {
    id: 'cheesy-rascal',
    categoryId: 'cheesy-rascal',
    name: 'Cheesy Rascal',
    description:
      'Freshly fried fries loaded with marinated chicken chunks, pizza sauce, jalapenos, capsicum, and topped with mozzarella cheese, mayonnaise and chilli garlic.',
    emoji: '🧀',
    imageId: null,
    popular: true,
    sizes: one('Serve', 6.99),
    modifierGroups: ['extraDips'],
  },

  // ── Add Ons ──────────────────────────────────────────────────────────────
  {
    id: 'chilli-cheese-bites',
    categoryId: 'add-ons',
    name: 'Chilli Cheese Bites',
    description: '',
    emoji: '🧀',
    imageId: null,
    sizes: one('5 pcs', 3.99),
    modifierGroups: ['extraDips'],
  },
  {
    id: 'mozzarella-sticks',
    categoryId: 'add-ons',
    name: 'Mozzarella Sticks',
    description: '',
    emoji: '🧀',
    imageId: null,
    sizes: one('4 pcs', 1.49),
    modifierGroups: ['extraDips'],
  },
  {
    id: 'coleslaw',
    categoryId: 'add-ons',
    name: 'Coleslaw',
    description: '',
    emoji: '🥗',
    imageId: null,
    sizes: one('Serve', 1.29),
    modifierGroups: [],
  },
  {
    id: 'dips-peri-salt',
    categoryId: 'add-ons',
    name: 'Dips & Peri Salt',
    description: '',
    emoji: '🥣',
    imageId: null,
    sizes: one('Serve', 0.5),
    modifierGroups: ['dipType'],
  },

  // ── Kids Meal ────────────────────────────────────────────────────────────
  {
    id: 'chicken-nuggets',
    categoryId: 'kids-meal',
    name: 'Chicken Nuggets',
    description: '',
    emoji: '🍗',
    imageId: null,
    sizes: [
      { id: '6pc', name: '6 pcs', price: 3.99 },
      { id: '8pc', name: '8 pcs', price: 4.99 },
      { id: '10pc', name: '10 pcs', price: 5.99 },
    ],
    modifierGroups: ['extraDips'],
  },
  {
    id: 'chicken-poppers',
    categoryId: 'kids-meal',
    name: 'Chicken Poppers',
    description: '',
    emoji: '🍗',
    imageId: null,
    sizes: [
      { id: '6pc', name: '6 pcs', price: 3.99 },
      { id: '8pc', name: '8 pcs', price: 4.99 },
      { id: '10pc', name: '10 pcs', price: 5.99 },
    ],
    modifierGroups: ['extraDips'],
  },
  {
    id: 'hash-brown',
    categoryId: 'kids-meal',
    name: 'Hash Brown',
    description: '',
    emoji: '🥔',
    imageId: null,
    sizes: one('4 pcs', 3.99),
    modifierGroups: ['extraDips'],
  },
  {
    id: 'fries',
    categoryId: 'kids-meal',
    name: 'Fries',
    description: '',
    emoji: '🍟',
    imageId: null,
    popular: true,
    sizes: one('Serve', 2.99),
    modifierGroups: ['extraDips'],
  },

  // ── Beverages ────────────────────────────────────────────────────────────
  {
    id: 'soft-drinks',
    categoryId: 'beverages',
    name: 'Soft Drinks',
    description: '',
    emoji: '🥤',
    imageId: null,
    sizes: one('Can', 1.29),
    modifierGroups: ['softDrinkChoice'],
  },
  {
    id: 'water',
    categoryId: 'beverages',
    name: 'Water',
    description: '',
    emoji: '💧',
    imageId: null,
    sizes: one('Bottle', 1.0),
    modifierGroups: [],
  },
  {
    id: 'juice',
    categoryId: 'beverages',
    name: 'Juice',
    description: '',
    emoji: '🧃',
    imageId: null,
    sizes: one('Bottle', 1.0),
    modifierGroups: [],
  },
];

// ── Pure helpers ───────────────────────────────────────────────────────────
// These take the data they need so they work against either the seeds or the
// live catalog from the repository.

/** Cheapest size price — what the menu card advertises. */
export function fromPrice(item) {
  return Math.min(...item.sizes.map((size) => size.price));
}

/** An item with no `orderTypes` is sold on every order type. */
export function isItemAvailableFor(item, orderType) {
  if (!item?.orderTypes) return true;
  return item.orderTypes.includes(orderType);
}

/** Resolve an item's modifier-group ids against a group map. */
export function resolveModifierGroups(item, groups) {
  return (item?.modifierGroups ?? []).map((id) => groups[id]).filter(Boolean);
}

export function sortByDisplayOrder(list) {
  return [...list].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}

/** An item is on the menu unless it has been explicitly unpublished. */
export function isPublished(item) {
  return item.isPublished !== false;
}

/**
 * Plain-English summary of a group's selection rule.
 *
 * Shared by the item modal and the admin editor so a rule can never be
 * described one way to the customer and another to the shop.
 */
export function describeGroupRule(group) {
  const min = group?.min ?? 0;
  const max = group?.max ?? 1;

  if (min === 0) {
    return max === 1 ? 'Optional · choose 1' : `Optional · up to ${max}`;
  }
  if (min === max) {
    return min === 1 ? 'Required · choose 1' : `Required · choose exactly ${min}`;
  }
  return `Required · choose ${min}–${max}`;
}
