# Deploying Eat On to Namecheap (Stellar shared hosting)

Everything here runs on stock cPanel: PHP 8, MySQL, Apache. No Node, no
Composer, no shell access required except for one optional step.

Work through the sections in order. Section 8 is the end-to-end test — do not
announce the site as live until it passes.

---

## What goes where

```
/home/YOURUSER/
├── eaton-config.php          ← credentials. ABOVE the web root, never in git
├── logs/
│   └── eaton-error.log       ← PHP errors land here
└── public_html/
    ├── index.html            ← from dist/
    ├── assets/               ← from dist/assets/
    ├── .htaccess             ← SPA routing (section 5)
    ├── uploads/              ← menu photos, writable
    └── api/
        ├── index.php
        ├── .htaccess
        ├── lib/
        └── routes/
```

The config file sits **above** `public_html` on purpose. If Apache ever stops
executing PHP — a bad `.htaccess`, a failed upgrade — every `.php` file under
the web root gets served as plain text. Anything inside `public_html` would
hand your database password and Stripe secret key to whoever asked.

---

## 1. Create the database

cPanel → **MySQL® Databases**.

1. **New Database**: `eaton` → Create. cPanel prefixes it, giving something
   like `cpuser_eaton`. Write the full name down.
2. **New User**: `eatonapp`, with a generated password. Save the password
   somewhere safe — it is shown once.
3. **Add User To Database** → select both → **ALL PRIVILEGES** → Make Changes.

You now have three values for the next step: database name, user name,
password. All three include the `cpuser_` prefix except the password.

## 2. Import the schema

cPanel → **phpMyAdmin** → select your database in the left sidebar.

1. **Import** tab → Choose File → `server/schema.sql` → **Go**.
   Expect "Import has been successfully finished".
2. **Import** again → `server/seed.sql` → **Go**.
   This loads the real menu: 7 categories, 18 items, 6 option groups, 14
   shifts, 3 banners.

Check the **Structure** tab shows **18 tables**. These row counts are what a
correct import looks like — verified against a real import, so anything else
means something did not load:

| table | rows |
|---|---|
| `categories` | 7 |
| `items` | 18 |
| `item_sizes` | 28 |
| `modifier_groups` | 6 |
| `modifier_options` | 26 |
| `item_modifier_groups` | 27 |
| `shifts` | 14 |
| `closed_dates` | 2 |
| `banners` | 3 |
| `settings` | 5 |
| `users` | 0 (until section 7) |

> Re-importing `seed.sql` later is safe — every statement upserts. It refreshes
> the menu without touching orders, staff or takings. Regenerate it with
> `npm run seed:sql` after editing anything in `src/data/`.

## 3. Upload the config

On your own machine, copy `server/config.example.php` to `eaton-config.php` and
fill in the real values. Then upload it to `/home/YOURUSER/` — the folder that
*contains* `public_html`, not `public_html` itself.

In cPanel **File Manager**, that is the directory you land in by default. If
you can see `public_html` listed alongside `mail` and `logs`, you are in the
right place.

Set these at minimum:

```php
'db' => [
    'name'     => 'cpuser_eaton',
    'user'     => 'cpuser_eatonapp',
    'password' => 'the password from step 1',
],
'site_url'     => 'https://yourdomain.co.uk',
'uploads_path' => '/home/YOURUSER/public_html/uploads',
```

Leave `'env' => 'production'`. Setting it to `development` puts database table
names and file paths into API error responses, where customers can see them.

## 4. Build and upload the front end

On your own machine:

```bash
npm install
npm run build
```

This writes `dist/`. Upload **the contents of `dist/`** — not the folder
itself — into `public_html`. The fastest route is to zip it, upload the zip via
File Manager, and use **Extract**.

Then upload `server/api/` to `public_html/api/`, keeping the `lib/` and
`routes/` subfolders intact.

Create `public_html/uploads/` and set its permissions to **755**
(File Manager → right-click → Change Permissions).

## 5. SPA routing

The app uses client-side routing, so a customer who refreshes on `/menu` must
still be served `index.html` rather than a 404. Create
`public_html/.htaccess`:

```apache
RewriteEngine On

# Let the API handle its own routes.
RewriteRule ^api/ - [L]

# Real files and directories are served as-is.
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# Everything else is the React app.
RewriteRule ^ index.html [L]

# Force HTTPS. Stripe refuses to run on plain http, and the session cookie is
# marked Secure, so the admin panel cannot log in without this.
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# Hashed asset filenames change on every build, so they can cache forever.
<IfModule mod_expires.c>
    ExpiresActive On
    ExpiresByType text/css "access plus 1 year"
    ExpiresByType application/javascript "access plus 1 year"
    ExpiresByType image/webp "access plus 1 month"
</IfModule>

# index.html must NOT be cached, or customers keep loading the old app after
# you deploy a new one.
<Files "index.html">
    <IfModule mod_headers.c>
        Header set Cache-Control "no-cache, must-revalidate"
    </IfModule>
</Files>
```

## 6. SSL

cPanel → **SSL/TLS Status** → tick your domain → **Run AutoSSL**. Namecheap
issues a free Let's Encrypt certificate; it takes a few minutes.

Confirm `https://yourdomain.co.uk` loads with a padlock before continuing.
Stripe will not work without it.

## 7. Create the owner account

