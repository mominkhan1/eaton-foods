<?php
/**
 * PayPal Standard Checkout: create, then capture.
 *
 * THE RULE HERE: the browser is told what to pay, never asked. The amount
 * comes from the stored order — priced server-side from the database when the
 * order was placed — and the capture is checked against that same figure
 * before anything is marked paid. A customer who edits the JavaScript can
 * change what PayPal's window says only by making the capture disagree with
 * the order, which is exactly the case this refuses.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/paypal.php';

/**
 * POST /api/orders/{reference}/paypal-order
 *
 * Creates the PayPal order and returns its id for the SDK to open.
 */
function create_paypal_order(string $reference): void
{
    if (!paypal_is_configured()) {
        fail('payment_unavailable', 'Online payment is not available right now.', 503);
    }

    $source = requested_payment_source();
    $order  = load_payable_order($reference);
    $pence  = to_pence($order['total']);

    if ($pence <= 0) {
        fail('invalid_total', 'That order has nothing to pay.', 422);
    }

    $currency = paypal_currency();

    $payload = [
        'intent' => 'CAPTURE',
        'purchase_units' => [[
            // Ours, echoed back on the capture and in the webhook, so a payment
            // can always be traced to an order without trusting the browser.
            'custom_id'    => $order['reference'],
            'invoice_id'   => $order['reference'] . '-' . $order['id'],
            'description'  => 'Order ' . $order['reference'],
            'amount'       => [
                'currency_code' => $currency,
                'value'         => paypal_amount($pence),
            ],
        ]],
    ];

    /*
     * ONLY the PayPal wallet names its payment source up front.
     *
     * Naming `payment_source.paypal` pins the order to that one source, which
     * is what produces the popup-free PAY_NOW experience. Google Pay and Apple
     * Pay attach their own source later, from the browser, when the SDK calls
     * confirmOrder() with the wallet's payment token — and PayPal rejects that
     * outright on an order already pinned to the PayPal wallet. So for those
     * two the order is created plain and the wallet fills the gap.
     */
    if ($source === 'paypal') {
        $payload['payment_source'] = [
            'paypal' => [
                'experience_context' => [
                    // No shipping step: this is a takeaway, and the address was
                    // collected and geofenced before the order existed.
                    'shipping_preference' => 'NO_SHIPPING',
                    // The customer stays on our checkout; the SDK handles the
                    // popup and hands control back to onApprove.
                    'user_action'         => 'PAY_NOW',
                    'brand_name'          => (string) (store_config()['name'] ?? 'Eat On'),
                    'return_url'          => rtrim((string) config('site_url'), '/') . '/thank-you/' . $order['reference'],
                    'cancel_url'          => rtrim((string) config('site_url'), '/') . '/checkout',
                ],
            ],
        ];
    }

    /*
     * The source is part of the idempotency key, not just the amount.
     *
     * PayPal returns the ORIGINAL order for a repeated PayPal-Request-Id. A
     * customer who opens the PayPal button, backs out, and then taps Google Pay
     * would otherwise be handed back the order pinned to the PayPal wallet, and
     * the Google Pay confirm would fail with nothing on screen to explain it.
     */
    $result = paypal_request(
        'POST',
        '/v2/checkout/orders',
        $payload,
        'create-' . $order['reference'] . '-' . $source . '-' . $pence
    );

    if ($result['status'] >= 400 || empty($result['body']['id'])) {
        fail('paypal_unavailable', 'We could not start the payment. Please try again.', 502);
    }

    // Recorded now so the kitchen and the webhook can both tell how it was
    // paid, even if the customer never comes back to complete the capture.
    db_run(
        "UPDATE orders SET payment_status = 'awaiting', payment_method = ? WHERE id = ?",
        [$source, $order['id']]
    );

    json_response([
        'paypalOrderId' => $result['body']['id'],
        'reference'     => $order['reference'],
        'amount'        => paypal_amount($pence),
        'currency'      => $currency,
        'source'        => $source,
    ]);
}

/**
 * Which payment source the browser is asking to open.
 *
 * Allowlisted rather than taken at face value, and checked against what the
 * shop has actually switched on — an unconfigured wallet must not be openable
 * by posting its name, or a customer reaches a sheet the account cannot settle.
 * Absent means the PayPal wallet, so an older cached copy of the app keeps
 * working unchanged.
 */
function requested_payment_source(): string
{
    $source = strtolower(trim((string) (body()['source'] ?? 'paypal')));

    if ($source === '') {
        $source = 'paypal';
    }
    if (!in_array($source, PAYPAL_SOURCES, true) || !paypal_wallet_enabled($source)) {
        fail('unsupported_source', 'That payment method is not available.', 422);
    }

    return $source;
}

/**
 * POST /api/orders/{reference}/paypal-capture
 *
 * Takes the money and, only if PayPal confirms the right amount in the right
 * currency, marks the order paid and sends it to the kitchen.
 */
