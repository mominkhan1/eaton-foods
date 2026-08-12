<?php
/**
 * Admin catalog CRUD.
 *
 * PUT is upsert throughout: the admin UI does not distinguish "create" from
 * "edit", and an id the shop chose is the natural primary key.
 */

declare(strict_types=1);

function admin_save_category(string $id): void
{
    $id    = need_slug(['id' => $id], 'id');
    $input = body();

    db_run(
        'INSERT INTO categories (id, name, description, emoji, image_id, display_order, is_published)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            name = VALUES(name), description = VALUES(description), emoji = VALUES(emoji),
            image_id = VALUES(image_id), display_order = VALUES(display_order),
            is_published = VALUES(is_published)',
        [
            $id,
            need_string($input, 'name', 120),
            opt_string($input, 'description', 2000),
            opt_string($input, 'emoji', 16),
            opt_string($input, 'imageId', 64),
            (int) ($input['displayOrder'] ?? 0),
            need_bool($input, 'isPublished', true) ? 1 : 0,
        ]
    );

    json_response(['ok' => true, 'id' => $id]);
}

/**
 * Refuses while the category still holds items — deleting it would orphan
 * them. Mirrors the existing deleteCategory() contract so the UI's
 * "move or delete the items first" message still applies.
 */
function admin_delete_category(string $id): void
{
    $orphans = db_one('SELECT COUNT(*) AS n FROM items WHERE category_id = ?', [$id]);
    $count   = (int) ($orphans['n'] ?? 0);

    if ($count > 0) {
        fail('has_items', "That category still has {$count} item(s) in it.", 409, [
            'reason' => 'has-items',
            'count'  => $count,
        ]);
    }

    db_run('DELETE FROM categories WHERE id = ?', [$id]);
    json_response(['ok' => true]);
}

function admin_reorder_categories(): void
{
    $ids = body()['orderedIds'] ?? null;
    if (!is_array($ids)) {
        fail('invalid_value', "'orderedIds' must be an array of category ids.", 422);
    }

    db_transaction(static function () use ($ids): void {
        foreach (array_values($ids) as $position => $id) {
            db_run('UPDATE categories SET display_order = ? WHERE id = ?', [$position + 1, (string) $id]);
        }
    });

    json_response(['ok' => true]);
}

function admin_save_item(string $id): void
{
    $id    = need_slug(['id' => $id], 'id');
    $input = body();

    $categoryId = need_slug($input, 'categoryId');
    if (!db_one('SELECT id FROM categories WHERE id = ?', [$categoryId])) {
        fail('unknown_category', 'That category does not exist.', 422, ['field' => 'categoryId']);
    }

    $sizes = is_array($input['sizes'] ?? null) ? $input['sizes'] : [];
    if ($sizes === []) {
        fail('missing_sizes', 'An item needs at least one size with a price.', 422, ['field' => 'sizes']);
    }

    $groups = is_array($input['modifierGroups'] ?? null) ? $input['modifierGroups'] : [];

    db_transaction(static function () use ($id, $input, $categoryId, $sizes, $groups): void {
        db_run(
            'INSERT INTO items (id, category_id, name, description, emoji, image_id,
                                is_popular, is_published, display_order, order_types)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                category_id = VALUES(category_id), name = VALUES(name),
                description = VALUES(description), emoji = VALUES(emoji),
                image_id = VALUES(image_id), is_popular = VALUES(is_popular),
                is_published = VALUES(is_published), display_order = VALUES(display_order),
                order_types = VALUES(order_types)',
            [
                $id,
                $categoryId,
                need_string($input, 'name', 160),
                opt_string($input, 'description', 4000),
                opt_string($input, 'emoji', 16),
                opt_string($input, 'imageId', 64),
                need_bool($input, 'popular', false) ? 1 : 0,
                need_bool($input, 'isPublished', true) ? 1 : 0,
                (int) ($input['displayOrder'] ?? 0),
                is_array($input['orderTypes'] ?? null) ? json_encode($input['orderTypes']) : null,
            ]
        );

        // Replace the size set wholesale. Sizes are identified by size_key, so
        // deleting the ones the admin removed keeps the table in step with
        // what was submitted.
        $keptKeys = [];
        foreach (array_values($sizes) as $position => $size) {
            if (!is_array($size)) {
                continue;
            }
            $sizeKey = need_slug($size, 'id');
            $keptKeys[] = $sizeKey;

            db_run(
                'INSERT INTO item_sizes (item_id, size_key, name, price, note, display_order)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    name = VALUES(name), price = VALUES(price),
                    note = VALUES(note), display_order = VALUES(display_order)',
                [
                    $id,
                    $sizeKey,
                    need_string($size, 'name', 120),
                    need_money($size, 'price'),
                    opt_string($size, 'note', 255),
                    $position,
                ]
            );
        }

        if ($keptKeys !== []) {
            $placeholders = implode(',', array_fill(0, count($keptKeys), '?'));
            db_run(
                "DELETE FROM item_sizes WHERE item_id = ? AND size_key NOT IN ({$placeholders})",
                array_merge([$id], $keptKeys)
            );
        }

        // Same for option-group links.
        db_run('DELETE FROM item_modifier_groups WHERE item_id = ?', [$id]);
        foreach (array_values($groups) as $position => $groupId) {
            if (!db_one('SELECT id FROM modifier_groups WHERE id = ?', [(string) $groupId])) {
                continue;   // silently skip a group that has since been deleted
            }
            db_run(
                'INSERT INTO item_modifier_groups (item_id, group_id, display_order) VALUES (?, ?, ?)',
                [$id, (string) $groupId, $position]
            );
        }
    });

    json_response(['ok' => true, 'id' => $id]);
}

