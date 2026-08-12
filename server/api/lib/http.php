<?php
/**
 * Request parsing, JSON responses, and input validation.
 */

declare(strict_types=1);

// ── Responses ──────────────────────────────────────────────────────────────

function json_response($data, int $status = 200): void
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        // The API is same-origin with the site, so no CORS headers are needed.
        // These three are cheap and close off common attacks.
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: same-origin');
        // Order and catalog data must never be cached by a proxy — a customer
        // seeing another customer's order would be a serious leak.
        header('Cache-Control: no-store, private');
    }

    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Fail the request with a machine-readable code and a human message.
 *
 * `$code` is what the front end switches on; `$message` is what it shows the
 * customer, so it must be safe to display and free of internal detail.
 */
function fail(string $code, string $message, int $status = 400, array $extra = []): void
{
    json_response(array_merge([
        'error'   => $code,
        'message' => $message,
    ], $extra), $status);
}

// ── Input ──────────────────────────────────────────────────────────────────

/**
 * The decoded JSON body, cached per request.
 *
 * Rejects malformed JSON up front rather than letting every field read as
 * null and producing a confusing cascade of validation errors.
 */
function body(): array
{
    static $parsed = null;
    if ($parsed !== null) {
        return $parsed;
    }

    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return $parsed = [];
    }

    $decoded = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        fail('bad_json', 'The request body was not valid JSON.', 400);
    }

    return $parsed = is_array($decoded) ? $decoded : [];
}

function query(string $key, $default = null)
{
    return $_GET[$key] ?? $default;
}

// ── Validation ─────────────────────────────────────────────────────────────
//
// Deliberately small. Each helper returns a clean value or fails the request;
// there is no error-accumulating validator because the endpoints here are
// simple enough that the first bad field is the useful one to report.

function need_string(array $source, string $key, int $max = 255, int $min = 1): string
{
    $value = trim((string) ($source[$key] ?? ''));

    if ($value === '' && $min > 0) {
        fail('missing_field', "'{$key}' is required.", 422, ['field' => $key]);
    }
    if (mb_strlen($value) > $max) {
        fail('field_too_long', "'{$key}' must be {$max} characters or fewer.", 422, ['field' => $key]);
    }
    if (mb_strlen($value) < $min) {
        fail('field_too_short', "'{$key}' is too short.", 422, ['field' => $key]);
    }

    return $value;
}

function opt_string(array $source, string $key, int $max = 255): ?string
{
    if (!isset($source[$key])) {
        return null;
    }
    $value = trim((string) $source[$key]);
    if ($value === '') {
        return null;
    }
    if (mb_strlen($value) > $max) {
        fail('field_too_long', "'{$key}' must be {$max} characters or fewer.", 422, ['field' => $key]);
    }
    return $value;
}

function need_enum(array $source, string $key, array $allowed): string
{
    $value = (string) ($source[$key] ?? '');
    if (!in_array($value, $allowed, true)) {
        fail(
            'invalid_value',
            "'{$key}' must be one of: " . implode(', ', $allowed) . '.',
            422,
            ['field' => $key]
        );
    }
    return $value;
}

function need_int(array $source, string $key, int $min = PHP_INT_MIN, int $max = PHP_INT_MAX): int
{
    $raw = $source[$key] ?? null;
    if (!is_numeric($raw)) {
        fail('invalid_value', "'{$key}' must be a number.", 422, ['field' => $key]);
    }
    $value = (int) $raw;
    if ($value < $min || $value > $max) {
        fail('out_of_range', "'{$key}' must be between {$min} and {$max}.", 422, ['field' => $key]);
    }
    return $value;
}

/** Money in, rounded to pence. Rejects negatives unless explicitly allowed. */
function need_money(array $source, string $key, bool $allowNegative = false): string
{
    $raw = $source[$key] ?? null;
    if (!is_numeric($raw)) {
        fail('invalid_value', "'{$key}' must be an amount.", 422, ['field' => $key]);
    }
    $value = round((float) $raw, 2);
    if (!$allowNegative && $value < 0) {
        fail('invalid_value', "'{$key}' cannot be negative.", 422, ['field' => $key]);
    }
    // Returned as a string so it binds to DECIMAL without a float round-trip.
    return number_format($value, 2, '.', '');
}

function need_email(array $source, string $key): string
{
    $value = strtolower(trim((string) ($source[$key] ?? '')));
    if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
        fail('invalid_email', 'That email address does not look right.', 422, ['field' => $key]);
    }
    return $value;
}

/**
 * A UK phone number, loosely.
 *
 * Deliberately permissive: the shop needs to ring the customer back, and
 * rejecting a valid-but-unusual number costs a real order. Strips formatting
 * and checks it is a plausible length.
 */
function need_phone(array $source, string $key): string
{
    $raw = (string) ($source[$key] ?? '');
    $digits = preg_replace('/[^0-9+]/', '', $raw) ?? '';

    if (strlen(preg_replace('/[^0-9]/', '', $digits) ?? '') < 9) {
        fail('invalid_phone', 'Please enter a contact phone number.', 422, ['field' => $key]);
    }
    if (mb_strlen($digits) > 20) {
        fail('invalid_phone', 'That phone number is too long.', 422, ['field' => $key]);
    }

    return $digits;
}

/**
 * A slug id such as 'beef-burgers' or 'sauceChoice'.
 *
 * These land in URLs and primary keys, so the character set is restricted
 * rather than escaped at every use site.
 */
function need_slug(array $source, string $key, int $max = 64): string
{
    $value = trim((string) ($source[$key] ?? ''));
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,' . ($max - 1) . '}$/', $value)) {
        fail(
            'invalid_id',
            "'{$key}' may only contain letters, numbers, hyphens and underscores.",
            422,
            ['field' => $key]
        );
    }
    return $value;
}

function need_bool(array $source, string $key, bool $default = false): bool
{
    if (!array_key_exists($key, $source)) {
        return $default;
    }
    return filter_var($source[$key], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? $default;
}

/** An ISO-8601 timestamp from the client, normalised to a UTC MySQL DATETIME. */
function opt_datetime(array $source, string $key): ?string
{
    $raw = opt_string($source, $key, 40);
    if ($raw === null) {
        return null;
    }
    $timestamp = strtotime($raw);
    if ($timestamp === false) {
        fail('invalid_date', "'{$key}' is not a valid date.", 422, ['field' => $key]);
    }
    return gmdate('Y-m-d H:i:s', $timestamp);
}
