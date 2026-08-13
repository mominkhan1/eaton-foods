# Deploying from GitHub

Push to `main` → GitHub builds the site, runs lint and tests, and uploads the
result to Namecheap over FTPS. No zips, no File Manager, no forgetting a file.

Namecheap shared hosting has no Node, so the build happens on GitHub's
machines and only finished files are uploaded.

---

## What this replaces, and what it does not

**Automated from now on:** the React build, the API PHP files, and the root
`.htaccess`.

**Still manual, once:** the database, `eaton-config.php`, SSL, the owner
account, and `uploads/.htaccess`. These are either secret or one-time, and
automating them would be more dangerous than typing them once.

Three things are deliberately never touched by a deploy:

| Left alone | Why |
|---|---|
| `eaton-config.php` | Lives above `public_html`, holds your database and PayPal credentials, and is not in git. A deploy must never overwrite it. |
| `public_html/uploads/` | The shop's menu photos. Wiping these each release would blank every image. |
| The database | Schema changes get applied deliberately, not as a side effect of a push. |

---

## One-time setup

### 1 · Create a dedicated FTP account

cPanel → **FTP Accounts** → Add FTP Account.

| Field | Value |
|---|---|
| Log In | `deploy` |
| Directory | `public_html` ← **change this**, it defaults to a subfolder |
| Quota | Unlimited |

Use a generated password and save it.

**Do not use your main cPanel login.** This account can only touch
`public_html`, so if the credential ever leaks the damage is bounded — it
cannot reach `eaton-config.php`, your email, or your databases.

After creating it, click **Configure FTP Client** to see the server hostname.
It is usually your domain, sometimes `ftp.yourdomain.co.uk` or a server name
like `server123.web-hosting.com`.

### 2 · Add the secrets to GitHub

Your repo → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**. Add three:

| Name | Value |
|---|---|
| `FTP_SERVER` | the hostname from Configure FTP Client |
| `FTP_USERNAME` | `deploy@yourdomain.co.uk` (the full username cPanel shows) |
| `FTP_PASSWORD` | the password you generated |

Secrets are write-only. GitHub masks them in logs, and nobody — including you —
can read them back afterwards.

### 3 · First deploy

Push anything to `main`, or go to **Actions** → **Deploy to Namecheap** →
**Run workflow**.

Watch the run. It lints, tests, builds, checks every PHP file for syntax
errors, then uploads. **A failing test blocks the deploy** — that is the point.

### 4 · Finish the one-time server setup

Follow `server/DEPLOYMENT.md` sections 1, 2, 3, 6 and 7 — database, schema
import, config file, owner account, email deliverability. Those are unchanged.

Then add `uploads/.htaccess` once, by hand: File Manager → `public_html/uploads`
→ **+ File** → name it `.htaccess` → paste the contents of
`deploy/htaccess-uploads`.

---

## Day-to-day

```bash
git add -A
git commit -m "Raise burger prices"
git push
```

Roughly 90 seconds later it is live. Watch progress in the **Actions** tab.

**Menu data changes** in `src/data/` need one extra step, because the menu
lives in the database rather than the code:

```bash
npm run seed:sql
```

Then import `server/seed.sql` in phpMyAdmin. It upserts, so orders, staff and
takings are untouched.

---

## Rolling back

Find the last good commit in the Actions tab, then:

```bash
git revert <bad-commit-sha>
git push
```

That deploys the previous state. Prefer it over `git reset --force` — a revert
keeps the history intact and is itself reversible.

---

## Troubleshooting

**`Error: 530 Login authentication failed`** — wrong `FTP_USERNAME`. cPanel
usually wants the full `deploy@yourdomain.co.uk`, not just `deploy`.

**Deploy succeeds but the site is unchanged** — the FTP account's home
directory is not `public_html`, so files landed one level up. Check the FTP
account's Directory setting, or set `server-dir: ./public_html/` in the
workflow.

**`ECONNREFUSED` or a hang** — some hosts block plain FTP. The workflow already
uses `ftps`. If it still fails, confirm FTP is enabled for your plan.

**Site loads but every API call 404s** — `api/.htaccess` did not upload. Enable
**Show Hidden Files** in File Manager and check it is there.

**Everything 500s after a deploy** — read
`/home/YOURUSER/logs/eaton-error.log`. Almost always `eaton-config.php`:
missing, wrong path, or wrong credentials.

---

## Why FTPS rather than cPanel's Git Version Control

cPanel can clone a repo and deploy with `.cpanel.yml`, which sounds tidier. But
it would need the built `dist/` committed to the repository, since the server
cannot run `npm run build`. Committing build output means every deploy produces
a noisy diff of minified bundles, and the repo slowly fills with them.

Building in CI keeps the repository to source only, and gates every deploy
behind lint and tests. That is worth more than avoiding one FTP credential.
