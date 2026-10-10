# Email setup runbook

Everything needed to make the transactional email **work in production**, step by
step. The code is done and merged; this covers the external accounts, secrets and
dashboard settings that cannot live in the repo.

Architecture/why: [`email-confirmation.md`](email-confirmation.md) (welcome
email) and [`auth-emails.md`](auth-emails.md) (Supabase auth emails). This file is
the operational checklist.

---

## 0. What's already done vs. what's left

**Done in code (merged to `main`):**

| Piece | File |
| --- | --- |
| Welcome/confirm email sender | `functions/api/welcome-email.js` |
| Supabase auth-email hook (reset, email change) | `functions/api/auth-email-hook.js` |
| Webhook signature verification | `functions/api/standard-webhook.js` |
| Shared Resend send | `functions/api/resend-send.js` |
| Localized copy builders | `src/modules/user/{welcome,auth}-email-content.js` |
| Email copy (28 languages) | `src/data/strings.js` (`email_welcome_*`, `auth_email_*`) |
| Confirm landing page | `/confirm-email` route |
| DB migration (confirmation flag + tokens) | `supabase/migrations/006_add_email_confirmation.sql` |

**Left to do (this guide):** Resend account + verified domain, Cloudflare Pages
secrets, Supabase dashboard config (redirect URLs + Send Email Hook), and a
verification pass.

**Two independent email paths** (both send through Resend, so all transactional
mail is one system):

1. **Welcome email** — triggered by `SignupForm` → `/api/welcome-email`. Needs
   `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, migration 006.
2. **Supabase auth emails** — password reset, email change, etc. GoTrue calls
   `/api/auth-email-hook` once the hook is enabled. Needs `RESEND_API_KEY`,
   `SEND_EMAIL_HOOK_SECRET`, and the hook configured.

---

## Prerequisites

- Access to the **Resend** account for `ultrafastfluency.com`.
- Access to **Cloudflare Pages** → project `uffenglish` → Settings → Environment
  variables.
- Access to the **Supabase** dashboard for project `jbrbmbmupjfangqvaevx`.
- Ability to edit **DNS** for `ultrafastfluency.com`.

---

## Part 1 — Resend (sender domain + API key)

1. Create/log in to [resend.com](https://resend.com).
2. **Domains → Add domain** → `ultrafastfluency.com`.
3. Add the DNS records Resend shows (all at your DNS provider):
   - an **SPF** `TXT` record,
   - one or more **DKIM** `CNAME`/`TXT` records,
   - optionally a **DMARC** `TXT` record (`_dmarc`) — recommended for
     deliverability (Gmail/Yahoo bulk-sender rules).
4. Wait until the domain shows **Verified** (minutes to a few hours for DNS).
5. **API Keys → Create API key** → permission **Sending access** → copy the
   `re_...` value (shown once). This becomes `RESEND_API_KEY`.

> The default sender `onboarding@resend.dev` only delivers to the Resend account
> owner's own address — do not rely on it. `EMAIL_FROM` must be on the verified
> domain (it already is: `welcome@ultrafastfluency.com`).

---

## Part 2 — Cloudflare Pages secrets & vars

Cloudflare Pages → project **uffenglish** → **Settings → Environment variables**.
Set them for **Production** (and **Preview** if you want staging email).

**Secrets** (never in the repo, never in the client bundle):

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | the `re_...` key from Part 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → the `service_role` secret (legacy JWT `eyJ...` or new secret key `sb_secret_...`) |
| `SEND_EMAIL_HOOK_SECRET` | generated in Part 3 step 4 (`v1,whsec_...`) — set this **before** enabling the hook |

**Plain vars** already live in `wrangler.toml` `[vars]` and must stay there
(`wrangler pages deploy` **drops dashboard plain-text vars not listed in
`[vars]`**; secrets survive):

```
SUPABASE_URL = "https://jbrbmbmupjfangqvaevx.supabase.co"
EMAIL_FROM   = "Ultrafast Fluency <welcome@ultrafastfluency.com>"
SITE_URL     = "https://ultrafastfluency.com"
```

> `SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. It is used only
> server-side (write confirmation tokens; read the profile language). Never put it
> in the client.

---

## Part 3 — Supabase dashboard

1. **Authentication → Providers → Email**: ensure the **Email provider is
   enabled**. (Required — disabling it while the hook is on disables signups.)
2. **Keep email confirmations OFF** (`enable_confirmations = false`, already in
   `supabase/config.toml`). This is deliberate: turning it on makes `signUp()`
   withhold the session until the click, which would block signup.
3. **Authentication → URL Configuration → Redirect URLs**: add (exact URLs, no
   wildcards):
   - `https://ultrafastfluency.com` and `https://www.ultrafastfluency.com`
   - `https://ultrafastfluency.com/reset-password`
   - `https://ultrafastfluency.com/confirm-email`
   - staging equivalents (`https://s.ultrafastfluency.com/...`) if you test there
   - `http://localhost:3000/reset-password` for local dev
4. **Authentication → Hooks → Send Email**: **Enable** it and set:
   - **URL**: `https://ultrafastfluency.com/api/auth-email-hook`
   - generate/copy the **secret** (`v1,whsec_...`) → paste into the Pages secret
     `SEND_EMAIL_HOOK_SECRET` (Part 2), then **Save**.
5. Keep **Secure Email Change** (`double_confirm_changes`) **off** (the default
   here). The handler also supports the on case, but off is simpler.
6. Confirm **Secure email change / notifications** settings match what you want
   (the handler covers `password_changed_notification` /
   `email_changed_notification` in English; recovery + email change are
   localized).

