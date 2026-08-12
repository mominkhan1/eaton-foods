<?php
/**
 * Create or update a staff account from the command line.
 *
 * Unlike create-owner.php, which bootstraps the very first account and then
 * refuses to run, this manages accounts at any time and handles all three
 * roles. Useful until the admin panel grows a staff screen, and afterwards as
 * the way back in when someone locks themselves out.
 *
 *   php create-user.php list
 *   php create-user.php add    kitchen@eaton.food "Kitchen Tablet" staff
 *   php create-user.php passwd kitchen@eaton.food
 *   php create-user.php role   sam@eaton.food manager
 *   php create-user.php disable sam@eaton.food
 *   php create-user.php enable  sam@eaton.food
 *
 * Passwords are always prompted for, never passed as arguments — arguments
 * are visible in the process list and land in shell history.
 *
 * Roles:
 *   owner    everything, including staff management and revenue
 *   manager  menu, hours, banners, promo, orders, reports
 *   staff    orders only — the kitchen screen
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit("This script only runs from the command line.\n");
}

require __DIR__ . '/api/lib/bootstrap.php';
require __DIR__ . '/api/lib/http.php';
require __DIR__ . '/api/lib/auth.php';

function out(string $line = ''): void
{
    echo $line . "\n";
}

function die_with(string $message): never
{
    fwrite(STDERR, "\n  ERROR: {$message}\n\n");
    exit(1);
}

function usage(): never
{
    out();
    out('  Usage:');
    out('    php create-user.php list');
    out('    php create-user.php add     <email> <"Full Name"> <owner|manager|staff>');
    out('    php create-user.php passwd  <email>');
    out('    php create-user.php role    <email> <owner|manager|staff>');
    out('    php create-user.php disable <email>');
    out('    php create-user.php enable  <email>');
    out();
    exit(1);
}

/** Read without echoing, so the password is not left on screen. */
function prompt_password(string $label): string
{
    echo $label;

    $stty = @shell_exec('stty -g 2>/dev/null');
    $canHide = is_string($stty) && trim($stty) !== '';

    if ($canHide) {
        shell_exec('stty -echo');
    } else {
        out();
        echo '  (warning: this terminal will show what you type)' . "\n  ";
    }

    $value = rtrim((string) fgets(STDIN), "\r\n");

    if ($canHide) {
        shell_exec('stty ' . trim($stty));
        out();
    }

    return $value;
}

function ask_for_new_password(): string
{
    $password = prompt_password('  Password (min 10 characters): ');
    $confirm  = prompt_password('  Confirm password:             ');

    if ($password !== $confirm) {
        die_with('Those passwords do not match.');
    }
    if (mb_strlen($password) < 10) {
        die_with('Password must be at least 10 characters.');
    }

    return $password;
}

function find_user(string $email): array
{
    $user = db_one('SELECT id, email, name, role, is_active FROM users WHERE email = ?', [$email]);
    if (!$user) {
        die_with("No account with the email {$email}. Run 'list' to see what exists.");
    }
    return $user;
}

/**
 * Refuse a change that would leave the shop with no way in.
 *
 * The API enforces this too, but someone at a terminal bypasses the API — and
 * an admin panel nobody can sign into is a genuinely expensive mistake.
 */
function assert_owner_remains(int $excludingId): void
{
    $others = db_one(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND is_active = 1 AND id <> ?",
        [$excludingId]
    );

    if ((int) ($others['n'] ?? 0) === 0) {
        die_with(
            "That would leave no active owner, locking everyone out of the admin panel.\n" .
            '  Promote someone else to owner first.'
        );
    }
}

$command = $argv[1] ?? null;
$email   = isset($argv[2]) ? strtolower(trim($argv[2])) : null;

if ($command === null) {
    usage();
}

try {
    db()->query('SELECT 1 FROM users LIMIT 1');
} catch (Throwable $e) {
    die_with("Could not read the users table. Import schema.sql first.\n  ({$e->getMessage()})");
}

