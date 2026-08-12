<?php
/**
 * Authentication and role-based permissions.
 *
 * This replaces the client-side passcode gate entirely. Two rules matter:
 *
 *   1. The browser is never trusted about who it is. Identity comes from the
 *      server session, looked up fresh against the database on every request,
 *      so deactivating a member of staff takes effect immediately rather than
 *      whenever their session happens to expire.
 *   2. Every write endpoint declares the permission it needs. There is no
 *      "logged in means allowed" shortcut — a kitchen tablet signed in as
 *      `staff` must not be able to edit prices.
 */

declare(strict_types=1);

// ── Roles ──────────────────────────────────────────────────────────────────

const ROLE_OWNER   = 'owner';
const ROLE_MANAGER = 'manager';
const ROLE_STAFF   = 'staff';

const ROLES = [ROLE_OWNER, ROLE_MANAGER, ROLE_STAFF];

/**
 * What each role may do.
 *
 * `staff` is intentionally tiny: the kitchen screen sees and advances orders
 * and nothing else. Widening a role is a one-line change here, which is the
 * point of keeping the matrix in one place rather than scattering role checks
 * through the endpoints.
 */
const PERMISSIONS = [
    ROLE_OWNER => [
        'orders.view', 'orders.update', 'orders.refund',
        'menu.manage', 'hours.manage', 'banners.manage', 'promo.manage',
        'images.manage', 'reports.view', 'staff.manage', 'settings.manage',
    ],
    ROLE_MANAGER => [
        'orders.view', 'orders.update', 'orders.refund',
        'menu.manage', 'hours.manage', 'banners.manage', 'promo.manage',
        'images.manage', 'reports.view',
        // No staff.manage: a manager must not be able to promote themselves
        // to owner, or lock the owner out.
        // No settings.manage: fees, geofence and payment config are the
        // owner's call.
    ],
    ROLE_STAFF => [
        'orders.view', 'orders.update',
    ],
];

function role_permissions(string $role): array
{
    return PERMISSIONS[$role] ?? [];
}

// ── Current user ───────────────────────────────────────────────────────────

/**
 * The signed-in user, or null.
 *
 * Re-read from the database each request (cached per request) so role changes
 * and deactivations apply without waiting for the session to lapse.
 */
function current_user(): ?array
{
    static $user = null;
    static $loaded = false;

    if ($loaded) {
        return $user;
    }
    $loaded = true;

    start_session();

    $userId = $_SESSION['user_id'] ?? null;
    if (!$userId) {
        return $user = null;
    }

    $row = db_one(
        'SELECT id, email, name, role, is_active FROM users WHERE id = ?',
        [$userId]
    );

    // Deleted or deactivated mid-session: drop the session rather than leaving
    // a half-valid identity around.
    if (!$row || (int) $row['is_active'] !== 1) {
        logout_user();
        return $user = null;
    }

    return $user = [
        'id'          => (int) $row['id'],
        'email'       => $row['email'],
        'name'        => $row['name'],
        'role'        => $row['role'],
        'permissions' => role_permissions($row['role']),
    ];
}

function login_user(int $userId): void
{
    start_session();
    // A fresh id on privilege change defeats session fixation.
    session_regenerate_id(true);
    $_SESSION['user_id']    = $userId;
    $_SESSION['created_at'] = time();

    db_run('UPDATE users SET last_login_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?', [
        utc_now(),
        $userId,
    ]);
}

function logout_user(): void
{
    start_session();
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 42000,
            'path'     => $params['path'],
            'secure'   => $params['secure'],
            'httponly' => $params['httponly'],
            'samesite' => $params['samesite'] ?? 'Lax',
        ]);
    }

    session_destroy();
}

// ── Guards ─────────────────────────────────────────────────────────────────

/** Require a signed-in user; returns them. */
function require_auth(): array
{
    $user = current_user();
    if (!$user) {
        fail('unauthenticated', 'Please sign in.', 401);
    }
    return $user;
}

/** Require a specific permission; returns the user. */
function require_permission(string $permission): array
{
    $user = require_auth();

    if (!in_array($permission, $user['permissions'], true)) {
        // 403, not 404: the caller is known, they simply may not do this.
        fail(
            'forbidden',
            'Your account does not have permission to do that.',
            403,
            ['required' => $permission]
        );
    }

    return $user;
}

function user_can(string $permission): bool
{
    $user = current_user();
    return $user !== null && in_array($permission, $user['permissions'], true);
}

// ── Passwords ──────────────────────────────────────────────────────────────

/**
 * Minimum password rules.
 *
 * Length beats character-class rules for real-world strength, so this asks for
 * 10 characters and does not demand a symbol the user will write on a sticky
 * note. The common-password check blocks the handful that get used anyway.
 */
function validate_password(string $password): void
{
    if (mb_strlen($password) < 10) {
        fail('weak_password', 'Password must be at least 10 characters.', 422, ['field' => 'password']);
    }
    if (mb_strlen($password) > 200) {
        fail('weak_password', 'Password must be 200 characters or fewer.', 422, ['field' => 'password']);
    }

    $common = ['password12', 'password123', '1234567890', 'qwertyuiop', 'letmein123', 'eatonfoods'];
    if (in_array(strtolower($password), $common, true)) {
        fail('weak_password', 'That password is too easy to guess.', 422, ['field' => 'password']);
    }
}

