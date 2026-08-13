<?php
/**
 * Admin order endpoints — the kitchen screen.
 */

declare(strict_types=1);

/** The status flow, mirroring src/lib/orders.js. Collection skips 'on-the-way'. */
function status_steps_for(string $orderType): array
{
    $steps = ['received', 'preparing', 'ready', 'on-the-way', 'complete'];
    if ($orderType !== 'delivery') {
        $steps = array_values(array_diff($steps, ['on-the-way']));
    }
    return $steps;
}

/**
 * GET /api/admin/orders
 *
 * ?scope=active|today|all  ?status=…  ?limit=…
 *
 * Defaults to `active` — the kitchen wants the working list, and pulling every
 * order ever placed onto a tablet gets slower every week.
 */
function admin_list_orders(): void
{
    $scope  = (string) query('scope', 'active');
    $limit  = max(1, min(200, (int) query('limit', 100)));
    $status = query('status');

    $where  = [];
    $params = [];

    switch ($scope) {
        case 'active':
            $where[] = "status NOT IN ('complete','cancelled')";
            /*
             * The kitchen's working list is orders that have been paid for.
             *
             * An order sits at 'pending' or 'awaiting' from the moment it is
             * created until PayPal confirms the capture, which for an
             * abandoned checkout is forever. Those must not reach the pass, or
             * the shop cooks food nobody bought. 'unpaid' is the cash-on-
             * collection case and is genuinely workable, so it stays.
             *
             * Nothing is lost: scope=all still shows them, flagged, for anyone
             * chasing a payment that half-happened.
             */
            $where[] = "payment_status IN ('paid','unpaid')";
            break;
        case 'today':
            // Shop-local day, not UTC: at 00:30 BST the kitchen still means
            // "tonight's orders", and a UTC day boundary would cut them off.
            $zone = new DateTimeZone(store_config()['timeZone'] ?? 'Europe/London');
            $startLocal = new DateTimeImmutable('today 04:00', $zone);
            if ($startLocal > new DateTimeImmutable('now', $zone)) {
                $startLocal = $startLocal->modify('-1 day');
            }
            $where[] = 'placed_at >= ?';
            $params[] = $startLocal->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
            break;
        case 'all':
            break;
        default:
            fail('invalid_scope', "scope must be 'active', 'today' or 'all'.", 422);
    }

    if ($status !== null && $status !== '') {
        $allowed = ['received', 'preparing', 'ready', 'on-the-way', 'complete', 'cancelled'];
        if (!in_array($status, $allowed, true)) {
            fail('invalid_status', 'Unknown status filter.', 422);
        }
        $where[] = 'status = ?';
        $params[] = $status;
    }

    $sql = 'SELECT * FROM orders';
    if ($where !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    // Active orders are worked oldest-first; history reads newest-first.
    $sql .= $scope === 'active' ? ' ORDER BY placed_at ASC' : ' ORDER BY placed_at DESC';
    $sql .= ' LIMIT ' . $limit;

    $orders = array_map(
        static fn (array $row): array => present_order($row, true),
        db_all($sql, $params)
    );

    // The "new order" chime keys off this rather than re-scanning client-side.
    $unacknowledged = db_one(
        "SELECT COUNT(*) AS n FROM orders
          WHERE acknowledged_at IS NULL
            AND status NOT IN ('cancelled','complete')
            AND payment_status IN ('paid','unpaid')"
    );

    json_response([
        'orders'              => $orders,
        'unacknowledgedCount' => (int) ($unacknowledged['n'] ?? 0),
        'serverTime'          => gmdate('c'),
    ]);
}

/**
 * PATCH /api/admin/orders/{reference}/status
 *
 * Transitions are validated: the kitchen may advance a step, jump to
 * 'complete', or cancel — but not resurrect a finished order, which would
 * corrupt the day's takings.
 */
function admin_set_status(string $reference): void
{
    $user  = current_user();
    $order = find_order_by_reference($reference);

    if (!$order) {
        fail('not_found', 'Order not found.', 404);
    }

    $next = need_enum(body(), 'status', [
        'received', 'preparing', 'ready', 'on-the-way', 'complete', 'cancelled',
    ]);

    $current = $order['status'];

    if ($current === $next) {
        json_response(present_order($order, true));
    }

    if (in_array($current, ['complete', 'cancelled'], true)) {
        fail(
            'order_closed',
            'This order is already ' . $current . ' and cannot be changed.',
            409
        );
    }

    // Any forward step in this order type's flow is allowed, plus cancel.
    if ($next !== 'cancelled') {
        $steps = status_steps_for($order['order_type']);
        $currentIndex = array_search($current, $steps, true);
        $nextIndex    = array_search($next, $steps, true);

        if ($nextIndex === false) {
            fail('invalid_status', "That status does not apply to a {$order['order_type']} order.", 422);
        }
        if ($currentIndex !== false && $nextIndex < $currentIndex) {
            fail('invalid_transition', 'An order cannot go backwards.', 409);
        }
    }

    $completedAt = $next === 'complete' ? utc_now() : null;

    db_transaction(static function () use ($order, $next, $completedAt, $user, $current): void {
        db_run(
            'UPDATE orders SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?',
            [$next, $completedAt, $order['id']]
        );
        db_run(
            'INSERT INTO order_events (order_id, user_id, event_type, detail) VALUES (?, ?, ?, ?)',
            [$order['id'], $user['id'] ?? null, 'status', "{$current} → {$next}"]
        );
    });

    $updated = present_order(find_order_by_reference($reference), true);

    // Tell the customer, for the states worth an email. Failures are logged
    // and ignored — the kitchen's screen must update even if mail is down.
    try {
        require_once __DIR__ . '/../lib/mail.php';
        send_status_update($updated, $next);
    } catch (Throwable $e) {
        error_log('[eaton][mail] status update ' . $reference . ': ' . $e->getMessage());
    }

    json_response($updated);
}

/** POST /api/admin/orders/{reference}/acknowledge — silences the new-order alert. */
function admin_acknowledge(string $reference): void
{
    $user  = current_user();
    $order = find_order_by_reference($reference);

    if (!$order) {
        fail('not_found', 'Order not found.', 404);
    }

    // First acknowledgement wins; re-opening the order must not reset the clock
    // that measures how fast the kitchen responded.
    if ($order['acknowledged_at'] === null) {
        db_run('UPDATE orders SET acknowledged_at = ? WHERE id = ?', [utc_now(), $order['id']]);
        db_run(
            'INSERT INTO order_events (order_id, user_id, event_type, detail) VALUES (?, ?, ?, ?)',
            [$order['id'], $user['id'] ?? null, 'note', 'Acknowledged']
        );
    }

    json_response(present_order(find_order_by_reference($reference), true));
}
