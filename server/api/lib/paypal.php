<?php
/**
 * Minimal PayPal REST client.
 *
 * Deliberately not the official SDK: Composer is awkward on cPanel shared
 * hosting, and this needs four calls — get a token, create an order, capture
 * it, and verify a webhook. cURL is compiled into every Namecheap PHP build,
 * so there is nothing to install.
 *
 * SANDBOX AND LIVE are the same code path, differing only in the base URL and
 * which credentials are configured. That is deliberate: a payment integration
 * that behaves differently in testing is one you have not actually tested.
 */

declare(strict_types=1);

const PAYPAL_LIVE_BASE    = 'https://api-m.paypal.com';
const PAYPAL_SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

function paypal_is_live(): bool
{
    return strtolower((string) config('paypal.mode', 'sandbox')) === 'live';
}

function paypal_api_base(): string
{
    return paypal_is_live() ? PAYPAL_LIVE_BASE : PAYPAL_SANDBOX_BASE;
}

function paypal_currency(): string
{
    return strtoupper((string) config('paypal.currency', 'GBP'));
}

/**
 * Is PayPal configured well enough to take a payment?
 *
 * Checked before the checkout offers a button, so a half-configured shop shows
 * "card payment is not available" rather than a button that fails when pressed.
 */
function paypal_is_configured(): bool
{
    foreach (['paypal.client_id', 'paypal.secret'] as $key) {
        $value = (string) config($key, '');
        if ($value === '' || str_contains($value, 'CHANGE_ME')) {
            return false;
        }
    }
    return true;
}

/**
 * The payment sources the checkout can open, in the order they are offered.
 *
 * 'paypal' is the wallet-and-card flow that has always been here. The other
 * two are the same Orders API underneath — same create, same capture, same
 * amount check — differing only in what the browser puts in front of the
 * customer and how the payment source gets attached to the order.
 */
const PAYPAL_SOURCES = ['applepay', 'googlepay', 'paypal'];

/**
 * Is this wallet switched on?
 *
 * Both default to OFF, and for good reason: Google Pay and Apple Pay through
 * PayPal need Advanced Checkout enabled on the merchant account, and Apple Pay
 * additionally needs the domain registered with Apple. Turning them on in the
 * config before that is done produces a button that fails when pressed, which
 * is worse than no button. Switch each on only once its dashboard setup is
 * finished — DEPLOYMENT.md §8.6.
 */
function paypal_wallet_enabled(string $source): bool
{
    if (!paypal_is_configured()) {
        return false;
    }

    return match ($source) {
        'googlepay' => (bool) config('paypal.google_pay', false),
        'applepay'  => (bool) config('paypal.apple_pay', false),
        'paypal'    => true,
        default     => false,
    };
}

/** What to call a payment source in front of a person. */
function paypal_source_label(string $source): string
{
    return match ($source) {
        'googlepay' => 'Google Pay',
        'applepay'  => 'Apple Pay',
        default     => 'PayPal',
    };
}

/**
 * An OAuth2 access token.
 *
 * Held for the life of the request only. A token lasts about nine hours, but
 * caching it across requests means somewhere to put it — a file the whole
 * shared host can read, or a database round trip that costs as much as the
 * call it saves. One extra HTTPS call per payment is the cheaper trade.
 */
