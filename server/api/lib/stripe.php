<?php
/**
 * Minimal Stripe client.
 *
 * Deliberately not the official SDK: Composer is awkward on cPanel shared
 * hosting, and this needs exactly three calls. cURL is compiled into every
 * Namecheap PHP build, so there is nothing to install.
 *
 * If the shop later needs subscriptions, Connect, or anything beyond one-off
 * payments, replace this with the real SDK rather than growing it.
 */

declare(strict_types=1);

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/**
 * Call the Stripe API.
 *
 * @param string $method 'GET' or 'POST'
 * @param string $path   e.g. '/payment_intents'
 * @param array  $params Form-encoded; nested arrays become foo[bar]=baz.
 */
function stripe_request(string $method, string $path, array $params = [], ?string $idempotencyKey = null): array
{
    $secret = (string) config('stripe.secret_key');
    if ($secret === '' || str_contains($secret, 'CHANGE_ME')) {
        throw new RuntimeException('Stripe secret key is not configured.');
    }

    $url = STRIPE_API_BASE . $path;
    $body = http_build_query($params, '', '&', PHP_QUERY_RFC3986);

    $headers = [
        'Authorization: Bearer ' . $secret,
        'Content-Type: application/x-www-form-urlencoded',
        // Pinning the version means a Stripe API upgrade cannot silently change
        // response shapes under a shop that is not being actively maintained.
        'Stripe-Version: 2024-06-20',
    ];

    // Makes a retry after a timeout safe: Stripe returns the original result
    // instead of charging the customer twice.
    if ($idempotencyKey !== null) {
        $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
    }

    $curl = curl_init();
    curl_setopt_array($curl, [
        CURLOPT_URL            => $method === 'GET' && $body !== '' ? $url . '?' . $body : $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    if ($method === 'POST') {
        curl_setopt($curl, CURLOPT_POST, true);
        curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
    }

    $response = curl_exec($curl);
    $status   = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error    = curl_error($curl);
    curl_close($curl);

    if ($response === false) {
        throw new RuntimeException('Could not reach Stripe: ' . $error);
    }

    $decoded = json_decode((string) $response, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Stripe returned an unreadable response.');
    }

    if ($status >= 400) {
        $message = $decoded['error']['message'] ?? 'Stripe rejected the request.';
        error_log('[eaton][stripe] ' . $status . ' ' . $path . ' — ' . $message);

        // Card errors are the customer's problem to fix and are safe to show.
        // Everything else is a configuration fault and must not leak outward.
        $type = $decoded['error']['type'] ?? '';
        if ($type === 'card_error') {
            fail('card_declined', $message, 402);
        }

        throw new RuntimeException('Stripe error: ' . $message);
    }

    return $decoded;
}

/**
 * Verify a webhook signature.
 *
 * Without this, anyone who finds the webhook URL can POST "payment succeeded"
 * and get free food. This is the single most important check in the file.
 */
function stripe_verify_signature(string $payload, string $signatureHeader, string $secret, int $toleranceSeconds = 300): bool
{
    if ($secret === '' || str_contains($secret, 'CHANGE_ME')) {
        error_log('[eaton][stripe] webhook secret not configured — rejecting.');
        return false;
    }

    // Header looks like: t=1690000000,v1=abc123,v1=def456
    $timestamp = null;
    $signatures = [];

    foreach (explode(',', $signatureHeader) as $part) {
        $piece = explode('=', trim($part), 2);
        if (count($piece) !== 2) {
            continue;
        }
        if ($piece[0] === 't') {
            $timestamp = (int) $piece[1];
        } elseif ($piece[0] === 'v1') {
            $signatures[] = $piece[1];
        }
    }

    if ($timestamp === null || $signatures === []) {
        return false;
    }

    // Reject replays of an old, legitimately-signed event.
    if (abs(time() - $timestamp) > $toleranceSeconds) {
        error_log('[eaton][stripe] webhook timestamp outside tolerance.');
        return false;
    }

    $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);

    foreach ($signatures as $signature) {
        // Constant-time: a plain === leaks the correct prefix through timing.
        if (hash_equals($expected, $signature)) {
            return true;
        }
    }

    return false;
}
