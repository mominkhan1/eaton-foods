<?php
/**
 * Catalog reads.
 *
 * Returns the same shape the React app already consumes — categories, items
 * with `sizes` and `modifierGroups`, and a `modifierGroups` map keyed by id —
 * so the front end's rendering code does not change when the data starts
 * coming from MySQL instead of localStorage.
 */

declare(strict_types=1);

/**
 * @param bool $includeUnpublished Admin screens need hidden items; the public
 *                                 menu must never see them.
 */
/**
 * Public URL for a stored image id, or null.
 *
 * The map is loaded once per request rather than joined into every query:
 * categories, items and banners all need it, and a shop's whole photo library
 * is a few dozen rows.
 *
 * Returning the URL alongside the id means the browser never has to look one
 * up — the catalog response is enough to render the menu.
 */
function image_url_map(): array
{
    static $map = null;
    if ($map !== null) {
        return $map;
    }

    $base = rtrim((string) config('uploads_url', '/uploads'), '/');

    $map = [];
    foreach (db_all('SELECT id, filename FROM images') as $row) {
        $map[$row['id']] = $base . '/' . $row['filename'];
    }

    return $map;
}

function image_url(?string $imageId): ?string
{
    if ($imageId === null || $imageId === '') {
        return null;
    }
    return image_url_map()[$imageId] ?? null;
}

function get_catalog(bool $includeUnpublished = false): array
{
    $categoryWhere = $includeUnpublished ? '' : 'WHERE is_published = 1';
    $itemWhere     = $includeUnpublished ? '' : 'WHERE i.is_published = 1 AND c.is_published = 1';

    $categories = db_all(
        "SELECT id, name, description, emoji, image_id, display_order, is_published
           FROM categories {$categoryWhere}
          ORDER BY display_order, name"
    );

    $items = db_all(
        "SELECT i.id, i.category_id, i.name, i.description, i.emoji, i.image_id,
                i.is_popular, i.is_published, i.display_order, i.order_types
           FROM items i
           JOIN categories c ON c.id = i.category_id
           {$itemWhere}
          ORDER BY i.display_order, i.name"
    );

    // Sizes and option-group links are fetched in one query each and grouped in
    // PHP. Doing it per item would be a query per row — fine with 60 items,
    // ruinous on a shared host once the menu grows.
    $sizesByItem = [];
    foreach (db_all('SELECT item_id, size_key, name, price, note FROM item_sizes ORDER BY item_id, display_order') as $row) {
        $sizesByItem[$row['item_id']][] = [
            'id'    => $row['size_key'],
            'name'  => $row['name'],
            'price' => (float) $row['price'],
            'note'  => $row['note'],
        ];
    }

    $groupsByItem = [];
    foreach (db_all('SELECT item_id, group_id FROM item_modifier_groups ORDER BY item_id, display_order') as $row) {
        $groupsByItem[$row['item_id']][] = $row['group_id'];
    }

    $shapedItems = array_map(static function (array $row) use ($sizesByItem, $groupsByItem): array {
        return [
            'id'             => $row['id'],
            'categoryId'     => $row['category_id'],
            'name'           => $row['name'],
            'description'    => $row['description'],
            'emoji'          => $row['emoji'],
            'imageId'        => $row['image_id'],
            'imageUrl'       => image_url($row['image_id']),
            'popular'        => (bool) $row['is_popular'],
            'isPublished'    => (bool) $row['is_published'],
            'displayOrder'   => (int) $row['display_order'],
            // Absent means "sellable on every order type", which is how the
            // seed data expresses it.
            'orderTypes'     => $row['order_types'] ? json_decode($row['order_types'], true) : null,
            'sizes'          => $sizesByItem[$row['id']] ?? [],
            'modifierGroups' => $groupsByItem[$row['id']] ?? [],
        ];
    }, $items);

    return [
        'categories'     => array_map(static function (array $row): array {
            return [
                'id'           => $row['id'],
                'name'         => $row['name'],
                'description'  => $row['description'],
                'emoji'        => $row['emoji'],
                'imageId'      => $row['image_id'],
                'imageUrl'     => image_url($row['image_id']),
                'displayOrder' => (int) $row['display_order'],
                'isPublished'  => (bool) $row['is_published'],
            ];
        }, $categories),
        'items'          => $shapedItems,
        'modifierGroups' => get_modifier_groups(),
    ];
}

/** Keyed by group id, matching `seedModifierGroups`. */
function get_modifier_groups(): array
{
    $groups = [];
    foreach (db_all('SELECT id, name, min_select, max_select FROM modifier_groups ORDER BY name') as $row) {
        $groups[$row['id']] = [
            'id'      => $row['id'],
            'name'    => $row['name'],
            'min'     => (int) $row['min_select'],
            'max'     => (int) $row['max_select'],
            'options' => [],
        ];
    }

    $options = db_all(
        'SELECT group_id, option_key, name, price, is_available
           FROM modifier_options
          ORDER BY group_id, display_order, name'
    );

    foreach ($options as $row) {
        if (!isset($groups[$row['group_id']])) {
            continue;
        }
        $groups[$row['group_id']]['options'][] = [
            'id'          => $row['option_key'],
            'name'        => $row['name'],
            'price'       => (float) $row['price'],
            'isAvailable' => (bool) $row['is_available'],
        ];
    }

    return $groups;
}

// ── Lookups used when pricing an order ─────────────────────────────────────

/**
 * One item with its sizes and option groups, or null.
 *
 * Used by the checkout path, which must not trust prices sent by the browser.
 */
function find_item_for_pricing(string $itemId): ?array
{
    $item = db_one(
        'SELECT i.id, i.name, i.is_published, i.order_types, c.is_published AS category_published
           FROM items i
           JOIN categories c ON c.id = i.category_id
          WHERE i.id = ?',
        [$itemId]
    );

    if (!$item) {
        return null;
    }

    $sizes = [];
    foreach (db_all('SELECT size_key, name, price FROM item_sizes WHERE item_id = ?', [$itemId]) as $row) {
        $sizes[$row['size_key']] = [
            'key'   => $row['size_key'],
            'name'  => $row['name'],
            'price' => (float) $row['price'],
        ];
    }

    $allowedGroups = array_column(
        db_all('SELECT group_id FROM item_modifier_groups WHERE item_id = ?', [$itemId]),
        'group_id'
    );

    return [
        'id'            => $item['id'],
        'name'          => $item['name'],
        'isPublished'   => (bool) $item['is_published'] && (bool) $item['category_published'],
        'orderTypes'    => $item['order_types'] ? json_decode($item['order_types'], true) : null,
        'sizes'         => $sizes,
        'allowedGroups' => $allowedGroups,
    ];
}

/** One option's authoritative name and price. */
function find_modifier_option(string $groupId, string $optionKey): ?array
{
    $row = db_one(
        'SELECT g.id AS group_id, g.name AS group_name, g.min_select, g.max_select,
                o.option_key, o.name AS option_name, o.price, o.is_available
           FROM modifier_options o
           JOIN modifier_groups g ON g.id = o.group_id
          WHERE o.group_id = ? AND o.option_key = ?',
        [$groupId, $optionKey]
    );

    if (!$row) {
        return null;
    }

    return [
        'groupId'     => $row['group_id'],
        'groupName'   => $row['group_name'],
        'min'         => (int) $row['min_select'],
        'max'         => (int) $row['max_select'],
        'optionKey'   => $row['option_key'],
        'optionName'  => $row['option_name'],
        'price'       => (float) $row['price'],
        'isAvailable' => (bool) $row['is_available'],
    ];
}
