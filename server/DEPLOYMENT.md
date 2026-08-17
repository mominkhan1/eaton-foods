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
hand your database password and PayPal secret to whoever asked.

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

# Force HTTPS. PayPal refuses to run on plain http, and the session cookie is
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
PayPal will not work without it.

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

## 8. PayPal

Payment runs through **PayPal Standard Checkout**. Customers without a PayPal
account pay by card on PayPal's own page — no card details ever touch this
site, which is what keeps the shop out of PCI scope.

The whole section is done twice: once in **sandbox** to prove it works, once in
**live** to take real money. Do not skip the sandbox pass. Every credential
below exists separately in each environment and they are not interchangeable.

### 8.1 Create the app (sandbox first)

1. Sign in at **developer.paypal.com** with the PayPal account the shop's money
   should land in.
2. **Apps & Credentials**. Note the **Sandbox / Live** toggle at the top —
   leave it on **Sandbox** for now.
3. **Create App** → name it `Eat On` → type **Merchant** → Create.
4. Copy the **Client ID** and, under Secret, **Generate/Show** and copy that.

Put them in `eaton-config.php` (the file above `public_html`, section 3):

```php
'paypal' => [
    'mode'       => 'sandbox',
    'client_id'  => 'AX...................',
    'secret'     => 'EL...................',
    'webhook_id' => '',            // filled in at 8.2
    'currency'   => 'GBP',
],
```

> `mode` is what decides which PayPal you talk to. Sandbox credentials against
> live, or the reverse, fail with `Client Authentication failed` and nothing
> more useful — if you see that, this is why.

### 8.2 Add the webhook

The webhook is the safety net. The payment is normally confirmed by the
browser as it happens; the webhook is what saves an order when the customer
closes the tab at the wrong moment, or when PayPal holds a payment for review
and releases it minutes later.

Still in your app, scroll to **Webhooks → Add Webhook**:

- **URL**: `https://yourdomain.co.uk/api/paypal/webhook`
- **Events** — tick exactly these four:
  - `PAYMENT.CAPTURE.COMPLETED`
  - `PAYMENT.CAPTURE.DENIED`
  - `PAYMENT.CAPTURE.REFUNDED`
  - `PAYMENT.CAPTURE.REVERSED`

Save, then copy the **Webhook ID** it shows (`WH-...`) into `webhook_id`.

Without that id the signature cannot be checked and **every webhook is
rejected**. That is the safe direction to fail — it means nobody can POST
"payment completed" to that URL and get free food — but it also means a
payment settled out-of-band never reaches the kitchen. Do not leave it blank.

### 8.3 Run the database migration

Payments changed the orders table. In **phpMyAdmin → your database → Import**,
run:

```
server/migrations/002-paypal-payments.sql
```

It is safe to run once and unnecessary on a fresh install. It also converts
orders placed before this change to `unpaid`, so they stay on the Orders
screen rather than vanishing.

### 8.4 Take a sandbox payment

You need a sandbox buyer to pay with: **developer.paypal.com → Testing Tools →
Sandbox Accounts**. There is a *personal* account there already — click
**View/Edit** to get its email and system-generated password.

Now place an order on the real site, and at the PayPal window sign in as that
sandbox buyer. Then check, in order:

1. **The order appears in the admin panel under Orders.** If it does not, the
   payment did not complete — the kitchen deliberately never sees an unpaid
   order.
2. **Its payment shows as paid.**
3. **developer.paypal.com → Sandbox → Transactions** shows the payment.
4. **Advancing the status in the admin panel** updates the customer's tracking
   page.
5. **The shop received the new-order email.**

If 1 and 2 fail but 3 shows the money, the webhook is the problem — check its
delivery log in the PayPal dashboard, and `server/logs/eaton-error.log`.

### 8.5 Go live

Only once all five pass:

1. developer.paypal.com → flip the toggle to **Live**.
2. **Apps & Credentials → Create App** again — a live app is a separate app
   with its own client ID and secret. Copy both.
3. **Add the webhook again, under the live app**, with the same URL and the
   same four events. Copy the new live **Webhook ID**.

   > Sandbox and live webhooks are entirely separate. Forgetting the live one
   > is the single most commonly missed step, and it fails silently: payments
   > succeed and orders sit unpaid.

