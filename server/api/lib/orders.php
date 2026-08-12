<?php
/**
 * Orders: pricing, placement, retrieval.
 *
 * THE RULE HERE: prices sent by the browser are treated as decoration and
 * thrown away. Every line is re-priced from the database before the order is
 * written or a payment intent is created. A customer who edits the JavaScript
 * to send `price: 0.01` gets charged the real menu price.
 *
 * Arithmetic is in integer pence, matching src/lib/money.js exactly — the
 * server total and the browser's displayed total must agree to the penny or
 * customers will (rightly) dispute the charge.
 */

declare(strict_types=1);

// ── Money helpers (mirroring src/lib/money.js) ─────────────────────────────

function to_pence($pounds): int
{
    // round() then cast: (int)(6.99*100) is 698 on some builds because the
    // float is really 698.9999999.
    return (int) round(((float) $pounds) * 100);
}

function percent_of(int $pence, $percentage): int
{
    return (int) round(($pence * (float) $percentage) / 100);
}

function pence_to_decimal(int $pence): string
{
    return number_format($pence / 100, 2, '.', '');
}

// ── Reference generation ───────────────────────────────────────────────────

/**
 * Short, readable, unambiguous — no O/0 or I/1 confusion when a customer reads
 * it down the phone. 30^6 ≈ 729M combinations, and the unique index plus retry
 * below handles the birthday-problem collisions.
 */
function generate_reference(): string
{
    $alphabet = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679';
    $max = strlen($alphabet) - 1;

    $reference = '';
    for ($i = 0; $i < 6; $i++) {
        // random_int, not rand(): order references should not be predictable,
        // since knowing one lets you read that order's details.
        $reference .= $alphabet[random_int(0, $max)];
    }

    return 'EF-' . $reference;
}

// ── Pricing ────────────────────────────────────────────────────────────────

/**
 * Re-price a basket from the database.
 *
 * Returns the priced lines plus the totals breakdown, or fails the request
 * with a specific reason the front end can act on (an unavailable item needs
 * a different message from a below-minimum basket).
 */
