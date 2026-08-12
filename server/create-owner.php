<?php
/**
 * Creates the first owner account.
 *
 * There is deliberately no "sign up" endpoint — a public one on a takeaway
 * admin panel is an open door. This runs from the cPanel Terminal (or via
 * SSH) instead:
 *
 *   php create-owner.php "you@example.com" "Your Name"
 *
 * It prompts for the password rather than taking it as an argument, because
 * command-line arguments are visible in the process list and land in your
 * shell history.
 *
 * Delete this file after the first owner exists. It refuses to run once an
 * owner is present anyway, but there is no reason to leave it on the server.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit("This script only runs from the command line.\n");
}

require __DIR__ . '/api/lib/bootstrap.php';
require __DIR__ . '/api/lib/http.php';
require __DIR__ . '/api/lib/auth.php';

// `fail()` from http.php emits JSON and exits, which is wrong for a CLI tool.
function die_with(string $message): never
{
    fwrite(STDERR, "\n  ERROR: {$message}\n\n");
    exit(1);
}

$email = $argv[1] ?? null;
$name  = $argv[2] ?? null;

if (!$email || !$name) {
    echo "\n  Usage: php create-owner.php \"you@example.com\" \"Your Name\"\n\n";
    exit(1);
}

$email = strtolower(trim($email));
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    die_with('That is not a valid email address.');
}

try {
    db()->query('SELECT 1 FROM users LIMIT 1');
} catch (Throwable $e) {
    die_with(
        "Could not read the users table. Import schema.sql first.\n" .
        '  (' . $e->getMessage() . ')'
    );
}

$existingOwner = db_one("SELECT email FROM users WHERE role = 'owner' AND is_active = 1");
if ($existingOwner) {
    die_with(
        "An owner account already exists ({$existingOwner['email']}).\n" .
        "  Add further staff from the admin panel, or reset a password there.\n" .
        '  You can safely delete this script now.'
    );
}

if (db_one('SELECT id FROM users WHERE email = ?', [$email])) {
    die_with('An account with that email already exists.');
}

// ── Password prompt ────────────────────────────────────────────────────────

/** Read without echoing, so the password is not left on screen. */
function prompt_hidden(string $label): string
{
    echo $label;

    // `stty -echo` works in the cPanel Terminal and over SSH. Where it is not
    // available the input is visible — warned about rather than silently
    // leaking, so the operator can decide.
    $stty = @shell_exec('stty -g 2>/dev/null');
    $canHide = is_string($stty) && trim($stty) !== '';

    if ($canHide) {
        shell_exec('stty -echo');
    } else {
        echo "\n  (warning: this terminal will show what you type)\n  ";
    }

    $value = rtrim((string) fgets(STDIN), "\r\n");

    if ($canHide) {
        shell_exec('stty ' . trim($stty));
        echo "\n";
    }

    return $value;
}

echo "\n  Creating the owner account for Eat On.\n";
echo "  Email: {$email}\n";
echo "  Name:  {$name}\n\n";

$password = prompt_hidden('  Password (min 10 characters): ');
$confirm  = prompt_hidden('  Confirm password:             ');

if ($password !== $confirm) {
    die_with('Those passwords do not match.');
}
if (mb_strlen($password) < 10) {
    die_with('Password must be at least 10 characters.');
}

db_run(
    "INSERT INTO users (email, password_hash, name, role, is_active) VALUES (?, ?, ?, 'owner', 1)",
    [$email, hash_password($password), trim($name)]
);

echo "\n  ✓ Owner account created.\n";
echo "    Sign in at " . rtrim((string) config('site_url'), '/') . "/admin\n";
echo "\n  Now delete this file:  rm " . __FILE__ . "\n\n";