function hash_password(string $password): string
{
    // PASSWORD_DEFAULT tracks PHP's current best (bcrypt today, argon2 later)
    // and verify() reads whatever a stored hash used, so this upgrades safely.
    return password_hash($password, PASSWORD_DEFAULT);
}

// ── Login throttling ───────────────────────────────────────────────────────

const LOGIN_MAX_PER_IP     = 10;   // within the window
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_PER_USER   = 5;    // before the account locks
const LOGIN_LOCK_MINUTES   = 15;

/** Refuse if this IP has been guessing. Called before any password check. */
function assert_login_allowed(?string $email): void
{
    $ip = client_ip_binary();
    if ($ip === null) {
        return;
    }

    $row = db_one(
        'SELECT COUNT(*) AS failures FROM login_attempts
          WHERE ip = ? AND succeeded = 0 AND attempted_at > (UTC_TIMESTAMP() - INTERVAL ? MINUTE)',
        [$ip, LOGIN_WINDOW_MINUTES]
    );

    if ($row && (int) $row['failures'] >= LOGIN_MAX_PER_IP) {
        fail(
            'rate_limited',
            'Too many sign-in attempts. Please wait 15 minutes and try again.',
            429
        );
    }

    if ($email === null) {
        return;
    }

    $user = db_one('SELECT locked_until FROM users WHERE email = ?', [$email]);
    if ($user && $user['locked_until'] !== null && strtotime($user['locked_until'] . ' UTC') > time()) {
        fail(
            'account_locked',
            'This account is temporarily locked after too many failed attempts.',
            429
        );
    }
}

function record_login_attempt(?string $email, bool $succeeded): void
{
    $ip = client_ip_binary();
    if ($ip !== null) {
        db_run(
            'INSERT INTO login_attempts (ip, email, succeeded) VALUES (?, ?, ?)',
            [$ip, $email, $succeeded ? 1 : 0]
        );
    }

    if ($email === null || $succeeded) {
        return;
    }

    // Count this account's failures up, and lock once over the limit.
    db_run(
        'UPDATE users
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE
                    WHEN failed_attempts + 1 >= ?
                    THEN (UTC_TIMESTAMP() + INTERVAL ? MINUTE)
                    ELSE locked_until
                END
          WHERE email = ?',
        [LOGIN_MAX_PER_USER, LOGIN_LOCK_MINUTES, $email]
    );
}

/** Housekeeping so the table does not grow without bound. */
function prune_login_attempts(): void
{
    // Cheap, and only ~1 in 50 requests pays for it.
    if (random_int(1, 50) !== 1) {
        return;
    }
    db_run('DELETE FROM login_attempts WHERE attempted_at < (UTC_TIMESTAMP() - INTERVAL 1 DAY)');
}

// ── CSRF ───────────────────────────────────────────────────────────────────

/**
 * Reject cross-site state changes.
 *
 * The session cookie is SameSite=Lax, which already blocks cross-site POSTs
 * from carrying it. This is the belt to that braces: any state-changing
 * request must come from our own origin.
 */
function assert_same_origin(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }

    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if ($origin === null) {
        // Older browsers omit Origin on same-origin requests; fall back to
        // Referer, and allow the request if neither header is present rather
        // than breaking legitimate clients.
        $referer = $_SERVER['HTTP_REFERER'] ?? null;
        if ($referer === null) {
            return;
        }
        $origin = parse_url($referer, PHP_URL_SCHEME) . '://' . parse_url($referer, PHP_URL_HOST);
        $port = parse_url($referer, PHP_URL_PORT);
        if ($port) {
            $origin .= ':' . $port;
        }
    }

    $origin = rtrim($origin, '/');

    foreach (allowed_origins() as $allowed) {
        if ($origin === $allowed) {
            return;
        }
    }

    fail('bad_origin', 'Request blocked.', 403);
}

/**
 * Origins permitted to make state-changing requests.
 *
 * Production is exactly one: the site itself.
 *
 * Development also accepts the other loopback spelling. `localhost` and
 * `127.0.0.1` are different origins to a browser, and a developer who opens
 * the "wrong" one otherwise gets an opaque 403 on every write — which looks
 * like a broken login rather than a URL mismatch.
 */
function allowed_origins(): array
{
    $siteUrl = rtrim((string) config('site_url', ''), '/');

    $origins = $siteUrl === '' ? [] : [$siteUrl];

    if (is_production()) {
        return $origins;
    }

    foreach ($origins as $origin) {
        $swapped = str_contains($origin, '//localhost')
            ? str_replace('//localhost', '//127.0.0.1', $origin)
            : str_replace('//127.0.0.1', '//localhost', $origin);

        if ($swapped !== $origin) {
            $origins[] = $swapped;
        }
    }

    return array_values(array_unique($origins));
}
