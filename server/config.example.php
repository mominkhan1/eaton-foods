<?php
/**
 * Eat On — configuration.
 *
 * DEPLOYMENT: copy this to `eaton-config.php` in your cPanel *home* directory
 * (one level ABOVE public_html) and fill in the real values:
 *
 *   /home/youruser/eaton-config.php     ← the real file, not web-reachable
 *   /home/youruser/public_html/api/     ← the API
 *
 * Keeping it above the web root means a server misconfiguration that stops
 * executing PHP serves your database password as plain text to the internet.
 * This file must never be committed with real credentials in it.
 */

return [
    // ── Database ───────────────────────────────────────────────────────────
    // cPanel prefixes both the database and the user with your account name,
    // e.g. 'eatonfoo_shop' and 'eatonfoo_app'. Copy them exactly from
    // cPanel → MySQL® Databases.
    'db' => [
        'host'     => 'localhost',
        'name'     => 'cpaneluser_eaton',
        'user'     => 'cpaneluser_eatonapp',
        'password' => 'CHANGE_ME',
        'charset'  => 'utf8mb4',
    ],

    // ── Site ───────────────────────────────────────────────────────────────
    // Used to build absolute URLs (image links, Stripe return URLs).
    // No trailing slash. Must be https in production or Stripe will refuse.
    'site_url' => 'https://eatonfoods.co.uk',

    // Absolute path to the uploads directory, and the public URL that serves
    // it. The directory must exist and be writable (755 is enough on cPanel).
    'uploads_path' => __DIR__ . '/public_html/uploads',
    'uploads_url'  => '/uploads',

    // ── Sessions ───────────────────────────────────────────────────────────
    'session' => [
        'name'     => 'eaton_admin',
        // Seconds of inactivity before an admin is signed out. 8h covers a
        // full shift without forcing a mid-service re-login.
        'lifetime' => 28800,
    ],

    // ── Stripe ─────────────────────────────────────────────────────────────
    // From dashboard.stripe.com → Developers → API keys.
    // The publishable key is exposed to the browser (that is what it is for).
    // The secret key must never leave the server.
    //
    // Use the test keys (pk_test_… / sk_test_…) until you have placed a real
    // test order end to end.
    'stripe' => [
        'publishable_key' => 'pk_test_CHANGE_ME',
        'secret_key'      => 'sk_test_CHANGE_ME',
        // Created when you add the webhook endpoint in the Stripe dashboard.
        // Without it, webhook signature verification cannot run and payments
        // will never be marked paid.
        'webhook_secret'  => 'whsec_CHANGE_ME',
        'currency'        => 'gbp',
    ],

    // ── Email ──────────────────────────────────────────────────────────────
    // Sent through the server's own mail system (PHP mail() → Exim on cPanel).
    // Nothing to install.
    'mail' => [
        // Who gets the "new order" alert. A comma-separated string or an
        // array. Leave null to fall back to the shop email in the admin
        // settings, then to any owner accounts.
        'order_notifications' => 'orders@CHANGE_ME.co.uk',

        // The From address. It MUST be on your own domain — sending as a
        // gmail.com address from a Namecheap server fails DMARC and goes
        // straight to spam. Leave null to use orders@<your domain>.
        'from_email' => null,
    ],

    // ── Environment ────────────────────────────────────────────────────────
    // 'production' hides error detail from API responses. Set 'development'
    // only while debugging, and never leave it on a live site — the messages
    // leak table names and file paths.
    'env' => 'production',

    // Where PHP should write errors. Keep it outside public_html.
    'error_log' => __DIR__ . '/logs/eaton-error.log',
];
