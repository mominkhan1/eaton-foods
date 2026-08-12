<?php
/**
 * POST /api/stripe/webhook
 *
 * Stripe tells us a payment succeeded or failed. This — not the browser — is
 * what marks an order paid. A customer whose connection drops after paying
 * still gets their order into the kitchen, and a customer who fakes a
 * "success" callback in the browser does not.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/stripe.php';

function handle_stripe_webhook(): void
{
    $payload   = file_get_contents('php://input') ?: '';
    $signature = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

    if (!stripe_verify_signature($payload, $signature, (string) config('stripe.webhook_secret'))) {
        // 400 tells Stripe to retry; the dashboard surfaces the failure, which
        // is how a misconfigured secret gets noticed.
        fail('bad_signature', 'Signature verification failed.', 400);
    }

    $event = json_decode($payload, true);
    if (!is_array($event) || !isset($event['id'], $event['type'])) {
        fail('bad_event', 'Unreadable event.', 400);
    }

    // Stripe delivers at-least-once and retries on any non-2xx. Recording the
    // id first makes a duplicate delivery a no-op instead of, say, sending the
    // kitchen the same order twice.
    try {
        db_run(
            'INSERT INTO stripe_events (event_id, event_type) VALUES (?, ?)',
            [$event['id'], $event['type']]
        );
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            json_response(['ok' => true, 'duplicate' => true]);
        }
        throw $e;
    }

    $object = $event['data']['object'] ?? [];

    switch ($event['type']) {
        case 'payment_intent.succeeded':
            mark_order_paid($object);
            break;

        case 'payment_intent.payment_failed':
            mark_order_payment_failed($object);
            break;

        case 'charge.refunded':
            mark_order_refunded($object);
            break;

        default:
            // Everything else is acknowledged and ignored. Returning 200 stops
            // Stripe retrying events we have no interest in.
            break;
    }

    json_response(['ok' => true]);
}

/** Find the order an intent belongs to, by id first then metadata. */
function order_for_intent(array $intent): ?array
{
    $intentId = $intent['id'] ?? null;

    if ($intentId) {
        $order = db_one('SELECT * FROM orders WHERE stripe_intent_id = ?', [$intentId]);
        if ($order) {
            return $order;
        }
    }

    // Fallback: the intent was created but the UPDATE that stored its id did
    // not land (a crash between the two). Metadata still carries the reference.
    $reference = $intent['metadata']['order_reference'] ?? null;
    if ($reference) {
        return find_order_by_reference((string) $reference);
    }

    return null;
}

function mark_order_paid(array $intent): void
{
    $order = order_for_intent($intent);
    if (!$order) {
        error_log('[eaton][stripe] paid intent with no matching order: ' . ($intent['id'] ?? '?'));
        return;
    }

    if ($order['payment_status'] === 'paid') {
        return;
    }

    // Guard against an underpayment caused by a stale intent: only accept the
    // payment if the amount actually captured matches what the order costs.
    $expected = to_pence($order['total']);
    $received = (int) ($intent['amount_received'] ?? $intent['amount'] ?? 0);

    if ($received < $expected) {
        error_log(sprintf(
            '[eaton][stripe] underpaid order %s: expected %d, received %d',
            $order['reference'],
            $expected,
            $received
        ));
        db_run(
            'INSERT INTO order_events (order_id, event_type, detail) VALUES (?, ?, ?)',
            [$order['id'], 'payment', "Underpaid: expected {$expected}p, received {$received}p"]
        );
        // Left as 'pending' on purpose so the shop investigates rather than
        // the kitchen cooking an order that was not properly paid for.
        return;
    }

    db_transaction(static function () use ($order, $intent): void {
        db_run(
            "UPDATE orders
                SET payment_status = 'paid', paid_at = ?, stripe_intent_id = ?
              WHERE id = ?",
            [utc_now(), $intent['id'] ?? $order['stripe_intent_id'], $order['id']]
        );
        db_run(
            'INSERT INTO order_events (order_id, event_type, detail) VALUES (?, ?, ?)',
            [$order['id'], 'payment', 'Payment received']
        );
    });
}

function mark_order_payment_failed(array $intent): void
{
    $order = order_for_intent($intent);
    if (!$order || $order['payment_status'] === 'paid') {
        return;
    }

    $reason = $intent['last_payment_error']['message'] ?? 'Card payment failed';

    db_transaction(static function () use ($order, $reason): void {
        db_run("UPDATE orders SET payment_status = 'failed' WHERE id = ?", [$order['id']]);
        db_run(
            'INSERT INTO order_events (order_id, event_type, detail) VALUES (?, ?, ?)',
            [$order['id'], 'payment', mb_substr($reason, 0, 255)]
        );
    });
}

function mark_order_refunded(array $charge): void
{
    $intentId = $charge['payment_intent'] ?? null;
    if (!$intentId) {
        return;
    }

    $order = db_one('SELECT * FROM orders WHERE stripe_intent_id = ?', [$intentId]);
    if (!$order) {
        return;
    }

    // Partial refunds stay 'paid': the order was still paid for, and flipping
    // it to 'refunded' would misreport the day's takings.
    $fullyRefunded = (int) ($charge['amount_refunded'] ?? 0) >= (int) ($charge['amount'] ?? 0);

    db_transaction(static function () use ($order, $charge, $fullyRefunded): void {
        if ($fullyRefunded) {
            db_run("UPDATE orders SET payment_status = 'refunded' WHERE id = ?", [$order['id']]);
        }
        db_run(
            'INSERT INTO order_events (order_id, event_type, detail) VALUES (?, ?, ?)',
            [
                $order['id'],
                'payment',
                sprintf(
                    '%s refund: £%s',
                    $fullyRefunded ? 'Full' : 'Partial',
                    number_format(((int) ($charge['amount_refunded'] ?? 0)) / 100, 2)
                ),
            ]
        );
    });
}