function price_basket(array $rawLines, string $orderType, ?string $promoCode): array
{
    if ($rawLines === []) {
        fail('empty_basket', 'Your basket is empty.', 422);
    }
    if (count($rawLines) > 100) {
        fail('basket_too_large', 'That is too many separate items for one order.', 422);
    }

    $setup  = order_setup();
    $priced = [];

    foreach ($rawLines as $index => $rawLine) {
        if (!is_array($rawLine)) {
            fail('invalid_line', 'That basket could not be read.', 422);
        }

        $itemId   = need_slug($rawLine, 'itemId');
        $quantity = need_int($rawLine, 'quantity', 1, 50);
        $notes    = opt_string($rawLine, 'notes', 255);

        $item = find_item_for_pricing($itemId);
        if (!$item) {
            fail('item_unavailable', 'One of the items in your basket is no longer on the menu.', 409, [
                'itemId' => $itemId,
            ]);
        }
        if (!$item['isPublished']) {
            fail('item_unavailable', "\"{$item['name']}\" is not available right now.", 409, [
                'itemId' => $itemId,
            ]);
        }
        // `orderTypes` restricts where an item can be sold (e.g. pickup only).
        if (is_array($item['orderTypes']) && !in_array($orderType, $item['orderTypes'], true)) {
            fail('item_unavailable', "\"{$item['name']}\" is not available for {$orderType}.", 409, [
                'itemId' => $itemId,
            ]);
        }

        // Size carries the price.
        $sizeKey = (string) ($rawLine['sizeId'] ?? '');
        if (!isset($item['sizes'][$sizeKey])) {
            fail('invalid_size', "Please choose an option for \"{$item['name']}\".", 422, [
                'itemId' => $itemId,
            ]);
        }
        $size = $item['sizes'][$sizeKey];

        // ── Modifiers ──────────────────────────────────────────────────────
        $selected  = is_array($rawLine['modifiers'] ?? null) ? $rawLine['modifiers'] : [];
        $modifiers = [];
        $countByGroup = [];

        foreach ($selected as $selection) {
            if (!is_array($selection)) {
                continue;
            }
            $groupId  = (string) ($selection['groupId'] ?? '');
            $optionId = (string) ($selection['optionId'] ?? '');

            // An option from a group this item does not offer is a tampered
            // request, not a UI mistake.
            if (!in_array($groupId, $item['allowedGroups'], true)) {
                fail('invalid_option', 'That combination is not available.', 422, ['itemId' => $itemId]);
            }

            $option = find_modifier_option($groupId, $optionId);
            if (!$option) {
                fail('invalid_option', 'One of your choices is no longer available.', 409, [
                    'itemId' => $itemId,
                ]);
            }
            if (!$option['isAvailable']) {
                fail('invalid_option', "\"{$option['optionName']}\" has run out.", 409, ['itemId' => $itemId]);
            }

            $countByGroup[$groupId] = ($countByGroup[$groupId] ?? 0) + 1;

            $modifiers[] = [
                'groupId'    => $groupId,
                'groupName'  => $option['groupName'],
                'optionKey'  => $optionId,
                'optionName' => $option['optionName'],
                'pricePence' => to_pence($option['price']),
            ];
        }

        // Enforce each group's min/max. The UI already does this, but the UI
        // is not what we are defending against.
        foreach ($item['allowedGroups'] as $groupId) {
            $group = db_one(
                'SELECT name, min_select, max_select FROM modifier_groups WHERE id = ?',
                [$groupId]
            );
            if (!$group) {
                continue;
            }
            $chosen = $countByGroup[$groupId] ?? 0;

            if ($chosen < (int) $group['min_select']) {
                fail('missing_option', "Please choose {$group['name']} for \"{$item['name']}\".", 422, [
                    'itemId'  => $itemId,
                    'groupId' => $groupId,
                ]);
            }
            if ($chosen > (int) $group['max_select']) {
                fail('too_many_options', "Too many choices for {$group['name']}.", 422, [
                    'itemId'  => $itemId,
                    'groupId' => $groupId,
                ]);
            }
        }

        $modifierPence = array_sum(array_column($modifiers, 'pricePence'));
        $unitPence     = to_pence($size['price']) + $modifierPence;

        $priced[] = [
            'itemId'     => $item['id'],
            'name'       => $item['name'],
            'sizeKey'    => $size['key'],
            'sizeName'   => $size['name'],
            'unitPence'  => $unitPence,
            'quantity'   => $quantity,
            'totalPence' => $unitPence * $quantity,
            'modifiers'  => $modifiers,
            'notes'      => $notes,
        ];
    }

    // ── Totals (order of operations matches src/lib/pricing.js) ────────────
    // subtotal → discount → delivery → surcharge → total, with the surcharge
    // charged on the DISCOUNTED subtotal.

    $subtotal = array_sum(array_column($priced, 'totalPence'));

    $promo         = evaluate_promo($promoCode, $subtotal);
    $discount      = $promo['discountPence'];
    $afterDiscount = max(0, $subtotal - $discount);

    $delivery = 0;
    if ($orderType === 'delivery') {
        $freeOver = !empty($setup['isDeliveryFreeOver'])
            && $afterDiscount >= to_pence($setup['freeDeliveryThreshold'] ?? 0);
        $delivery = $freeOver ? 0 : to_pence($setup['deliveryFee'] ?? 0);
    }

    $surcharge = 0;
    if (!empty($setup['isPlatformSurchargeLevied'])) {
        $surcharge = percent_of($afterDiscount, $setup['platformSurchargePercentage'] ?? 0)
            + to_pence($setup['platformSurchargeAmt'] ?? 0);
    }

    $total = $afterDiscount + $delivery + $surcharge;

    // Minimum spend is checked against the gross subtotal, matching the
    // front end — a promo code must not unlock a below-minimum delivery.
    if ($orderType === 'delivery') {
        $minimum = to_pence($setup['minimumDeliveryOrder'] ?? 0);
        if ($subtotal < $minimum) {
            fail(
                'below_minimum',
                'Your order is below the £' . number_format($minimum / 100, 2) . ' delivery minimum.',
                422,
                ['shortfallPence' => $minimum - $subtotal]
            );
        }
    }

    if ($total <= 0) {
        fail('invalid_total', 'That order total could not be calculated.', 422);
    }

    return [
        'lines'  => $priced,
        'totals' => [
            'subtotal'  => $subtotal,
            'discount'  => $discount,
            'delivery'  => $delivery,
            'surcharge' => $surcharge,
            'total'     => $total,
            'promo'     => $promo,
        ],
    ];
}