4. Update `eaton-config.php` — all four values change:

```php
'paypal' => [
    'mode'       => 'live',
    'client_id'  => 'AX... (live)',
    'secret'     => 'EL... (live)',
    'webhook_id' => 'WH-... (live)',
    'currency'   => 'GBP',
],
```

5. Confirm the PayPal business account is fully verified and can accept
   payments — a new account is sometimes limited until bank details are
   confirmed, and payments will fail until then.

6. **Place one real order with your own card, for the cheapest item on the
   menu.** Watch it land in the admin panel, then refund it from
   paypal.com → Activity. The refund should flip the order to `refunded`
   within a minute, which proves the live webhook is wired.

### 8.6 Google Pay and Apple Pay (optional)

Both are taken **through the same PayPal account** and land in the same
balance — same order, same capture, same webhook. Nothing new to reconcile.
They exist because a customer who has one is a single tap from paying, on the
phone where most takeaway orders are placed.

Both ship **switched off**:

```php
'google_pay' => false,
'apple_pay'  => false,
```

Leave them off until the steps below are done for that wallet. A button that
fails when pressed loses more orders than a button that was never there.

**Neither works on `http://localhost`.** Both require https, so this section
can only be done against the live domain.

#### Before either will work

Google Pay and Apple Pay through PayPal need **Advanced Checkout** on the
merchant account — not the Standard Checkout the PayPal button uses. In the UK
this is an application, not a switch, and it is not instant.

1. developer.paypal.com → **Apps & Credentials** → your app → **Features**.
2. If **Advanced Credit and Debit Card Payments** is not already enabled, apply
   for it and wait for approval before going further.
3. On the same Features list, tick **Google Pay** and/or **Apple Pay**.

Do this in sandbox first, exactly as with the card flow, and again on the live
app afterwards — the two are separate accounts and enabling one does nothing
for the other.

#### Google Pay

Nothing further. Once the feature is enabled, set `'google_pay' => true` and
rebuild the front end.

The button appears only if the customer's browser can actually pay — Chrome
with a card saved to their Google account. Everyone else sees the PayPal button
alone and is told nothing about a feature they were not offered.

#### Apple Pay

Apple Pay additionally needs **the domain proved to be yours**, and this is the
step that fails if skipped — merchant validation is rejected and the sheet dies
on open.

1. developer.paypal.com → your app → **Apple Pay** → **Manage domains**.
2. Add `eatonfoods.co.uk`, and every other hostname the shop is reachable on.
   `www.` and the bare domain are **different domains** to Apple; register both
   or the one you missed silently fails.
3. Download the **domain association file** from that screen, and commit it to
   the repo at:

   ```
   public/.well-known/apple-developer-merchantid-domain-association
   ```

   No file extension. Vite copies everything under `public/` into the build, so
   it lands at the web root and **redeploys itself on every push** — verified,
   dotted directory and all. Putting it straight onto the server by hand works
   too, but then it is one manual step away from being lost the next time
   anyone rebuilds the site.

   It is a public verification file, not a secret. It is meant to be readable
   by anyone; committing it is correct.

4. Confirm
   `https://yourdomain.co.uk/.well-known/apple-developer-merchantid-domain-association`
   returns the file rather than the React app.

   > The SPA rewrite serves `index.html` for unknown paths, which is the
   > commonest way this file goes missing on an otherwise correct setup. The
   > root `.htaccess` here is fine — `deploy/htaccess-root` matches real files
   > and directories with `-f`/`-d` and stops before the catch-all — but check
   > the URL anyway, because nothing else tells you it is wrong.

5. Then set `'apple_pay' => true` and push.

The button appears only in Safari, on a device with a card in Wallet.

#### Testing them

Neither can be tested from a desktop Chrome-on-Windows dev machine, which is
the awkward part:

| Wallet | Needs |
|---|---|
| Google Pay | Chrome, signed in, with a card saved. Sandbox uses Google's TEST environment, where a real card is not charged. |
| Apple Pay | Safari on a Mac or iPhone, with a card in Wallet, on the registered https domain. |

Place one real order through each after go-live, for the cheapest item, and
refund it — the same proof the card flow gets in 8.5. Check the admin panel
shows the order and that the payment reads as the wallet used, not as PayPal.

