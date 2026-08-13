<?php
/**
 * Deployment self-check.
 *
 * Upload to public_html/ and open https://yourdomain/diagnose.php
 *
 * Reports what the API can actually see: whether the config is where PHP
 * looks for it, whether the database answers, and whether the tables exist.
 * A blank 500 from the API tells you nothing; this tells you which of those
 * three is wrong.
 *
 * DELETE IT once the site works. It reveals paths and PHP version, which is
 * free reconnaissance for anyone who finds it. It deliberately never prints
 * the database password.
 */

header('Content-Type: text/plain; charset=utf-8');

function line(string $label, string $status, string $detail = ''): void
{
    printf("%-6s %-34s %s\n", $status, $label, $detail);
}

echo "Eat On — deployment check\n";
echo str_repeat('=', 72), "\n\n";

echo "PHP " . PHP_VERSION . "\n";
echo "This file: " . __FILE__ . "\n\n";

// ── 1. Where does the API look for the config? ─────────────────────────────
// public_html/diagnose.php is one level shallower than api/lib/, so the
// candidates are computed from where the API actually lives.

$apiLib = __DIR__ . '/api/lib';
echo "1. CONFIG\n";
echo str_repeat('-', 72), "\n";

if (!is_dir($apiLib)) {
    line('api/lib directory', 'FAIL', $apiLib . ' does not exist — the API did not upload');
    echo "\nStop here. Re-upload the api folder.\n";
    exit;
}
line('api/lib directory', 'ok', $apiLib);

$candidates = [
    dirname($apiLib, 3) . '/eaton-config.php',
    dirname($apiLib, 4) . '/eaton-config.php',
    dirname($apiLib, 2) . '/config.php',
];

$found = null;
foreach ($candidates as $path) {
    if (is_readable($path)) {
        $found = $path;
        line('config found', 'ok', $path);
        break;
    }
    line('not here', '  --', $path);
}

if ($found === null) {
    echo "\nFAIL: no config file in any location the API checks.\n";
    echo "Put eaton-config.php in:  " . $candidates[0] . "\n";
    echo "That is the directory CONTAINING public_html, not inside it.\n";
    exit;
}

$config = require $found;
if (!is_array($config)) {
    echo "\nFAIL: the config file did not return an array. It must start with <?php return [\n";
    exit;
}

foreach (['db', 'site_url', 'uploads_path'] as $key) {
    line("config.{$key}", isset($config[$key]) ? 'ok' : 'FAIL', isset($config[$key]) ? '' : 'missing');
}

$siteUrl = (string) ($config['site_url'] ?? '');
line('site_url', str_starts_with($siteUrl, 'https://') ? 'ok' : 'WARN', $siteUrl);
if (str_ends_with($siteUrl, '/')) {
    echo "   WARNING: site_url ends with a slash. Remove it, or admin writes return 403.\n";
}

// Placeholders left in place are a common half-finished deploy.
foreach (['db' => 'password', 'paypal' => 'secret'] as $section => $key) {
    $value = (string) ($config[$section][$key] ?? '');
    if (str_contains($value, 'CHANGE_ME')) {
        line("config.{$section}.{$key}", 'WARN', 'still a CHANGE_ME placeholder');
    }
}

// ── 2. Database ────────────────────────────────────────────────────────────

echo "\n2. DATABASE\n";
echo str_repeat('-', 72), "\n";

$db = $config['db'] ?? [];
line('host / name', 'info', ($db['host'] ?? '?') . ' / ' . ($db['name'] ?? '?'));
line('user', 'info', $db['user'] ?? '?');

try {
    $pdo = new PDO(
        sprintf('mysql:host=%s;dbname=%s;charset=%s', $db['host'] ?? 'localhost', $db['name'] ?? '', $db['charset'] ?? 'utf8mb4'),
        $db['user'] ?? '',
        $db['password'] ?? '',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5]
    );
    line('connection', 'ok', 'connected');

    $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    line('tables', count($tables) >= 18 ? 'ok' : 'FAIL', count($tables) . ' found (expect 18)');

    if (count($tables) < 18) {
        echo "   Import schema.sql in phpMyAdmin.\n";
    } else {
        foreach (['items' => 18, 'categories' => 7, 'users' => null] as $table => $expected) {
            $n = (int) $pdo->query("SELECT COUNT(*) FROM `{$table}`")->fetchColumn();
            $status = $expected === null ? 'info' : ($n === $expected ? 'ok' : 'WARN');
            line("  {$table}", $status, $n . ' rows' . ($expected ? " (expect {$expected})" : ''));
        }
        if ((int) $pdo->query("SELECT COUNT(*) FROM users WHERE role='owner' AND is_active=1")->fetchColumn() === 0) {
            echo "   No active owner account — run create-owner.php.\n";
        }
    }
} catch (Throwable $e) {
    line('connection', 'FAIL', $e->getMessage());
    echo "\n   Check the database name, user and password in the config.\n";
    echo "   cPanel prefixes both with your account, e.g. user_eaton.\n";
    echo "   Also confirm the user was added to the database with ALL PRIVILEGES.\n";
}

// ── 3. Files and permissions ───────────────────────────────────────────────

echo "\n3. FILES\n";
echo str_repeat('-', 72), "\n";

foreach ([
    'api/index.php'        => __DIR__ . '/api/index.php',
    'api/.htaccess'        => __DIR__ . '/api/.htaccess',
    '.htaccess (root)'     => __DIR__ . '/.htaccess',
    'index.html'           => __DIR__ . '/index.html',
] as $label => $path) {
    line($label, is_readable($path) ? 'ok' : 'FAIL', is_readable($path) ? '' : 'missing');
}

$uploads = (string) ($config['uploads_path'] ?? '');
if ($uploads === '') {
    line('uploads_path', 'FAIL', 'not set in config');
} elseif (!is_dir($uploads)) {
    line('uploads_path', 'FAIL', $uploads . ' does not exist');
} else {
    line('uploads_path', is_writable($uploads) ? 'ok' : 'FAIL', $uploads . (is_writable($uploads) ? '' : ' is not writable — set it to 755'));
}

echo "\n", str_repeat('=', 72), "\n";
echo "Anything marked FAIL above is why the API returns 500.\n";
echo "Delete this file once the site works.\n";