/** Validate a promo code against a subtotal, reading the live coupon. */
function evaluate_promo(?string $code, int $subtotalPence): array
{
    $promo = get_promo();

    if (empty($promo['isOn']) || $code === null || trim($code) === '') {
        return ['valid' => false, 'reason' => null, 'discountPence' => 0, 'code' => null];
    }

    if (strtoupper(trim($code)) !== strtoupper((string) $promo['code'])) {
        return ['valid' => false, 'reason' => 'unknown-code', 'discountPence' => 0, 'code' => null];
    }

    $minimum = to_pence($promo['minimumSpend'] ?? 0);
    if ($subtotalPence < $minimum) {
        return [
            'valid'         => false,
            'reason'        => 'below-minimum',
            'discountPence' => 0,
            'minimumPence'  => $minimum,
            'code'          => null,
        ];
    }

    return [
        'valid'         => true,
        'reason'        => null,
        'discountPence' => percent_of($subtotalPence, $promo['percentage'] ?? 0),
        'code'          => strtoupper((string) $promo['code']),
    ];
}

// ── Placement ──────────────────────────────────────────────────────────────

function create_order(): array
{
    $input = body();

    $orderType = need_enum($input, 'orderType', ['pickup', 'delivery']);
    $setup     = order_setup();

    if ($orderType === 'delivery' && empty($setup['isDeliveryOn'])) {
        fail('delivery_off', 'Delivery is not available at the moment.', 409);
    }
    if ($orderType === 'pickup' && empty($setup['isPickupOn'])) {
        fail('pickup_off', 'Collection is not available at the moment.', 409);
    }

    // ── Customer ──────────────────────────────────────────────────────────
    $customer = is_array($input['customer'] ?? null) ? $input['customer'] : [];
    $name  = need_string($customer, 'name', 160);
    $phone = need_phone($customer, 'phone');
    $email = isset($customer['email']) && trim((string) $customer['email']) !== ''
        ? need_email($customer, 'email')
        : null;
    $customerNotes = opt_string($customer, 'notes', 1000);

    // ── Address (delivery only) ───────────────────────────────────────────
    $address = null;
    if ($orderType === 'delivery') {
        $raw = is_array($input['address'] ?? null) ? $input['address'] : [];
        $postcode = strtoupper(need_string($raw, 'postcode', 16));

        // Re-check the served area server-side; the browser's geofence check
        // is a convenience, not a control.
        assert_postcode_served($postcode, $setup);

        $address = [
            'line1'    => need_string($raw, 'line1', 255),
            'line2'    => opt_string($raw, 'line2', 255),
            'city'     => opt_string($raw, 'city', 120),
            'postcode' => $postcode,
            'lat'      => isset($raw['lat']) && is_numeric($raw['lat']) ? (float) $raw['lat'] : null,
            'lng'      => isset($raw['lng']) && is_numeric($raw['lng']) ? (float) $raw['lng'] : null,
        ];
    }

    // ── Timing ────────────────────────────────────────────────────────────
    $timing        = is_array($input['timing'] ?? null) ? $input['timing'] : [];
    $timingMode    = need_enum($timing, 'mode', ['asap', 'scheduled']);
    $scheduledSlot = null;

    if ($timingMode === 'scheduled') {
        if (empty($setup['isPreOrderingEnabled'])) {
            fail('preorder_off', 'Scheduled orders are not available.', 409);
        }
        $scheduledSlot = opt_datetime($timing, 'slot');
        if ($scheduledSlot === null) {
            fail('missing_slot', 'Please pick a time for your order.', 422);
        }
        // A slot in the past, or absurdly far ahead, is a client bug.
        $slotTime = strtotime($scheduledSlot . ' UTC');
        $maxAhead = time() + ((int) ($setup['scheduleMaxDaysAhead'] ?? 2) + 1) * 86400;
        if ($slotTime < time() - 300 || $slotTime > $maxAhead) {
            fail('invalid_slot', 'That collection time is no longer available.', 422);
        }
    }

    // ── Price it ──────────────────────────────────────────────────────────
    $lines     = is_array($input['lines'] ?? null) ? $input['lines'] : [];
    $promoCode = opt_string($input, 'promoCode', 40);
    $priced    = price_basket($lines, $orderType, $promoCode);

    $readyAt = $scheduledSlot ?? gmdate('Y-m-d H:i:s', time() + prep_minutes($orderType) * 60);

    // ── Write ─────────────────────────────────────────────────────────────
    $placed = db_transaction(static function (PDO $pdo) use (
        $orderType, $timingMode, $scheduledSlot, $readyAt,
        $name, $phone, $email, $customerNotes, $address, $priced
    ): array {
        $totals = $priced['totals'];

        // Retry on the astronomically unlikely reference collision rather than
        // handing the customer a 500.
        $orderId = null;
        $reference = '';
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $reference = generate_reference();
            try {
                db_run(
                    'INSERT INTO orders (
                        reference, status, order_type, ready_at,
                        timing_mode, scheduled_slot,
                        customer_name, customer_phone, customer_email, customer_notes,
                        address_line1, address_line2, address_city, address_postcode,
                        address_lat, address_lng,
                        promo_code, subtotal, discount, delivery_fee, surcharge, total,
                        payment_status, payment_method, created_ip
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        $reference, 'received', $orderType, $readyAt,
                        $timingMode, $scheduledSlot,
                        $name, $phone, $email, $customerNotes,
                        $address['line1'] ?? null, $address['line2'] ?? null,
                        $address['city'] ?? null, $address['postcode'] ?? null,
                        $address['lat'] ?? null, $address['lng'] ?? null,
                        $totals['promo']['code'],
                        pence_to_decimal($totals['subtotal']),
                        pence_to_decimal($totals['discount']),
                        pence_to_decimal($totals['delivery']),
                        pence_to_decimal($totals['surcharge']),
                        pence_to_decimal($totals['total']),
                        'pending', 'stripe', client_ip_binary(),
                    ]
                );
                $orderId = (int) $pdo->lastInsertId();
                break;
            } catch (PDOException $e) {
                // 23000 = integrity constraint; only retry the reference clash.
                if ($e->getCode() !== '23000' || !str_contains($e->getMessage(), 'uq_orders_reference')) {
                    throw $e;
                }
            }
        }

        if ($orderId === null) {
            throw new RuntimeException('Could not allocate an order reference after 5 attempts.');
        }

        foreach ($priced['lines'] as $line) {
            db_run(
                'INSERT INTO order_lines
                    (order_id, item_id, item_name, size_key, size_name, unit_price, quantity, line_total, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $orderId, $line['itemId'], $line['name'], $line['sizeKey'], $line['sizeName'],
                    pence_to_decimal($line['unitPence']), $line['quantity'],
                    pence_to_decimal($line['totalPence']), $line['notes'],
                ]
            );
            $lineId = (int) $pdo->lastInsertId();

            foreach ($line['modifiers'] as $modifier) {
                db_run(
                    'INSERT INTO order_line_modifiers (line_id, group_name, option_name, price)
                     VALUES (?, ?, ?, ?)',
                    [
                        $lineId, $modifier['groupName'], $modifier['optionName'],
                        pence_to_decimal($modifier['pricePence']),
                    ]
                );
            }
        }

        db_run(
            'INSERT INTO order_events (order_id, event_type, detail) VALUES (?, ?, ?)',
            [$orderId, 'status', 'Order placed']
        );

        $order = find_order_by_reference($reference);
        return present_order($order, false);
    });

    /*
     * Emails go out AFTER the transaction commits.
     *
     * Sending inside it would hold row locks open for however long the mail
     * server takes, and a mail failure would roll back an order the customer
     * has already been told about. notify_order_placed() swallows its own
     * errors for the same reason: a full mailbox must not lose an order.
     */
    notify_order_placed($placed);

    return $placed;
}