switch ($command) {
    // ── list ───────────────────────────────────────────────────────────────
    case 'list':
        $rows = db_all('SELECT id, email, name, role, is_active, last_login_at FROM users ORDER BY role, name');

        if ($rows === []) {
            out("\n  No accounts yet. Create one with 'add'.\n");
            break;
        }

        out();
        printf("  %-4s %-32s %-20s %-9s %-9s %s\n", 'ID', 'EMAIL', 'NAME', 'ROLE', 'STATUS', 'LAST LOGIN');
        out('  ' . str_repeat('-', 96));
        foreach ($rows as $r) {
            printf(
                "  %-4s %-32s %-20s %-9s %-9s %s\n",
                $r['id'],
                mb_strimwidth($r['email'], 0, 32, '…'),
                mb_strimwidth($r['name'], 0, 20, '…'),
                $r['role'],
                $r['is_active'] ? 'active' : 'disabled',
                $r['last_login_at'] ?? 'never'
            );
        }
        out();
        break;

    // ── add ────────────────────────────────────────────────────────────────
    case 'add':
        $name = $argv[3] ?? null;
        $role = $argv[4] ?? null;

        if (!$email || !$name || !$role) {
            usage();
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            die_with('That is not a valid email address.');
        }
        if (!in_array($role, ROLES, true)) {
            die_with('Role must be one of: ' . implode(', ', ROLES));
        }
        if (db_one('SELECT id FROM users WHERE email = ?', [$email])) {
            die_with("An account with {$email} already exists. Use 'passwd' or 'role' to change it.");
        }

        out();
        out("  Creating {$role} account for {$name} <{$email}>");
        out();

        $password = ask_for_new_password();

        db_run(
            'INSERT INTO users (email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, 1)',
            [$email, hash_password($password), trim($name), $role]
        );

        out();
        out("  Created. They can sign in at " . rtrim((string) config('site_url'), '/') . '/admin');
        out();
        break;

    // ── passwd ─────────────────────────────────────────────────────────────
    case 'passwd':
        if (!$email) {
            usage();
        }
        $user = find_user($email);

        out();
        out("  Setting a new password for {$user['name']} <{$user['email']}>");
        out();

        $password = ask_for_new_password();

        // Clearing the lockout matters: an account locked by failed attempts
        // still refuses the new password otherwise, which reads as the reset
        // having silently failed.
        db_run(
            'UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?',
            [hash_password($password), $user['id']]
        );

        out();
        out('  Password updated.');
        out();
        break;

    // ── role ───────────────────────────────────────────────────────────────
    case 'role':
        $role = $argv[3] ?? null;
        if (!$email || !$role) {
            usage();
        }
        if (!in_array($role, ROLES, true)) {
            die_with('Role must be one of: ' . implode(', ', ROLES));
        }

        $user = find_user($email);

        if ($user['role'] === ROLE_OWNER && $role !== ROLE_OWNER) {
            assert_owner_remains((int) $user['id']);
        }

        db_run('UPDATE users SET role = ? WHERE id = ?', [$role, $user['id']]);

        out("\n  {$user['email']} is now {$role}.\n");
        break;

    // ── disable / enable ───────────────────────────────────────────────────
    case 'disable':
        if (!$email) {
            usage();
        }
        $user = find_user($email);
        assert_owner_remains((int) $user['id']);

        db_run('UPDATE users SET is_active = 0 WHERE id = ?', [$user['id']]);
        out("\n  {$user['email']} disabled. Any active session is dropped on their next request.\n");
        break;

    case 'enable':
        if (!$email) {
            usage();
        }
        $user = find_user($email);

        db_run(
            'UPDATE users SET is_active = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?',
            [$user['id']]
        );
        out("\n  {$user['email']} enabled.\n");
        break;

    default:
        usage();
}