### What the customer sees if something is wrong

- **PayPal not configured** — the checkout says online payment is unavailable
  and shows the shop's phone number, rather than a button that fails.
- **A wallet is switched on but the device cannot use it** — nothing is shown.
  The wallet buttons render only when the browser confirms it can pay, so a
  customer never sees an option that would fail on them.
- **A wallet is switched on but the PayPal account is not approved for it** —
  also nothing, and a note in the browser console. The PayPal button still
  works, so orders keep coming in while you sort it out.
- **An ad blocker eats the SDK** — the payment box explains that and suggests
  disabling it. This is common enough to be worth knowing about.
- **Payment declined** — the basket is kept so they can try another method.

### Refunds

Refund from **paypal.com → Activity**, not from this site. The webhook picks it
up and marks the order `refunded`, which takes it out of the revenue figures.

---

## 9. Email

Order alerts go out through the server's own mail system — nothing to install.
But **deliverability needs two DNS records**, or your order emails land in
spam and you will not find out until a customer rings to ask where their food
is.

### Set the recipients

In `eaton-config.php`:

```php
'mail' => [
    // Who gets the new-order alert. Comma-separated for several people.
    'order_notifications' => 'orders@yourdomain.co.uk, kitchen@yourdomain.co.uk',
    // Leave null to send as orders@yourdomain.co.uk
    'from_email' => null,
],
```

**The From address must be on your own domain.** Sending as a `gmail.com`
address from a Namecheap server fails DMARC — Gmail and Outlook will reject or
spam it. If you want the alerts to *arrive* in Gmail that is fine; it is
sending *as* Gmail that breaks.

### DNS (cPanel → Zone Editor)

**SPF** — add a TXT record on your root domain if one does not exist:

```
Type: TXT   Name: @   Value: v=spf1 +a +mx +ip4:YOUR.SERVER.IP ~all
```

Your server IP is in cPanel's right-hand sidebar. If a `v=spf1` record already
exists, **edit it rather than adding a second** — two SPF records are invalid
and worse than one.

**DKIM** — cPanel → **Email Deliverability** → your domain → **Repair**. This
generates and installs the key automatically. That page also flags SPF problems
in plain language, so check it shows green for both.

### Test it

Sign in to the admin panel as the owner and use the test-email button, or:

```bash
curl -X POST https://yourdomain.co.uk/api/admin/test-email \
  -H "Origin: https://yourdomain.co.uk" --cookie "your-session-cookie"
```

It sends a realistic sample order alert. **Check the spam folder too** — if it
lands there, fix SPF/DKIM before going live.

### What gets sent

| When | To | Contains |
|---|---|---|
| Order placed | shop | Full order, customer phone, address, allergy notes, `NOT PAID YET` badge |
| Order placed | customer *(if they gave an email)* | Confirmation, reference, tracking link |
| Payment clears | shop | Same alert again, now marked `PAID` |
| Marked ready | customer | Ready to collect / driver leaving |
| Marked on the way | customer | Driver heading over |
| Cancelled | customer | Cancellation notice |

The shop gets two emails per order on purpose: the first arrives before the
card clears, and the kitchen should not start cooking on a payment that may
still fail.

Email never blocks an order. If the mail server is down the send is logged and
ignored, because a customer who has paid must get their order through
regardless.

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
- [ ] Live PayPal credentials **and** a live-mode webhook configured
- [ ] One real payment taken and refunded end to end

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

**Payments taken but orders stay unpaid** — the webhook. Check PayPal →
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

Schema change: back up first (phpMyAdmin → Export), then apply the migration
from `server/migrations/` — **Import** tab → Choose File → **Go**, exactly like
the schema import in section 2. `schema.sql` creates tables from scratch and
will not alter existing ones, so a database that already has data needs the
migration rather than a re-import.

### Migrations to date

| File | What it does | Needed if |
|---|---|---|
| `001-banner-slide-fields.sql` | Widens `banners` to hold a whole slide — the eyebrow, the orange second line, the offer price, the second button, and the open/closed line. | Your database was created before this change. Without it, saving a slide fails and roughly half of what the shop typed is dropped. |

Each is safe to run once on an existing database and unnecessary on a fresh
install, which gets the same columns from `schema.sql`.