/** Fire the new-order emails. Never throws — email must not break checkout. */
function notify_order_placed(array $order): void
{
    try {
        require_once __DIR__ . '/mail.php';

        send_new_order_notification($order);
        send_order_confirmation($order);
    } catch (Throwable $e) {
        error_log('[eaton][mail] order ' . ($order['reference'] ?? '?') . ': ' . $e->getMessage());
    }
}

/** Radius + district check, mirroring src/lib/geo.js. */
function assert_postcode_served(string $postcode, array $setup): void
{
    $districts = $setup['servedPostcodeDistricts'] ?? [];
    if ($districts === []) {
        return;
    }

    // 'AL8 6HA' → 'AL8'. Outward code is the letters plus digits before the
    // space (or before the final three characters if the space is missing).
    $normalised = strtoupper(preg_replace('/\s+/', '', $postcode) ?? '');
    if (strlen($normalised) < 5) {
        fail('bad_postcode', 'That postcode does not look complete.', 422, ['field' => 'postcode']);
    }

    $outward = substr($normalised, 0, strlen($normalised) - 3);
    if (!preg_match('/^([A-Z]{1,2}\d{1,2})/', $outward, $matches)) {
        fail('bad_postcode', 'That postcode does not look right.', 422, ['field' => 'postcode']);
    }

    if (!in_array($matches[1], $districts, true)) {
        fail(
            'outside_delivery_area',
            'Sorry, we do not deliver to that postcode yet. You can still collect.',
            422,
            ['field' => 'postcode']
        );
    }
}

