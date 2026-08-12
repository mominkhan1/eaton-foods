<?php
/**
 * POST /api/orders/{reference}/payment-intent
 *
 * Returns the client secret the browser needs to confirm the card payment.
 *
 * The amount comes from the stored order, never from the request — the order
 * was priced server-side at creation, and this must not offer a second chance
 * to influence it.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/stripe.php';

function create_payment_intent(string $reference): void
{
    $order = find_order_by_reference($reference);
    if (!$order) {
        fail('not_found', 'We could not find that order.', 404);
    }

    if ($order['payment_status'] === 'paid') {
        fail('already_paid', 'This order has already been paid for.', 409);
    }
    if ($order['status'] === 'cancelled') {
        fail('order_cancelled', 'This order was cancelled.', 409);
    }

    $amountPence = to_pence($order['total']);
    if ($amountPence < 30) {
        // Stripe's own minimum for GBP is 30p; a smaller charge fails opaquely.
        fail('amount_too_small', 'That order total is below the minimum card payment.', 422);
    }

    // Reuse the existing intent if there is one, so a customer who refreshes
    // the payment page does not accumulate abandoned intents.
    if ($order['stripe_intent_id']) {
        try {
            $existing = stripe_request('GET', '/payment_intents/' . $order['stripe_intent_id']);

            $reusable = in_array(
                $existing['status'] ?? '',
                ['requires_payment_method', 'requires_confirmation', 'requires_action'],
                true
            );

            // If the basket total changed (it cannot today, but might once
            // order editing exists) the old intent is wrong — fall through and
            // make a new one.
            if ($reusable && (int) ($existing['amount'] ?? 0) === $amountPence) {
                json_response([
                    'clientSecret' => $existing['client_secret'],
                    'amountPence'  => $amountPence,
                    'reference'    => $order['reference'],
                ]);
            }
        } catch (RuntimeException $e) {
            // A missing or unreadable intent is not fatal — make a fresh one.
            error_log('[eaton] could not reuse intent: ' . $e->getMessage());
        }
    }

    $intent = stripe_request('POST', '/payment_intents', [
        'amount'                    => $amountPence,
        'currency'                  => config('stripe.currency', 'gbp'),
        // Lets Stripe show whatever the customer's device supports
        // (Apple Pay, Google Pay, card) without extra work here.
        'automatic_payment_methods' => ['enabled' => 'true'],
        'description'               => 'Eat On order ' . $order['reference'],
        // Shown on the customer's bank statement. Max 22 chars, and a
        // recognisable name prevents chargebacks from confused customers.
        'statement_descriptor_suffix' => 'EATON',
        'metadata' => [
            'order_reference' => $order['reference'],
            'order_id'        => (string) $order['id'],
            'order_type'      => $order['order_type'],
        ],
        'receipt_email' => $order['customer_email'] ?: null,
    ], 'intent_' . $order['reference'] . '_' . $amountPence);

    db_run(
        "UPDATE orders SET stripe_intent_id = ?, payment_status = 'pending' WHERE id = ?",
        [$intent['id'], $order['id']]
    );

    json_response([
        'clientSecret' => $intent['client_secret'],
        'amountPence'  => $amountPence,
        'reference'    => $order['reference'],
    ]);
}
