<?php
/**
 * Shared bootstrap — config loading, error handling, PDO, sessions.
 *
 * Every request enters through index.php, which requires this first.
 */

declare(strict_types=1);

// ── Config ─────────────────────────────────────────────────────────────────

/**
 * The config lives above the web root. From public_html/api/lib/ that is three
 * levels up. A local checkout falls back to server/config.php so the API can
 * be run with `php -S` during development.
 */
function eaton_load_config(): array
{
    $candidates = [
        dirname(__DIR__, 4) . '/eaton-config.php',  // /home/user/eaton-config.php
        dirname(__DIR__, 3) . '/eaton-config.php',  // one level up from public_html
        dirname(__DIR__, 2) . '/config.php',        // server/config.php (local dev)
    ];

    foreach ($candidates as $path) {
        if (is_readable($path)) {
            $config = require $path;
            if (!is_array($config)) {
                throw new RuntimeException("Config at {$path} did not return an array.");
            }
            return $config;
        }
    }

    throw new RuntimeException(
        'Config not found. Copy server/config.example.php to eaton-config.php ' .
        'in your home directory (above public_html) and fill it in.'
    );
}

$GLOBALS['eaton_config'] = eaton_load_config();

function config(string $key, $default = null)
{
    // Dot path: config('db.host'), config('stripe.secret_key').
    $value = $GLOBALS['eaton_config'];
    foreach (explode('.', $key) as $segment) {
        if (!is_array($value) || !array_key_exists($segment, $value)) {
            return $default;
        }
        $value = $value[$segment];
    }
    return $value;
}

function is_production(): bool
{
    return config('env', 'production') !== 'development';
}

// ── Error handling ─────────────────────────────────────────────────────────

// Errors are logged, never printed: a stray warning in the output stream
// corrupts the JSON body and the front end sees a parse error instead of the
// real problem.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

$errorLog = config('error_log');
if ($errorLog) {
    $dir = dirname($errorLog);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    ini_set('error_log', $errorLog);
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

    echo json_encode([
        'error'   => 'server_error',
        'message' => is_production()
            ? 'Something went wrong. Please try again.'
            : $e->getMessage(),
    ]);
    exit;
});

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
