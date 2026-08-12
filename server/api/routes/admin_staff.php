<?php
/**
 * Staff accounts. Owner-only, except change_own_password.
 *
 * Two invariants are enforced throughout, because breaking either locks the
 * shop out of its own admin panel:
 *   1. There is always at least one active owner.
 *   2. Nobody can delete or demote themselves.
 */

declare(strict_types=1);

function admin_list_staff(): void
{
    $rows = db_all(
        'SELECT id, email, name, role, is_active, last_login_at, created_at
           FROM users ORDER BY role, name'
    );

    json_response([
        'staff' => array_map(static function (array $row): array {
            return [
                'id'          => (int) $row['id'],
                'email'       => $row['email'],
                'name'        => $row['name'],
                'role'        => $row['role'],
                'isActive'    => (bool) $row['is_active'],
                'lastLoginAt' => to_iso8601($row['last_login_at']),
                'createdAt'   => to_iso8601($row['created_at']),
            ];
        }, $rows),
        'roles' => array_map(
            static fn (string $role): array => ['id' => $role, 'permissions' => role_permissions($role)],
            ROLES
        ),
    ]);
}

function admin_create_staff(): void
{
    $input    = body();
    $email    = need_email($input, 'email');
    $name     = need_string($input, 'name', 120);
    $role     = need_enum($input, 'role', ROLES);
    $password = (string) ($input['password'] ?? '');

    validate_password($password);

    if (db_one('SELECT id FROM users WHERE email = ?', [$email])) {
        fail('email_taken', 'An account with that email already exists.', 409, ['field' => 'email']);
    }

    db_run(
        'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)',
        [$email, hash_password($password), $name, $role]
    );

    json_response(['ok' => true, 'id' => (int) db()->lastInsertId()], 201);
}

function admin_update_staff(int $id): void
{
    $input = body();
    $me    = current_user();

    $target = db_one('SELECT id, email, role, is_active FROM users WHERE id = ?', [$id]);
    if (!$target) {
        fail('not_found', 'No such account.', 404);
    }

    $fields = [];
    $params = [];

    if (isset($input['name'])) {
        $fields[] = 'name = ?';
        $params[] = need_string($input, 'name', 120);
    }

    if (isset($input['email'])) {
        $email = need_email($input, 'email');
        $clash = db_one('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $id]);
        if ($clash) {
            fail('email_taken', 'Another account already uses that email.', 409, ['field' => 'email']);
        }
        $fields[] = 'email = ?';
        $params[] = $email;
    }

    if (isset($input['role'])) {
        $role = need_enum($input, 'role', ROLES);

        // Demoting yourself is how an owner accidentally locks themselves out.
        if ($id === $me['id'] && $role !== $me['role']) {
            fail('cannot_change_own_role', 'You cannot change your own role.', 409);
        }
        assert_owner_remains($id, $role, null);

        $fields[] = 'role = ?';
        $params[] = $role;
    }

    if (isset($input['isActive'])) {
        $isActive = need_bool($input, 'isActive', true);

        if ($id === $me['id'] && !$isActive) {
            fail('cannot_disable_self', 'You cannot disable your own account.', 409);
        }
        assert_owner_remains($id, null, $isActive);

        $fields[] = 'is_active = ?';
        $params[] = $isActive ? 1 : 0;
        // Clear a lockout as a side effect of re-enabling — otherwise the
        // account is re-enabled but still refuses to sign in, which reads
        // as a bug.
        if ($isActive) {
            $fields[] = 'failed_attempts = 0';
            $fields[] = 'locked_until = NULL';
        }
    }

    // An owner resetting someone's password does not need to know the old one.
    if (isset($input['password']) && (string) $input['password'] !== '') {
        validate_password((string) $input['password']);
        $fields[] = 'password_hash = ?';
        $params[] = hash_password((string) $input['password']);
    }

    if ($fields === []) {
        fail('nothing_to_update', 'No changes were supplied.', 422);
    }

    $params[] = $id;
    db_run('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);

    json_response(['ok' => true]);
}

function admin_delete_staff(int $id): void
{
    $me = current_user();

    if ($id === $me['id']) {
        fail('cannot_delete_self', 'You cannot delete your own account.', 409);
    }

    $target = db_one('SELECT id, role FROM users WHERE id = ?', [$id]);
    if (!$target) {
        fail('not_found', 'No such account.', 404);
    }

    assert_owner_remains($id, null, false);

    // order_events.user_id is ON DELETE SET NULL, so the audit trail survives
    // the account being removed.
    db_run('DELETE FROM users WHERE id = ?', [$id]);
    json_response(['ok' => true]);
}

/**
 * Refuse a change that would leave zero active owners.
 *
 * @param int|null    $excludingId Account being changed.
 * @param string|null $newRole     Its role after the change, or null if unchanged.
 * @param bool|null   $newActive   Its active flag after the change, or null.
 */
function assert_owner_remains(int $excludingId, ?string $newRole, ?bool $newActive): void
{
    $others = db_one(
        "SELECT COUNT(*) AS n FROM users
          WHERE role = 'owner' AND is_active = 1 AND id <> ?",
        [$excludingId]
    );

    if ((int) ($others['n'] ?? 0) > 0) {
        return;
    }

    // This account is the last active owner. Allow the change only if it stays
    // an active owner afterwards.
    $staysOwner  = $newRole === null ? true : $newRole === ROLE_OWNER;
    $staysActive = $newActive === null ? true : $newActive;

    if (!$staysOwner || !$staysActive) {
        fail(
            'last_owner',
            'This is the only owner account. Promote someone else to owner first.',
            409
        );
    }
}

/**
 * POST /api/auth/change-password — any signed-in user, own account only.
 *
 * Requires the current password even though the session already proves
 * identity: it stops an unattended logged-in tablet being used to take over
 * the account.
 */
function change_own_password(): void
{
    $me    = current_user();
    $input = body();

    $currentPassword = (string) ($input['currentPassword'] ?? '');
    $newPassword     = (string) ($input['newPassword'] ?? '');

    $row = db_one('SELECT password_hash FROM users WHERE id = ?', [$me['id']]);
    if (!$row || !password_verify($currentPassword, $row['password_hash'])) {
        fail('invalid_credentials', 'Your current password is not right.', 401, [
            'field' => 'currentPassword',
        ]);
    }

    validate_password($newPassword);

    if (password_verify($newPassword, $row['password_hash'])) {
        fail('same_password', 'Please choose a different password.', 422, ['field' => 'newPassword']);
    }

    db_run('UPDATE users SET password_hash = ? WHERE id = ?', [hash_password($newPassword), $me['id']]);

    // A password change should invalidate other sessions; regenerating the id
    // here at least means this device keeps working and the old id is dead.
    session_regenerate_id(true);

    json_response(['ok' => true]);
}
