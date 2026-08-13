<?php
/**
 * Shared bootstrap — config loading, error handling, PDO, sessions.
 *
 * Every request enters through index.php, which requires this first.
 */

declare(strict_types=1);

/*
 * ORDER MATTERS HERE.
 *
 * The error handlers are installed BEFORE the config is loaded. They used to
 * come after, which meant a missing or unreadable config file threw an
 * uncaught exception and the server returned a blank 500 with no clue what
 * was wrong — the single most likely thing to go wrong on a fresh deploy, and
 * the one failure that told you nothing.
 */

// ── Error handling ─────────────────────────────────────────────────────────

// Errors are logged, never printed: a stray warning in the output stream
// corrupts the JSON body, so the front end sees a parse error instead of the
// real problem.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

/**
 * Is this a development environment?
 *
 * Read defensively: this is called from the exception handler, which must
 * work even when the config is the thing that failed to load.
 */
function is_production(): bool
{
    $config = $GLOBALS['eaton_config'] ?? null;
    if (!is_array($config)) {
        // No config means we cannot know — assume production and say little.
        return true;
    }
    return ($config['env'] ?? 'production') !== 'development';
}

// Turn warnings/notices into exceptions so a bad array key fails loudly in
// development instead of producing half-correct data.
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

set_exception_handler(static function (Throwable $e): void {
    error_log(sprintf(
        "[eaton] %s: %s in %s:%d\n%s",
        get_class($e),
        $e->getMessage(),
        $e->getFile(),
        $e->getLine(),
        $e->getTraceAsString()
    ));

    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }

    // A setup fault — no config, no database — is not a customer's problem to
    // read around, but it IS the operator's problem to diagnose. The code is
    // machine-readable and safe; the detail only appears in development.
    $isSetupFault = $e instanceof EatonSetupError;

    echo json_encode([
        'error'   => $isSetupFault ? 'not_configured' : 'server_error',
        'message' => $isSetupFault
            ? 'The site is not finished being set up. See the server error log.'
            : (is_production() ? 'Something went wrong. Please try again.' : $e->getMessage()),
        'detail'  => is_production() ? null : $e->getMessage(),
    ]);
    exit;
});

/** Thrown when the server is misconfigured rather than merely broken. */
class EatonSetupError extends RuntimeException {}

// ── Config ─────────────────────────────────────────────────────────────────

/**
 * Find and load the configuration.
 *
 * It lives above the web root so that a server which stops executing PHP
 * cannot serve the database password as plain text.
 *
 * From public_html/api/lib the home directory is three levels up. The fourth
 * candidate is a deliberate over-reach for unusual layouts, and the local
 * server/config.php lets the API run under `php -S` during development.
 */
function eaton_load_config(): array
{
    $candidates = [
        dirname(__DIR__, 3) . '/eaton-config.php',  // /home/user/eaton-config.php
        dirname(__DIR__, 4) . '/eaton-config.php',  // one level higher again
        dirname(__DIR__, 2) . '/config.php',        // server/config.php (local dev)
    ];

    foreach ($candidates as $path) {
        if (is_readable($path)) {
            $config = require $path;
            if (!is_array($config)) {
                throw new EatonSetupError("Config at {$path} did not return an array.");
            }
            return $config;
        }
    }

    throw new EatonSetupError(
        'Config not found. Looked in: ' . implode(', ', $candidates) . '. ' .
        'Copy server/config.example.php to eaton-config.php in the directory ' .
        'that CONTAINS public_html, and fill it in.'
    );
}

$GLOBALS['eaton_config'] = eaton_load_config();

function config(string $key, $default = null)
{
    // Dot path: config('db.host'), config('paypal.secret').
    $value = $GLOBALS['eaton_config'];
    foreach (explode('.', $key) as $segment) {
        if (!is_array($value) || !array_key_exists($segment, $value)) {
            return $default;
        }
        $value = $value[$segment];
    }
    return $value;
}

// Now that the config is loaded, point the log where it asked. Until this
// runs, errors go to the server's default log — which is where a config
// failure will have been recorded.
$errorLog = config('error_log');
if ($errorLog) {
    $dir = dirname($errorLog);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    ini_set('error_log', $errorLog);
}

// ── Database ───────────────────────────────────────────────────────────────

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        config('db.host', 'localhost'),
        config('db.name'),
        config('db.charset', 'utf8mb4')
    );

    $pdo = new PDO($dsn, config('db.user'), config('db.password'), [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        // Real prepared statements, not client-side interpolation — this is
        // what actually makes the parameter binding injection-proof.
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::ATTR_STRINGIFY_FETCHES  => false,
    ]);

    // Store and compare everything in UTC; convert for display only.
    $pdo->exec("SET time_zone = '+00:00'");

    return $pdo;
}

/** Run a query and return every row. */
function db_all(string $sql, array $params = []): array
{
    $statement = db()->prepare($sql);
    $statement->execute($params);
    return $statement->fetchAll();
}

/** Run a query and return the first row, or null. */
function db_one(string $sql, array $params = []): ?array
{
    $statement = db()->prepare($sql);
    $statement->execute($params);
    $row = $statement->fetch();
    return $row === false ? null : $row;
}

/** Run a statement and return the number of affected rows. */
function db_run(string $sql, array $params = []): int
{
    $statement = db()->prepare($sql);
    $statement->execute($params);
    return $statement->rowCount();
}

/** Wrap a callable in a transaction, rolling back on any throw. */
function db_transaction(callable $work)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $work($pdo);
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

// ── Sessions ───────────────────────────────────────────────────────────────

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $lifetime = (int) config('session.lifetime', 28800);
    $secure   = str_starts_with((string) config('site_url', ''), 'https://');

    session_set_cookie_params([
        'lifetime' => $lifetime,
        'path'     => '/',
        'secure'   => $secure,
        // The cookie must be unreadable from JavaScript: an XSS bug should not
        // hand over an admin session.
        'httponly' => true,
        // The admin panel is same-origin with the API, so Lax costs nothing
        // and blocks cross-site request forgery from another tab.
        'samesite' => 'Lax',
    ]);

    session_name((string) config('session.name', 'eaton_admin'));
    session_start();

    // Rotate the id periodically so a leaked id has a short useful life.
    if (!isset($_SESSION['created_at'])) {
        $_SESSION['created_at'] = time();
    } elseif (time() - $_SESSION['created_at'] > 1800) {
        session_regenerate_id(true);
        $_SESSION['created_at'] = time();
    }
}

// ── Misc ───────────────────────────────────────────────────────────────────

/** Client IP packed for the VARBINARY(16) columns; null if unparseable. */
function client_ip_binary(): ?string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $packed = @inet_pton($ip);
    return $packed === false ? null : $packed;
}

function utc_now(): string
{
    return gmdate('Y-m-d H:i:s');
}

/** ISO-8601 in UTC, which is what the React app expects to parse. */
function to_iso8601(?string $mysqlDatetime): ?string
{
    if ($mysqlDatetime === null || $mysqlDatetime === '') {
        return null;
    }
    return gmdate('c', strtotime($mysqlDatetime . ' UTC'));
}