function admin_delete_item(string $id): void
{
    // order_lines.item_id is ON DELETE SET NULL, so order history survives with
    // its snapshotted name and price intact.
    db_run('DELETE FROM items WHERE id = ?', [$id]);
    json_response(['ok' => true]);
}

function admin_save_modifier_group(string $id): void
{
    $id    = need_slug(['id' => $id], 'id');
    $input = body();

    $min = need_int($input, 'min', 0, 20);
    $max = need_int($input, 'max', 1, 20);
    if ($max < $min) {
        fail('invalid_range', 'Maximum choices cannot be fewer than the minimum.', 422, ['field' => 'max']);
    }

    $options = is_array($input['options'] ?? null) ? $input['options'] : [];
    if ($options === []) {
        fail('missing_options', 'An option group needs at least one option.', 422, ['field' => 'options']);
    }

    db_transaction(static function () use ($id, $input, $min, $max, $options): void {
        db_run(
            'INSERT INTO modifier_groups (id, name, min_select, max_select) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name = VALUES(name),
                min_select = VALUES(min_select), max_select = VALUES(max_select)',
            [$id, need_string($input, 'name', 160), $min, $max]
        );

        $keptKeys = [];
        foreach (array_values($options) as $position => $option) {
            if (!is_array($option)) {
                continue;
            }
            $optionKey  = need_slug($option, 'id');
            $keptKeys[] = $optionKey;

            db_run(
                'INSERT INTO modifier_options (group_id, option_key, name, price, is_available, display_order)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    name = VALUES(name), price = VALUES(price),
                    is_available = VALUES(is_available), display_order = VALUES(display_order)',
                [
                    $id,
                    $optionKey,
                    need_string($option, 'name', 160),
                    need_money($option, 'price'),
                    need_bool($option, 'isAvailable', true) ? 1 : 0,
                    $position,
                ]
            );
        }

        if ($keptKeys !== []) {
            $placeholders = implode(',', array_fill(0, count($keptKeys), '?'));
            db_run(
                "DELETE FROM modifier_options WHERE group_id = ? AND option_key NOT IN ({$placeholders})",
                array_merge([$id], $keptKeys)
            );
        }
    });

    json_response(['ok' => true, 'id' => $id]);
}

/**
 * Refuses while items still reference the group, unless ?force=1.
 *
 * Silently detaching an option group the kitchen expects (a burger losing its
 * "choose your sauce") is worse than an error, so the caller must opt in.
 */
function admin_delete_modifier_group(string $id): void
{
    $inUse = db_all(
        'SELECT i.name FROM item_modifier_groups g JOIN items i ON i.id = g.item_id WHERE g.group_id = ?',
        [$id]
    );

    if ($inUse !== [] && !need_bool($_GET, 'force', false)) {
        fail('group_in_use', 'That option group is still used by ' . count($inUse) . ' item(s).', 409, [
            'reason' => 'in-use',
            'count'  => count($inUse),
            'items'  => array_column($inUse, 'name'),
        ]);
    }

    // The FK on item_modifier_groups cascades, detaching it everywhere.
    db_run('DELETE FROM modifier_groups WHERE id = ?', [$id]);
    json_response(['ok' => true, 'detachedFrom' => count($inUse)]);
}
