<?php
/**
 * GET /api/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Revenue and volume, aggregated in SQL rather than by pulling every order
 * into PHP — a year of trading is a lot of rows to sum in a loop on a shared
 * host.
 *
 * Cancelled orders are excluded everywhere, and only PAID orders count towards
 * revenue: an unpaid pending order is not money the shop has.
 */

declare(strict_types=1);

function admin_reports(): void
{
    $zone = new DateTimeZone(store_config()['timeZone'] ?? 'Europe/London');

    $to   = parse_report_date((string) query('to', ''), new DateTimeImmutable('now', $zone), $zone);
    $from = parse_report_date((string) query('from', ''), $to->modify('-29 days'), $zone);

    if ($from > $to) {
        fail('invalid_range', 'The start date must be before the end date.', 422);
    }
    if ($from->diff($to)->days > 366) {
        fail('range_too_large', 'Reports cover at most one year at a time.', 422);
    }

    // Local midnight → UTC, so a "day" is the shop's day, not Greenwich's.
    $fromUtc = $from->setTime(0, 0)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    $toUtc   = $to->setTime(23, 59, 59)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');

    $range = [$fromUtc, $toUtc];

    $summary = db_one(
        "SELECT
            COUNT(*)                                          AS orders,
            COALESCE(SUM(total), 0)                           AS revenue,
            COALESCE(SUM(subtotal), 0)                        AS subtotal,
            COALESCE(SUM(discount), 0)                        AS discount,
            COALESCE(SUM(delivery_fee), 0)                    AS delivery,
            COALESCE(SUM(surcharge), 0)                       AS surcharge,
            COALESCE(AVG(total), 0)                           AS average,
            SUM(order_type = 'delivery')                      AS delivery_orders,
            SUM(order_type = 'pickup')                        AS pickup_orders
           FROM orders
          WHERE placed_at BETWEEN ? AND ?
            AND status <> 'cancelled'
            AND payment_status = 'paid'",
        $range
    ) ?? [];

    // Daily series for the revenue chart. Grouped by the shop's local date via
    // CONVERT_TZ so the bars line up with the shop's trading days.
    $timezoneName = $zone->getName();
    $daily = db_all(
        "SELECT DATE(CONVERT_TZ(placed_at, '+00:00', ?)) AS day,
                COUNT(*)                AS orders,
                COALESCE(SUM(total), 0) AS revenue
           FROM orders
          WHERE placed_at BETWEEN ? AND ?
            AND status <> 'cancelled'
            AND payment_status = 'paid'
          GROUP BY day
          ORDER BY day",
        [tz_offset_string($zone), $fromUtc, $toUtc]
    );

    $topItems = db_all(
        "SELECT l.item_name                       AS name,
                SUM(l.quantity)                   AS quantity,
                COALESCE(SUM(l.line_total), 0)    AS revenue
           FROM order_lines l
           JOIN orders o ON o.id = l.order_id
          WHERE o.placed_at BETWEEN ? AND ?
            AND o.status <> 'cancelled'
            AND o.payment_status = 'paid'
          GROUP BY l.item_name
          ORDER BY quantity DESC
          LIMIT 15",
        $range
    );

    $byStatus = db_all(
        'SELECT status, COUNT(*) AS n FROM orders
          WHERE placed_at BETWEEN ? AND ? GROUP BY status',
        $range
    );

    json_response([
        'range' => [
            'from'     => $from->format('Y-m-d'),
            'to'       => $to->format('Y-m-d'),
            'timeZone' => $timezoneName,
        ],
        'summary' => [
            'orders'         => (int) ($summary['orders'] ?? 0),
            'revenuePence'   => to_pence($summary['revenue'] ?? 0),
            'subtotalPence'  => to_pence($summary['subtotal'] ?? 0),
            'discountPence'  => to_pence($summary['discount'] ?? 0),
            'deliveryPence'  => to_pence($summary['delivery'] ?? 0),
            'surchargePence' => to_pence($summary['surcharge'] ?? 0),
            'averagePence'   => to_pence($summary['average'] ?? 0),
            'deliveryOrders' => (int) ($summary['delivery_orders'] ?? 0),
            'pickupOrders'   => (int) ($summary['pickup_orders'] ?? 0),
        ],
        'daily' => array_map(static function (array $row): array {
            return [
                'date'         => $row['day'],
                'orders'       => (int) $row['orders'],
                'revenuePence' => to_pence($row['revenue']),
            ];
        }, $daily),
        'topItems' => array_map(static function (array $row): array {
            return [
                'name'         => $row['name'],
                'quantity'     => (int) $row['quantity'],
                'revenuePence' => to_pence($row['revenue']),
            ];
        }, $topItems),
        'byStatus' => array_combine(
            array_column($byStatus, 'status'),
            array_map('intval', array_column($byStatus, 'n'))
        ) ?: new stdClass(),
    ]);
}

function parse_report_date(string $raw, DateTimeImmutable $fallback, DateTimeZone $zone): DateTimeImmutable
{
    if ($raw === '') {
        return $fallback;
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw)) {
        fail('invalid_date', 'Dates must be in YYYY-MM-DD format.', 422);
    }
    $parsed = DateTimeImmutable::createFromFormat('Y-m-d', $raw, $zone);
    if ($parsed === false) {
        fail('invalid_date', 'That is not a real date.', 422);
    }
    return $parsed;
}

/**
 * '+01:00' for CONVERT_TZ.
 *
 * Named zones need MySQL's timezone tables loaded, which shared hosts usually
 * do not do; a numeric offset always works. It is computed for the report's
 * own period, so a range that straddles a BST change is off by an hour at one
 * edge — acceptable for a takeaway's daily revenue chart, and noted here so it
 * is a known limitation rather than a mystery.
 */
function tz_offset_string(DateTimeZone $zone): string
{
    $offset = $zone->getOffset(new DateTime('now', $zone));
    $sign   = $offset < 0 ? '-' : '+';
    $offset = abs($offset);

    return sprintf('%s%02d:%02d', $sign, intdiv($offset, 3600), intdiv($offset % 3600, 60));
}