There is no public sign-up — an open registration endpoint on a shop's admin
panel is an open door. So the first account is made from the command line.

cPanel → **Terminal** (under Advanced):

```bash
cd ~/public_html/api/..
php ~/server/create-owner.php "you@yourdomain.co.uk" "Your Name"
```

It prompts for a password twice, without echoing it. Minimum 10 characters.

**If your plan has no Terminal**, generate a hash locally instead
(`php -r 'echo password_hash("your-password", PASSWORD_DEFAULT);'`) and insert
the row by hand in phpMyAdmin → `users` → Insert:

| column | value |
|---|---|
| `email` | you@yourdomain.co.uk |
| `password_hash` | the `$2y$...` string |
| `name` | Your Name |
| `role` | `owner` |
| `is_active` | `1` |

Delete `create-owner.php` from the server afterwards either way.

## 8. Stripe

### Keys

dashboard.stripe.com → **Developers → API keys**. Start in **test mode** (the
toggle top-right). Copy both keys into `eaton-config.php`:

```php
'stripe' => [
    'publishable_key' => 'pk_test_...',
    'secret_key'      => 'sk_test_...',
    'webhook_secret'  => '',        // filled in next
    'currency'        => 'gbp',
],
```

### Webhook

This is the part that actually marks orders paid. Without it, customers are
charged and the kitchen never sees the order.

**Developers → Webhooks → Add endpoint**:

- **URL**: `https://yourdomain.co.uk/api/stripe/webhook`
- **Events**: `payment_intent.succeeded`, `payment_intent.payment_failed`,
  `charge.refunded`

Reveal the **Signing secret** (`whsec_...`) and put it in `webhook_secret`.

The signature check is what stops anyone who finds that URL from POSTing
"payment succeeded" and getting free food. If the secret is wrong the endpoint
returns 400 and Stripe's dashboard shows the failures — check there first if
payments are not landing.

### Test the whole flow

With test keys still in place, place a real order on the site using Stripe's
test card:

```
Card    4242 4242 4242 4242
Expiry  any future date
CVC     any 3 digits
Postcode any
```

Then verify, in order:

1. The order appears in the admin panel under **Orders**.
2. Its payment status reads **paid** (this proves the webhook works).
3. Stripe → Payments shows the charge.
4. Advancing the status in the admin panel updates the customer's tracking page.

Only once all four pass, switch to live keys: flip Stripe out of test mode,
copy the `pk_live_`/`sk_live_` keys, **create a second webhook endpoint** for
live mode (test and live webhooks are separate — this is the single most
commonly missed step), and update `webhook_secret` to the live one.

---

## Going live checklist

- [ ] `https://` loads with a valid certificate
- [ ] Menu, prices and photos are correct
- [ ] Trading hours match the real shop, including the after-midnight shifts
- [ ] Delivery radius, fee, free-delivery threshold and minimum order checked
- [ ] A test order completes end to end and shows **paid**
- [ ] `create-owner.php` deleted from the server
- [ ] `'env' => 'production'` in the config
- [ ] Staff accounts created with the right roles
- [ ] Live Stripe keys **and** a live-mode webhook configured

---

## Roles

| | Orders | Menu | Hours / Banners / Promo | Reports | Staff | Settings |
|---|---|---|---|---|---|---|
| **owner** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **manager** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **staff** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

`staff` is intentionally minimal — it is the kitchen tablet login. It can see
and advance orders and nothing else, so a screen left unattended by the fryer
cannot be used to change prices.

The rules are enforced server-side in `api/lib/auth.php`. Hiding a button in
the UI is presentation, not security; every write endpoint declares the
permission it needs.

To widen a role, edit the `PERMISSIONS` map in that one file.

---

## Troubleshooting

**500 on every API call** — read `/home/YOURUSER/logs/eaton-error.log`. Almost
always the config file: wrong path, wrong database credentials, or the file was
uploaded into `public_html` instead of above it.

**"Config not found"** — `eaton-config.php` is in the wrong directory. It
belongs beside `public_html`, not inside it.

**API returns HTML instead of JSON** — `api/.htaccess` did not upload, so
Apache is not routing to `index.php`. Hidden files are invisible in File
Manager until you enable **Settings → Show Hidden Files**.

**Admin login succeeds then immediately signs out** — the session cookie is
`Secure`, so it needs HTTPS. Check `site_url` in the config starts with
`https://` and matches the domain exactly.

**Payments taken but orders stay unpaid** — the webhook. Check Stripe →
Webhooks → your endpoint → recent deliveries for the error, and confirm you
used the signing secret from the *same mode* (test vs live) as your API keys.

**Uploads fail** — `public_html/uploads/` is missing or not 755, or
`uploads_path` in the config points somewhere else.

**Menu edits do not show for customers** — the item or its category is
unpublished. The admin catalog shows unpublished items; the public one filters
them out.

---

## Updating the site later

Front-end change:

```bash
npm run build
```

Upload the new `dist/` contents over `public_html`, replacing `index.html` and
`assets/`. Old hashed asset files can be deleted once the new build is live.

Back-end change: upload the changed files under `public_html/api/`.

Menu data change in `src/data/`: run `npm run seed:sql`, then import the new
`server/seed.sql` in phpMyAdmin. It upserts, so orders and staff are untouched.

Schema change: back up first (phpMyAdmin → Export), then apply the migration.
`schema.sql` creates tables from scratch and will not alter existing ones.
