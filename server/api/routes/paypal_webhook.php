<?php
/**
 * POST /api/paypal/webhook
 *
 * The backstop, not the main path. A payment is normally settled by the
 * capture call the browser makes, which is synchronous and can tell the
 * customer what happened. This catches the cases that call cannot:
 *
 *   - the customer closed the tab between approving and capturing
 *   - the capture succeeded but its response never got back to the browser
 *   - a payment PayPal held for review later cleared, or was denied
 *   - somebody refunded from the PayPal dashboard
 *
 * PayPal retries a webhook that does not return 2xx, so anything we cannot act
 * on is acknowledged rather than failed — an unknown event type is not an
 * error, it is an event we do not care about.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/paypal.php';
require_once __DIR__ . '/paypal_order.php';

function handle_paypal_webhook(): void
{
    $payload = file_get_contents('php://input') ?: '';
    $headers = function_exists('getallheaders') ? (getallheaders() ?: []) : server_headers();

    if (!paypal_verify_webhook($headers, $payload)) {
        // Deliberately terse. Anyone probing this endpoint learns nothing
        // about why they failed.
        error_log('[eaton][paypal] webhook signature rejected.');
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'invalid_signature']);
        exit;
    }

    $event = json_decode($payload, true);
    $type  = (string) ($event['event_type'] ?? '');
    $data  = $event['resource'] ?? [];
    $id    = (string) ($event['id'] ?? '');

    /*
     * Replay protection.
     *
     * PayPal redelivers anything that did not return 2xx, and can deliver the
     * same event twice regardless. Claiming the id first — and treating the
     * duplicate-key error as "already handled" — means a redelivery cannot
     * re-run a refund or resend the kitchen's ticket.
     */
    if ($id !== '') {
        try {
            db_run(
                'INSERT INTO payment_events (event_id, event_type) VALUES (?, ?)',
                [$id, $type !== '' ? $type : 'unknown']
            );
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                json_response(['received' => true, 'duplicate' => true]);
            }
            throw $e;
        }
    }

    switch ($type) {
        case 'PAYMENT.CAPTURE.COMPLETED':
            webhook_capture_completed($data);
            break;

        case 'PAYMENT.CAPTURE.DENIED':
        case 'PAYMENT.CAPTURE.DECLINED':
            webhook_capture_failed($data);
            break;

        case 'PAYMENT.CAPTURE.REFUNDED':
        case 'PAYMENT.CAPTURE.REVERSED':
            webhook_capture_refunded($data);
            break;

        default:
            // Acknowledged and ignored, so PayPal stops retrying it.
            break;
    }

    json_response(['received' => true]);
}

/** The order this capture belongs to, found by the reference we sent out. */
function order_for_capture(array $capture): ?array
{
    $reference = (string) ($capture['custom_id'] ?? '');

    if ($reference === '') {
        // Older or hand-made payments may not carry it; fall back to the id.
        $captureId = (string) ($capture['id'] ?? '');
        if ($captureId === '') {
            return null;
        }
        return db_one('SELECT * FROM orders WHERE payment_ref = ?', [$captureId]);
    }

    return find_order_by_reference($reference);
}

function webhook_capture_completed(array $capture): void
{
    $order = order_for_capture($capture);
    if (!$order) {
        error_log('[eaton][paypal] webhook capture for unknown order: ' . ($capture['custom_id'] ?? '?'));
        return;
    }
    if ($order['payment_status'] === 'paid') {
        return;                                   // the capture call got there first
    }

    // The same amount check the capture route makes. A webhook is signed, but
    // signed does not mean the figure matches what we asked for.
    $paidPence    = to_pence($capture['amount']['value'] ?? '0');
    $paidCurrency = strtoupper((string) ($capture['amount']['currency_code'] ?? ''));

    if ($paidPence !== to_pence($order['total']) || $paidCurrency !== paypal_currency()) {
        error_log(sprintf(
            '[eaton][paypal] webhook AMOUNT MISMATCH on %s: %s %s vs expected %s %s',
            $order['reference'], $capture['amount']['value'] ?? '?', $paidCurrency,
            paypal_amount(to_pence($order['total'])), paypal_currency()
        ));
        return;
    }

    mark_order_paid_by_paypal($order, (string) ($capture['id'] ?? ''));
}

function webhook_capture_failed(array $capture): void
{
    $order = order_for_capture($capture);
    if (!$order || $order['payment_status'] === 'paid') {
        return;
    }

    db_transaction(static function () use ($order, $capture): void {
        db_run("UPDATE orders SET payment_status = 'failed' WHERE id = ?", [$order['id']]);
        db_run(
            'INSERT INTO order_events (order_id, event_type, detail) VALUES (?, ?, ?)',
            [$order['id'], 'payment', 'PayPal declined the payment (' . ($capture['status_details']['reason'] ?? 'no reason given') . ')']
        );
    });
}

function webhook_capture_refunded(array $refund): void
{
    // On a refund event the capture is the parent, not the resource itself.
    $captureId = (string) ($refund['links'][0]['href'] ?? '');
    $captureId = preg_match('#/captures/([^/]+)#', $captureId, $m) ? $m[1] : '';

    $order = $captureId !== ''
        ? db_one('SELECT * FROM orders WHERE payment_ref = ?', [$captureId])
        : order_for_capture($refund);

    if (!$order) {
        return;
    }

    db_transaction(static function () use ($order, $refund): void {
        db_run("UPDATE orders SET payment_status = 'refunded' WHERE id = ?", [$order['id']]);
        db_run(
            'INSERT INTO order_events (order_id, event_type, detail) VALUES (?, ?, ?)',
            [$order['id'], 'payment', 'Refunded ' . ($refund['amount']['value'] ?? '') . ' ' . ($refund['amount']['currency_code'] ?? '')]
        );
    });
}

/** getallheaders() is missing on some CGI builds. */
function server_headers(): array
{
    $headers = [];
    foreach ($_SERVER as $key => $value) {
        if (str_starts_with($key, 'HTTP_')) {
            $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($key, 5)))));
            $headers[$name] = $value;
        }
    }
    return $headers;
}