// ── Retrieval ──────────────────────────────────────────────────────────────

function find_order_by_reference(string $reference): ?array
{
    $reference = strtoupper(trim($reference));
    if (!preg_match('/^EF-[A-Z0-9]{6}$/', $reference)) {
        return null;
    }
    return db_one('SELECT * FROM orders WHERE reference = ?', [$reference]);
}

/**
 * Shape an order for the API.
 *
 * `$full` adds the fields only staff should see. A customer tracking their own
 * order gets the status and their own details, never the internal audit trail
 * or another customer's data.
 */
function present_order(array $order, bool $full): array
{
    $orderId = (int) $order['id'];

    $lines = db_all(
        'SELECT id, item_id, item_name, size_key, size_name, unit_price, quantity, line_total, notes
           FROM order_lines WHERE order_id = ? ORDER BY id',
        [$orderId]
    );

    $modifiersByLine = [];
    if ($lines !== []) {
        $placeholders = implode(',', array_fill(0, count($lines), '?'));
        $rows = db_all(
            "SELECT line_id, group_name, option_name, price
               FROM order_line_modifiers WHERE line_id IN ({$placeholders}) ORDER BY id",
            array_column($lines, 'id')
        );
        foreach ($rows as $row) {
            $modifiersByLine[(int) $row['line_id']][] = [
                'groupName'  => $row['group_name'],
                'optionName' => $row['option_name'],
                'pricePence' => to_pence($row['price']),
            ];
        }
    }

    $shapedLines = array_map(static function (array $line) use ($modifiersByLine): array {
        return [
            'itemId'     => $line['item_id'],
            'name'       => $line['item_name'],
            'sizeId'     => $line['size_key'],
            'sizeName'   => $line['size_name'],
            'unitPence'  => to_pence($line['unit_price']),
            'quantity'   => (int) $line['quantity'],
            'totalPence' => to_pence($line['line_total']),
            'notes'      => $line['notes'],
            'modifiers'  => $modifiersByLine[(int) $line['id']] ?? [],
        ];
    }, $lines);

    $payload = [
        'reference'   => $order['reference'],
        'status'      => $order['status'],
        'orderType'   => $order['order_type'],
        'placedAt'    => to_iso8601($order['placed_at']),
        'readyAt'     => to_iso8601($order['ready_at']),
        'timing'      => [
            'mode' => $order['timing_mode'],
            'slot' => to_iso8601($order['scheduled_slot']),
        ],
        'customer'    => [
            'name'  => $order['customer_name'],
            'phone' => $order['customer_phone'],
            'email' => $order['customer_email'],
            'notes' => $order['customer_notes'],
        ],
        'address'     => $order['order_type'] === 'delivery' ? [
            'line1'    => $order['address_line1'],
            'line2'    => $order['address_line2'],
            'city'     => $order['address_city'],
            'postcode' => $order['address_postcode'],
        ] : null,
        'promoCode'   => $order['promo_code'],
        'lines'       => $shapedLines,
        'totals'      => [
            'subtotal'  => to_pence($order['subtotal']),
            'discount'  => to_pence($order['discount']),
            'delivery'  => to_pence($order['delivery_fee']),
            'surcharge' => to_pence($order['surcharge']),
            'total'     => to_pence($order['total']),
        ],
        'payment'     => [
            'status' => $order['payment_status'],
            'method' => $order['payment_method'],
            'paidAt' => to_iso8601($order['paid_at']),
        ],
    ];

    if ($full) {
        $payload['acknowledgedAt'] = to_iso8601($order['acknowledged_at']);
        $payload['completedAt']    = to_iso8601($order['completed_at']);
        $payload['events']         = db_all(
            'SELECT e.event_type, e.detail, e.created_at, u.name AS user_name
               FROM order_events e
               LEFT JOIN users u ON u.id = e.user_id
              WHERE e.order_id = ? ORDER BY e.created_at, e.id',
            [$orderId]
        );
    }

    return $payload;
}
