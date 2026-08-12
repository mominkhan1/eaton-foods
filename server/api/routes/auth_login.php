<?php
/**
 * POST /api/auth/login
 *
 * Replaces the client-side passcode. Throttled per IP and per account.
 */

declare(strict_types=1);

$input = body();
$email = strtolower(trim((string) ($input['email'] ?? '')));
$password = (string) ($input['password'] ?? '');

if ($email === '' || $password === '') {
    fail('missing_credentials', 'Please enter your email and password.', 422);
}

assert_login_allowed($email);

$user = db_one(
    'SELECT id, email, name, role, password_hash, is_active FROM users WHERE email = ?',
    [$email]
);

// One generic message for "no such user" and "wrong password" — telling an
// attacker which emails exist is free reconnaissance. The timing difference is
// covered by hashing a dummy value when the user is missing.
$genericFailure = static function () use ($email): void {
    record_login_attempt($email, false);
    fail('invalid_credentials', 'That email or password is not right.', 401);
};

if (!$user) {
    // Constant-ish work so a missing account is not detectably faster.
    password_verify($password, '$2y$10$usesomesillystringforsalttoavoidtimingleaksxxxxxxxxxxxxxx');
    $genericFailure();
}

if (!password_verify($password, $user['password_hash'])) {
    $genericFailure();
}

if ((int) $user['is_active'] !== 1) {
    record_login_attempt($email, false);
    fail('account_disabled', 'This account has been disabled. Ask the owner to re-enable it.', 403);
}

// Opportunistically upgrade the hash if PHP's default has moved on.
if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
    db_run('UPDATE users SET password_hash = ? WHERE id = ?', [
        hash_password($password),
        $user['id'],
    ]);
}

record_login_attempt($email, true);
login_user((int) $user['id']);

json_response([
    'user' => [
        'id'          => (int) $user['id'],
        'email'       => $user['email'],
        'name'        => $user['name'],
        'role'        => $user['role'],
        'permissions' => role_permissions($user['role']),
    ],
]);
