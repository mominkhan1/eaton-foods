<?php
/**
 * One-time owner setup, through the browser.
 *
 * For hosting without a Terminal, where create-user.php cannot be run. Upload
 * to public_html/, use it once, delete it.
 *
 * A page on the open internet that creates an administrator is exactly the
 * kind of thing that gets a site taken over, so it is gated three ways:
 *
 *   1. It refuses once an active owner exists. After the first run it is
 *      inert even if you forget to delete it.
 *   2. It requires a token you add to eaton-config.php, which lives above the
 *      web root. Only someone who can already write files on the server can
 *      supply it — which is someone who could create the account anyway.
 *   3. It refuses to run over plain http, so the password is not sent in the
 *      clear.
 *
 * ── USE ────────────────────────────────────────────────────────────────────
 *
 *   1. Add a line to eaton-config.php:
 *          'setup_token' => 'pick-any-random-string-here',
 *   2. Upload this file to public_html/
 *   3. Open https://yourdomain/setup-owner.php
 *   4. Enter the token and your details
 *   5. DELETE this file, and remove setup_token from the config
 */

declare(strict_types=1);

require __DIR__ . '/api/lib/bootstrap.php';
require __DIR__ . '/api/lib/http.php';
require __DIR__ . '/api/lib/auth.php';

// ── Gates ──────────────────────────────────────────────────────────────────

$errors = [];
$done = false;

$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

$configuredToken = (string) config('setup_token', '');

$existingOwner = db_one("SELECT email FROM users WHERE role = 'owner' AND is_active = 1");

// ── Handle the form ────────────────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$existingOwner && $configuredToken !== '' && $isHttps) {
    $token    = (string) ($_POST['token'] ?? '');
    $email    = strtolower(trim((string) ($_POST['email'] ?? '')));
    $name     = trim((string) ($_POST['name'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
    $confirm  = (string) ($_POST['confirm'] ?? '');

    // Constant-time, so the token cannot be guessed a character at a time.
    if (!hash_equals($configuredToken, $token)) {
        $errors[] = 'That setup token is not right.';
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'Enter a valid email address.';
    }
    if ($name === '') {
        $errors[] = 'Enter your name.';
    }
    if (mb_strlen($password) < 10) {
        $errors[] = 'Password must be at least 10 characters.';
    }
    if ($password !== $confirm) {
        $errors[] = 'The two passwords do not match.';
    }
    if (!$errors && db_one('SELECT id FROM users WHERE email = ?', [$email])) {
        $errors[] = 'An account with that email already exists.';
    }

    if (!$errors) {
        db_run(
            "INSERT INTO users (email, password_hash, name, role, is_active) VALUES (?, ?, ?, 'owner', 1)",
            [$email, hash_password($password), $name]
        );
        $done = true;
    }
}

function h(?string $v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eat On — create the owner account</title>
<style>
  body { margin:0; background:#faf7f6; color:#1c1619; font:16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width: 30rem; margin: 3rem auto; padding: 0 1rem; }
  .card { background:#fff; border:1px solid #e2d9d6; border-radius:14px; padding:1.75rem; }
  h1 { font-size:1.4rem; margin:0 0 .35rem; letter-spacing:-.02em; }
  p.sub { margin:0 0 1.25rem; color:#7d7175; font-size:.94rem; }
  label { display:block; margin-top:1rem; font-size:.85rem; font-weight:600; }
  input { width:100%; box-sizing:border-box; margin-top:.3rem; padding:.6rem .7rem;
          border:1px solid #d9cfcc; border-radius:8px; font-size:1rem; background:#fff; color:#1c1619; }
  input:focus { outline:2px solid #c0392b; outline-offset:1px; border-color:#c0392b; }
  button { width:100%; margin-top:1.5rem; padding:.75rem; border:0; border-radius:8px;
           background:#c0392b; color:#fff; font-size:1rem; font-weight:600; cursor:pointer; }
  button:hover { background:#a83226; }
  .msg { padding:.8rem 1rem; border-radius:8px; margin-bottom:1rem; font-size:.92rem; }
  .bad  { background:#fceceb; color:#b3261e; }
  .good { background:#e8f5ec; color:#15803d; }
  .warn { background:#fdf3e3; color:#a45a09; }
  code { background:#f3eeec; padding:.1em .35em; border-radius:4px; font-size:.88em; }
  ul { margin:.4rem 0 0; padding-left:1.1rem; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>Create the owner account</h1>
    <p class="sub">One-time setup for the Eat On admin panel.</p>

<?php if ($done): ?>
    <div class="msg good">
      <strong>Account created.</strong>
      <ul>
        <li>Sign in at <a href="/admin">/admin</a></li>
        <li><strong>Delete this file now</strong> (<code>setup-owner.php</code>)</li>
        <li>Remove <code>setup_token</code> from <code>eaton-config.php</code></li>
      </ul>
    </div>

<?php elseif ($existingOwner): ?>
    <div class="msg warn">
      An owner account already exists (<code><?= h($existingOwner['email']) ?></code>), so this
      page will not create another. Add further staff from the admin panel.
      <br><br><strong>You can delete this file.</strong>
    </div>

<?php elseif (!$isHttps): ?>
    <div class="msg bad">
      This page refuses to run over plain <code>http</code>, because the password would cross
      the internet unencrypted. Open it with <code>https://</code>, or turn on AutoSSL first.
    </div>

<?php elseif ($configuredToken === ''): ?>
    <div class="msg bad">
      <strong>No setup token configured.</strong>
      Add this line to <code>eaton-config.php</code> (the file above <code>public_html</code>),
      then reload:
      <br><br><code>'setup_token' =&gt; 'choose-a-random-string',</code>
      <br><br>This proves whoever creates the account can already write files on the server.
    </div>

<?php else: ?>
  <?php if ($errors): ?>
    <div class="msg bad">
      <ul><?php foreach ($errors as $e): ?><li><?= h($e) ?></li><?php endforeach; ?></ul>
    </div>
  <?php endif; ?>

    <form method="post" autocomplete="off">
      <label>Setup token
        <input type="password" name="token" required autofocus>
      </label>
      <label>Email
        <input type="email" name="email" required value="<?= h($_POST['email'] ?? '') ?>">
      </label>
      <label>Your name
        <input type="text" name="name" required value="<?= h($_POST['name'] ?? '') ?>">
      </label>
      <label>Password <span style="font-weight:400;color:#7d7175">(min 10 characters)</span>
        <input type="password" name="password" required minlength="10">
      </label>
      <label>Confirm password
        <input type="password" name="confirm" required minlength="10">
      </label>
      <button type="submit">Create owner account</button>
    </form>
<?php endif; ?>
  </div>
</div>
</body>
</html>