function capture_paypal_order(string $reference): void
{
    if (!paypal_is_configured()) {
        fail('payment_unavailable', 'Online payment is not available right now.', 503);
    }

    $order    = load_payable_order($reference);
    $input    = body();
    $paypalId = trim((string) ($input['paypalOrderId'] ?? ''));

    if ($paypalId === '' || !preg_match('/^[A-Z0-9]{5,64}$/i', $paypalId)) {
        fail('invalid_payment', 'That payment could not be identified.', 422);
    }

    $expectedPence    = to_pence($order['total']);
    $expectedCurrency = paypal_currency();

    $result = paypal_request(
        'POST',
        '/v2/checkout/orders/' . urlencode($paypalId) . '/capture',
        // An empty body is required; PayPal rejects a bare POST.
        (object) [],
        // Same key for a retry of the same capture, so a customer who loses
        // the connection mid-capture is not charged twice.
        'capture-' . $order['reference']
    );

    $body = $result['body'];

    /*
     * ALREADY_CAPTURED is a success, not a failure. It means the first attempt
     * got through and only the response was lost — treat it as paid and read
     * the real state back, rather than telling a customer who has been charged
     * that their payment failed.
     */
    $alreadyCaptured = ($body['details'][0]['issue'] ?? '') === 'ORDER_ALREADY_CAPTURED';

    if ($result['status'] >= 400 && !$alreadyCaptured) {
        $issue = $body['details'][0]['issue'] ?? '';

        // The customer can fix these by paying another way; everything else is
        // ours to investigate and must not leak outward.
        $customerFixable = [
            'INSTRUMENT_DECLINED' => 'That payment method was declined. Please try another.',
            'PAYER_ACTION_REQUIRED' => 'PayPal needs another step before this can complete.',
            'PAYER_CANNOT_PAY' => 'PayPal could not take payment from that account.',
        ];

        db_run("UPDATE orders SET payment_status = 'failed' WHERE id = ?", [$order['id']]);

        fail(
            'payment_failed',
            $customerFixable[$issue] ?? 'The payment did not go through. Nothing has been charged.',
            402,
            ['issue' => $issue]
        );
    }

    if ($alreadyCaptured) {
        $result = paypal_request('GET', '/v2/checkout/orders/' . urlencode($paypalId));
        $body   = $result['body'];
    }

    $capture = $body['purchase_units'][0]['payments']['captures'][0] ?? null;

    if (!$capture || ($capture['status'] ?? '') !== 'COMPLETED') {
        fail('payment_incomplete', 'The payment has not completed. Please try again.', 402);
    }

    // ── The check that matters ────────────────────────────────────────────
    $paidPence    = to_pence($capture['amount']['value'] ?? '0');
    $paidCurrency = strtoupper((string) ($capture['amount']['currency_code'] ?? ''));

    if ($paidPence !== $expectedPence || $paidCurrency !== $expectedCurrency) {
        // Do not mark it paid, and do not feed the kitchen. Somebody has
        // either found a bug or is trying it on, and either way a person needs
        // to look before food goes out.
        error_log(sprintf(
            '[eaton][paypal] AMOUNT MISMATCH on %s: captured %s %s, expected %s %s (capture %s)',
            $order['reference'],
            $capture['amount']['value'] ?? '?', $paidCurrency,
            paypal_amount($expectedPence), $expectedCurrency,
            $capture['id'] ?? '?'
        ));

        fail(
            'amount_mismatch',
            'That payment did not match the order total. Please contact the shop before ordering again.',
            409
        );
    }

    mark_order_paid_by_paypal($order, (string) $capture['id']);

    json_response([
        'reference' => $order['reference'],
        'status'    => 'paid',
        'captureId' => $capture['id'],
    ]);
}

/**
 * Mark an order paid and release it to the kitchen.
 *
 * Shared with the webhook, which is the backstop for a capture whose response
 * never reached the browser. Both routes can run for one payment, so this is
 * written to be safe to call twice.
 */
function mark_order_paid_by_paypal(array $order, string $captureId): void
{
    if ($order['payment_status'] === 'paid') {
        return;
    }

    /*
     * Keep the wallet the customer actually used.
     *
     * It was written when the order was created, and this used to overwrite it
     * with a flat 'paypal' — which would report every Google Pay and Apple Pay
     * payment as a PayPal one on the kitchen screen and in the reports. Anything
     * unrecognised falls back, so a row from before this existed still reads
     * sensibly.
     */
    $method = in_array((string) ($order['payment_method'] ?? ''), PAYPAL_SOURCES, true)
        ? (string) $order['payment_method']
        : 'paypal';

    db_transaction(static function () use ($order, $captureId, $method): void {
        db_run(
            "UPDATE orders
                SET payment_status = 'paid', payment_method = ?,
                    payment_ref = ?, paid_at = ?
              WHERE id = ? AND payment_status <> 'paid'",
            [$method, $captureId, utc_now(), $order['id']]
        );
        db_run(
            'INSERT INTO order_events (order_id, event_type, detail) VALUES (?, ?, ?)',
            [$order['id'], 'payment', 'Paid via ' . paypal_source_label($method) . ' (' . $captureId . ')']
        );
    });

    /*
     * The kitchen hears about the order here and nowhere else.
     *
     * Notifying at placement would print a ticket for every abandoned
     * checkout, and the shop would cook food nobody paid for. Emails go out
     * after the transaction commits, and their failure is swallowed — a full
     * mailbox must not turn a captured payment into an error.
     */
    $fresh = find_order_by_reference($order['reference']);
    if ($fresh) {
        notify_order_placed(present_order($fresh, false));
    }
}

/** The order, if it is in a state where paying for it makes sense. */
function load_payable_order(string $reference): array
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

    return $order;
}