function paypal_access_token(): string
{
    static $token = null;
    if ($token !== null) {
        return $token;
    }

    if (!paypal_is_configured()) {
        throw new RuntimeException('PayPal credentials are not configured.');
    }

    $curl = curl_init();
    curl_setopt_array($curl, [
        CURLOPT_URL            => paypal_api_base() . '/v1/oauth2/token',
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => 'grant_type=client_credentials',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_USERPWD        => config('paypal.client_id') . ':' . config('paypal.secret'),
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    $response = curl_exec($curl);
    $status   = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error    = curl_error($curl);
    curl_close($curl);

    if ($response === false) {
        throw new RuntimeException('Could not reach PayPal: ' . $error);
    }

    $decoded = json_decode((string) $response, true);

    if ($status >= 400 || !isset($decoded['access_token'])) {
        // The commonest cause by far is live credentials against the sandbox
        // host or the reverse, so say which one we tried.
        error_log('[eaton][paypal] token request failed (' . $status . ') against ' . paypal_api_base());
        throw new RuntimeException(
            'PayPal refused the credentials. Check the client ID and secret match the "'
            . config('paypal.mode', 'sandbox') . '" environment.'
        );
    }

    return $token = (string) $decoded['access_token'];
}

/**
 * Call the PayPal REST API.
 *
 * `$requestId` becomes `PayPal-Request-Id`, which makes a retry after a
 * timeout safe: PayPal returns the original result rather than charging the
 * customer twice.
 *
 * `$body` takes an object as well as an array because some endpoints require
 * an empty JSON object and json_encode turns an empty PHP array into `[]`,
 * which PayPal rejects.
 *
 * @return array{status:int, body:array}
 */
function paypal_request(string $method, string $path, array|object|null $body = null, ?string $requestId = null): array
{
    $headers = [
        'Authorization: Bearer ' . paypal_access_token(),
        'Content-Type: application/json',
        'Accept: application/json',
    ];
    if ($requestId !== null) {
        $headers[] = 'PayPal-Request-Id: ' . $requestId;
    }

    $curl = curl_init();
    curl_setopt_array($curl, [
        CURLOPT_URL            => paypal_api_base() . $path,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    if ($body !== null) {
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_SLASHES));
    }

    $response = curl_exec($curl);
    $status   = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error    = curl_error($curl);
    curl_close($curl);

    if ($response === false) {
        throw new RuntimeException('Could not reach PayPal: ' . $error);
    }

    $decoded = json_decode((string) $response, true);
    if (!is_array($decoded)) {
        $decoded = [];
    }

    if ($status >= 400) {
        $name    = $decoded['name'] ?? 'error';
        $message = $decoded['message'] ?? 'PayPal rejected the request.';
        $detail  = $decoded['details'][0]['description'] ?? '';

        error_log(
            '[eaton][paypal] ' . $status . ' ' . $method . ' ' . $path
            . ' — ' . $name . ': ' . $message . ($detail ? ' (' . $detail . ')' : '')
        );
    }

    return ['status' => $status, 'body' => $decoded];
}

/**
 * Money, as PayPal wants it.
 *
 * The API takes decimal strings, not minor units — "12.30", never 1230 and
 * never the float 12.3, which would serialise as "12.3" and be rejected for
 * a two-decimal currency.
 */
function paypal_amount(int $pence): string
{
    return number_format($pence / 100, 2, '.', '');
}

/**
 * Verify a webhook actually came from PayPal.
 *
 * PayPal does not sign with a shared secret the way Stripe does — the payload
 * is checked by asking PayPal about it, passing back the transmission headers
 * it sent. Without this, anyone who finds the webhook URL can POST "payment
 * completed" and get free food, so a failure here must reject the request.
 */
function paypal_verify_webhook(array $headers, string $payload): bool
{
    $webhookId = (string) config('paypal.webhook_id', '');
    if ($webhookId === '' || str_contains($webhookId, 'CHANGE_ME')) {
        error_log('[eaton][paypal] webhook id not configured — rejecting.');
        return false;
    }

    // Header names arrive in whatever case the server felt like.
    $lower = [];
    foreach ($headers as $name => $value) {
        $lower[strtolower($name)] = $value;
    }

    $required = [
        'paypal-transmission-id',
        'paypal-transmission-time',
        'paypal-transmission-sig',
        'paypal-cert-url',
        'paypal-auth-algo',
    ];
    foreach ($required as $name) {
        if (empty($lower[$name])) {
            error_log('[eaton][paypal] webhook missing ' . $name);
            return false;
        }
    }

    $event = json_decode($payload, true);
    if (!is_array($event)) {
        return false;
    }

    $result = paypal_request('POST', '/v1/notifications/verify-webhook-signature', [
        'transmission_id'   => $lower['paypal-transmission-id'],
        'transmission_time' => $lower['paypal-transmission-time'],
        'cert_url'          => $lower['paypal-cert-url'],
        'auth_algo'         => $lower['paypal-auth-algo'],
        'transmission_sig'  => $lower['paypal-transmission-sig'],
        'webhook_id'        => $webhookId,
        'webhook_event'     => $event,
    ]);

    return ($result['body']['verification_status'] ?? '') === 'SUCCESS';
}
