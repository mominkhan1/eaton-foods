<?php
/**
 * Admin: trading hours, banners, promo.
 */

declare(strict_types=1);

/** PUT /api/admin/hours — replaces the whole schedule in one transaction. */
function admin_save_hours(): void
{
    $input = body();

    if (isset($input['manualStatus'])) {
        $status = need_enum($input, 'manualStatus', ['auto', 'open', 'closed']);
        put_setting('manual_status', ['value' => $status]);
    }

    if (isset($input['shifts'])) {
        if (!is_array($input['shifts'])) {
            fail('invalid_value', "'shifts' must be an array.", 422);
        }

        $rows = [];
        foreach ($input['shifts'] as $shift) {
            if (!is_array($shift)) {
                continue;
            }
            $day   = need_int($shift, 'day', 1, 7);
            $start = need_int($shift, 'start', 0, 86400);
            $end   = need_int($shift, 'end', 0, 86400);

            // A zero-length or reversed shift silently makes the shop look shut
            // all day, which is an expensive bug to discover on a Friday night.
            if ($end <= $start) {
                fail('invalid_shift', 'A shift must end after it starts.', 422, ['day' => $day]);
            }

            $rows[] = [$day, $start, $end,
                need_bool($shift, 'noDelivery', false) ? 1 : 0,
                need_bool($shift, 'noPickup', false) ? 1 : 0];
        }

        db_transaction(static function () use ($rows): void {
            db_run('DELETE FROM shifts');
            foreach ($rows as $row) {
                db_run(
                    'INSERT INTO shifts (day_of_week, start_second, end_second, no_delivery, no_pickup)
                     VALUES (?, ?, ?, ?, ?)',
                    $row
                );
            }
        });
    }

    if (isset($input['closedDates'])) {
        if (!is_array($input['closedDates'])) {
            fail('invalid_value', "'closedDates' must be an array.", 422);
        }

        $dates = [];
        foreach ($input['closedDates'] as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $date = (string) ($entry['date'] ?? '');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                fail('invalid_date', 'Closed dates must be YYYY-MM-DD.', 422);
            }
            $dates[] = [$date, opt_string($entry, 'reason', 190)];
        }

        db_transaction(static function () use ($dates): void {
            db_run('DELETE FROM closed_dates');
            foreach ($dates as $row) {
                db_run(
                    'INSERT INTO closed_dates (closed_date, reason) VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE reason = VALUES(reason)',
                    $row
                );
            }
        });
    }

    json_response(get_hours());
}

// ── Banners ────────────────────────────────────────────────────────────────

function admin_save_banner(string $id): void
{
    $id    = need_slug(['id' => $id], 'id');
    $input = body();

    // Default to the end of the list when the caller does not care.
    $order = isset($input['displayOrder'])
        ? (int) $input['displayOrder']
        : (int) (db_one('SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM banners')['n'] ?? 1);

    db_run(
        'INSERT INTO banners (id, eyebrow, title, subtitle, body, price_note, price,
                              button_text, button_href, button2_text, button2_href,
                              show_store_status, image_id, background_image_id,
                              display_order, is_published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            eyebrow = VALUES(eyebrow), title = VALUES(title), subtitle = VALUES(subtitle),
            body = VALUES(body), price_note = VALUES(price_note), price = VALUES(price),
            button_text = VALUES(button_text), button_href = VALUES(button_href),
            button2_text = VALUES(button2_text), button2_href = VALUES(button2_href),
            show_store_status = VALUES(show_store_status),
            image_id = VALUES(image_id), background_image_id = VALUES(background_image_id),
            display_order = VALUES(display_order), is_published = VALUES(is_published)',
        [
            $id,
            opt_string($input, 'eyebrow', 190),
            opt_string($input, 'heading', 190),
            opt_string($input, 'headingAccent', 255),
            opt_string($input, 'description', 4000),
            opt_string($input, 'priceNote', 120),
            opt_string($input, 'price', 60),
            opt_string($input, 'primaryLabel', 120),
            opt_string($input, 'primaryHref', 255),
            opt_string($input, 'secondaryLabel', 120),
            opt_string($input, 'secondaryHref', 255),
            need_bool($input, 'showStoreStatus', false) ? 1 : 0,
            opt_string($input, 'imageId', 64),
            opt_string($input, 'backgroundImageId', 64),
            $order,
            need_bool($input, 'isPublished', true) ? 1 : 0,
        ]
    );

    renumber_banners();
    json_response(get_banners(true));
}

function admin_delete_banner(string $id): void
{
    db_run('DELETE FROM banners WHERE id = ?', [$id]);
    renumber_banners();
    json_response(get_banners(true));
}

/**
 * POST /api/admin/banners/reorder
 *
 * Takes the ids in their new order. The admin panel moves a slide one place at
 * a time, but sending the whole order rather than a "swap these two" is what
 * makes the result independent of what the list looked like when the shop
 * clicked — two quick clicks cannot interleave into a scrambled list.
 */