> **Order matters.** Set `RESEND_API_KEY` and `SEND_EMAIL_HOOK_SECRET` in Pages
> **before** enabling the hook. Once it is on, *every* auth email goes through
> `/api/auth-email-hook`; if the secrets are missing the endpoint returns `500`
> and the user gets no email.

> Dashboard labels move between Supabase versions — the sections are under
> **Authentication** ("Providers", "URL Configuration", "Hooks").

---

## Part 4 — Database migration

Migration `006` adds `user_profiles.email_confirmed`/`email_confirmed_at`, the
`email_confirm_tokens` table and the `confirm_email_hash()` RPC.

- It **auto-applies on merge to `main`** via Supabase's GitHub integration
  (`supabase/config.toml` header).
- Verify: Supabase → **Database → Migrations** (or SQL editor) shows
  `006_add_email_confirmation.sql` applied, and:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'user_profiles'
  and column_name like 'email_confirmed%';
```

If it is not applied, run the file in the Supabase SQL editor before deploying.

---

## Part 5 — Deploy

The code is already on `main`, so `deploy.yml` builds and deploys Pages on the
push. To deploy the latest manually:

```bash
npm run build && wrangler pages deploy dist --project-name=uffenglish
```

After deploy, smoke-test that the endpoints exist and reject unsigned calls:

```bash
# Auth-email hook: unsigned request must be 401 (proves it deployed + verifies).
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  https://ultrafastfluency.com/api/auth-email-hook -d '{}'
# -> 401

# Welcome email: no JWT must be 401.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  https://ultrafastfluency.com/api/welcome-email
# -> 401
```

---

## Part 6 — Verify end to end

- [ ] **Welcome email** — sign up a fresh account. The email arrives from
      `welcome@ultrafastfluency.com` in the learner's language. Click
      **Confirm my email** → the `/confirm-email` page shows success.
- [ ] **Confirmation recorded** — in Supabase SQL:
      ```sql
      select email, email_confirmed, email_confirmed_at
      from public.user_profiles order by created_at desc limit 5;
      ```
      the row flips to `email_confirmed = true`.
- [ ] **Password reset** — open `/recover-password`, enter a real account's
      email. The reset email arrives (localized, from your domain); the link
      opens `/reset-password`; set a new password; log in with it.
- [ ] **Email change** (optional) — Profile → change email → the confirmation
      arrives at the **new** address.
- [ ] **Resend logs** — Resend → **Logs/Emails** shows the sends (delivered, not
      bounced). Check the first few are not landing in spam.
- [ ] **Not the Supabase sender** — the reset email's From is your domain, not
      `noreply@mail.app.supabase.io`. If it is still the Supabase sender, the
      hook is not enabled (Part 3 step 4).

---

## Part 7 — Staging

One Supabase project serves staging and production, so there is **one hook URL** —
point it at production. The reset/confirm links follow the request's
`redirect_to`, so a staging signup still redirects to staging.

If you want staging links rooted at staging, override `SITE_URL` for the Preview
environment in `wrangler.toml` (dashboard plain vars are dropped on deploy):

```toml
[env.preview.vars]
SITE_URL = "https://s.ultrafastfluency.com"
```

See [`deploy-environments.md`](deploy-environments.md).

---

## Part 8 — Turning it off / rollback

- **Auth emails:** disable **Authentication → Hooks → Send Email**. GoTrue
  reverts to Supabase's default sender (rate-limited, unlocalized). Rotate the
  hook secret if it may have leaked.
- **Welcome email:** unset `RESEND_API_KEY`. The endpoint then returns
  `200 { sent:false }` and does nothing — **signup is never affected** (it is
  fire-and-forget by design).
- Both paths fail independently; disabling one does not affect the other.

---

## Part 9 — Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Reset email still comes from Supabase / "email rate limit exceeded" | Send Email Hook not enabled | Part 3 step 4 |
| No auth email at all; Supabase hook logs show a failure | Hook secret mismatch or endpoint down | Re-copy `SEND_EMAIL_HOOK_SECRET`; check the deploy |
| Hook returns **401** | Signature verification failed (wrong secret, or a proxy altered the body) | Re-paste the secret; ensure nothing rewrites the request body |
| Hook returns **500** | `RESEND_API_KEY` unset in Pages | Part 2 |
| Hook returns **502** | Resend rejected the send (unverified domain, bad `EMAIL_FROM`, rate limit) | Check Resend → Logs; verify the domain (Part 1) |
| Welcome email not sent (signup still fine) | `RESEND_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` unset, or migration 006 not applied | Parts 2 + 4 |
| Confirm link says "invalid or has expired" | Token already used, older than 7 days, or wrong project | Re-request; check the token table |
| Emails land in spam | SPF/DKIM/DMARC incomplete or domain not warmed up | Finish Part 1 DNS; warm up slowly |

---

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and `SEND_EMAIL_HOOK_SECRET` are
  **server-only** (Pages secrets). Never reference them under `src/` or ship them
  to the client.
- The auth hook endpoint is public but requires a valid `standardwebhooks`
  signature (rejecting stale timestamps) before doing anything.
- Keep the Supabase **Redirect URLs allow-list exact** — the confirmation/reset
  links are emailed, so a broad wildcard is a phishing surface.
- Rotate secrets if they are ever exposed; re-paste into Pages and (for the hook
  secret) regenerate in Supabase.

## Related docs

- [`email-confirmation.md`](email-confirmation.md) — welcome/confirm email design
- [`auth-emails.md`](auth-emails.md) — Send Email Hook design
- [`deploy-environments.md`](deploy-environments.md) — staging vs production hosts
