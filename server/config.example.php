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
    // Used to build absolute URLs (image links, PayPal return URLs).
    // No trailing slash. Must be https in production or PayPal will refuse.
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

    // ── PayPal ─────────────────────────────────────────────────────────────
    // From developer.paypal.com → Apps & Credentials.
    //
    // That page has a Sandbox tab and a Live tab, each with its OWN client id
    // and secret. They are not interchangeable, and using one against the
    // other is the single commonest setup error — the API answers
    // "Client Authentication failed" and nothing else.
    //
    // 'mode' picks which PayPal you talk to. Leave it on 'sandbox' until you
    // have taken a test payment end to end, then switch it and paste the live
    // credentials in. See DEPLOYMENT.md section 8.
    'paypal' => [
        'mode'       => 'sandbox',          // 'sandbox' | 'live'
        'client_id'  => 'CHANGE_ME',
        'secret'     => 'CHANGE_ME',
        // From the webhook you create in the same dashboard, pointing at
        // https://yourdomain/api/paypal/webhook. Without it the signature
        // cannot be verified and every webhook is rejected — which is the
        // safe failure, but it means a payment settled out-of-band never
        // reaches the kitchen.
        'webhook_id' => 'CHANGE_ME',
        // Must match the currency the shop prices in.
        'currency'   => 'GBP',

        // ── Wallets ────────────────────────────────────────────────────────
        // Google Pay and Apple Pay, taken through the same PayPal account and
        // settled into the same balance. Both are OFF until the account can
        // actually take them, because a wallet button that fails when pressed
        // costs more orders than one that was never shown.
        //
        // Each needs turning on at developer.paypal.com → Apps & Credentials →
        // your app → Features, and Apple Pay also needs the domain registered
        // and its association file served. Full steps: DEPLOYMENT.md §8.6.
        //
        // Neither works over plain http, so both stay dark in local
        // development regardless of what is set here.
        'google_pay' => false,
        'apple_pay'  => false,
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