function admin_reorder_banners(): void
{
    $ids = body()['orderedIds'] ?? null;
    if (!is_array($ids)) {
        fail('invalid_value', "'orderedIds' must be an array of banner ids.", 422);
    }

    db_transaction(static function () use ($ids): void {
        foreach (array_values($ids) as $position => $id) {
            db_run('UPDATE banners SET display_order = ? WHERE id = ?', [$position + 1, (string) $id]);
        }
    });

    // Anything the caller left out keeps its old number, which could collide;
    // the renumber settles it into a clean 1..n.
    renumber_banners();
    json_response(get_banners(true));
}

/** Keep display_order dense and 1-based, whatever the caller submitted. */
function renumber_banners(): void
{
    $ids = array_column(db_all('SELECT id FROM banners ORDER BY display_order, id'), 'id');
    db_transaction(static function () use ($ids): void {
        foreach ($ids as $position => $id) {
            db_run('UPDATE banners SET display_order = ? WHERE id = ?', [$position + 1, $id]);
        }
    });
}

function admin_save_banner_settings(): void
{
    $input   = body();
    $current = get_setting('banner_settings', default_banner_settings());

    if (isset($input['autoplaySeconds'])) {
        // Clamped, because a 0-second autoplay makes the hero unusable.
        $current['autoplaySeconds'] = max(2, min(30, (int) $input['autoplaySeconds']));
    }
    if (isset($input['emberIntensity'])) {
        $current['emberIntensity'] = max(0.0, min(1.0, (float) $input['emberIntensity']));
    }
    if (isset($input['isAutoplayOn'])) {
        $current['isAutoplayOn'] = need_bool($input, 'isAutoplayOn', true);
    }
    if (isset($input['areEmbersOn'])) {
        $current['areEmbersOn'] = need_bool($input, 'areEmbersOn', true);
    }

    put_setting('banner_settings', $current);
    json_response(get_banners(true));
}

// ── Email ──────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/test-email
 *
 * Sends a sample new-order alert to the configured recipients, so the shop can
 * prove delivery works without waiting for a real order — and find out about a
 * spam-folder problem before a customer's order goes missing.
 */
function admin_test_email(): void
{
    require_once __DIR__ . '/../lib/mail.php';

    $recipients = mail_notification_recipients();
    if ($recipients === []) {
        fail(
            'no_recipients',
            'No notification address is configured. Set mail.order_notifications in the config.',
            422
        );
    }

    // A realistic sample rather than "test 123" — it exercises the same
    // rendering path a real order uses, so a broken template shows up here.
    $sample = [
        'reference' => 'EF-SAMPLE',
        'orderType' => 'delivery',
        'readyAt'   => gmdate('c', time() + 2100),
        'timing'    => ['mode' => 'asap', 'slot' => null],
        'promoCode' => null,
        'customer'  => [
            'name'  => 'Test Customer',
            'phone' => '07700 900123',
            'email' => null,
            'notes' => 'This is a test alert, not a real order.',
        ],
        'address'   => [
            'line1'    => '1 Example Street',
            'line2'    => null,
            'city'     => 'Welwyn Garden City',
            'postcode' => 'AL8 6HA',
        ],
        'lines'     => [[
            'name'       => 'Holy Smash',
            'sizeName'   => 'Make it a meal',
            'quantity'   => 1,
            'totalPence' => 948,
            'notes'      => null,
            'modifiers'  => [
                ['groupName' => 'Choose your sauce', 'optionName' => 'Algerian Sauce', 'pricePence' => 0],
            ],
        ]],
        'totals'    => [
            'subtotal' => 948, 'discount' => 0, 'delivery' => 249,
            'surcharge' => 44, 'total' => 1241,
        ],
        'payment'   => ['status' => 'paid', 'method' => 'paypal', 'paidAt' => gmdate('c')],
    ];

    $sent = send_new_order_notification($sample, 'TEST');

    json_response([
        'ok'         => $sent,
        'recipients' => $recipients,
        'from'       => mail_from_address(),
        'message'    => $sent
            ? 'Test email handed to the mail server. Check the inbox, and the spam folder.'
            : 'The mail server refused the message. Check the error log.',
    ], $sent ? 200 : 502);
}

// ── Promo ──────────────────────────────────────────────────────────────────

function admin_save_promo(): void
{
    $input = body();
    $promo = get_promo();

    if (isset($input['code'])) {
        // Stored upper-case and trimmed once here, so every comparison
        // downstream can be a plain match.
        $promo['code'] = strtoupper(trim((string) $input['code']));
        if (!preg_match('/^[A-Z0-9]{3,40}$/', $promo['code'])) {
            fail('invalid_code', 'A promo code must be 3–40 letters and numbers.', 422, ['field' => 'code']);
        }
    }

    if (isset($input['percentage'])) {
        $promo['percentage'] = max(0, min(100, (float) $input['percentage']));
    }
    if (isset($input['minimumSpend'])) {
        $promo['minimumSpend'] = max(0, min(1000, round((float) $input['minimumSpend'], 2)));
    }
    if (isset($input['isOn'])) {
        $promo['isOn'] = need_bool($input, 'isOn', true);
    }

    foreach (['title' => 190, 'message' => 255, 'buttonText' => 120] as $field => $max) {
        if (isset($input[$field])) {
            $promo[$field] = opt_string($input, $field, $max);
        }
    }

    put_setting('promo', $promo);
    json_response($promo);
}
