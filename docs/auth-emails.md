# Supabase auth emails (password reset, email change)

> **Setup/runbook:** [`email-setup.md`](email-setup.md).

Supabase's built-in auth emails (password reset, email change, magic link, …)
are sent by GoTrue using the project's SMTP sender. Out of the box that is the
default service — **rate-limited to ~2 emails/hour, best-effort** — and its
dashboard templates are single-language. So password reset cannot be relied on
in production, and it is not localized.

We replace it with Supabase's **Send Email Hook**: GoTrue POSTs a signed webhook
to `functions/api/auth-email-hook.js` instead of sending, and that Function sends
the email through **Zoho CPaaS** with the same localized copy as the welcome email.

## Flow

1. GoTrue POSTs `{ user, email_data }` to `/api/auth-email-hook` with the
   `webhook-id` / `webhook-timestamp` / `webhook-signature` headers.
2. The Function verifies the `standardwebhooks` signature with
   `SEND_EMAIL_HOOK_SECRET` (rejecting stale timestamps) — see
   `functions/api/standard-webhook.js`.
3. It resolves the language (`user_metadata.native_language`, falling back to
   the `user_profiles.native_language` lookup with the service role) and builds
   the email (`src/modules/user/auth-email-content.js`).
4. It sends via Zoho CPaaS. Unlike the welcome-email endpoint this is **not
   fail-open**: a missing provider key returns `500` (a silent `200` would leave
   the user with no reset link), and a Zoho CPaaS failure returns `502`.

The email button links to Supabase's own verify endpoint
(`https://<project>.supabase.co/auth/v1/verify?token=<hash>&type=<action>&redirect_to=<url>`),
which verifies the token and redirects to the SPA (`/reset-password`,
`/confirm-email`, …) — the implicit flow the client already uses.

## Redirect target (why a reset link used to open localhost)

`redirect_to` comes from GoTrue (`email_data.redirect_to`). GoTrue only honours
the `redirectTo` the client passes to `resetPasswordForEmail` when it is on the
project's **Redirect URLs** allow-list; otherwise it falls back to the project's
**Site URL**. Both were wrong in 2026-11: `Site URL` was the create-project
default `http://localhost:3000` and the allow-list was empty, so every
password-reset email carried `redirect_to=http%3A%2F%2Flocalhost%3A3000` and the
learner's browser reported "This site can't be reached".

Two fixes, both needed:

- **Dashboard (the real fix):** Site URL = `https://ultrafastfluency.com`, and
  the exact Redirect URLs listed below. `supabase/config.toml` mirrors that
  (`[auth] site_url` / `additional_redirect_urls`), so a `supabase config push`
  cannot reintroduce the dev URL.
- **Sender (defence in depth):** `functions/api/auth-email-hook.js` resolves the
  target through the pure `resolveAuthEmailRedirectTo`
  (`src/modules/user/auth-redirect-logic.js`) before building the link. A public
  target is kept as-is (staging keeps its own host); a loopback/private host, a
  relative path, a non-http scheme or a missing value becomes the configured
  `SITE_URL` plus the path the flow needs (`/reset-password` for recovery, and
  the local path is preserved when only the origin is unusable). The hook logs a
  warning whenever it rewrites a target, and never emits a URL a learner's
  browser cannot reach.

## Branding

Supabase's default templates talk about a generic "account" and the default
sender is Supabase itself, so a learner who got a password reset could not tell
where it came from. Every email this project sends names **UFF English** and
**ultrafastfluency.com**: the hook emails carry that signature
(`auth-email-content.js`, html **and** plain text).

The dashboard templates cannot be edited while the project is on the free tier
with the default email provider — the Management API refuses with *"Email
template modification is not available for free tier projects using the default
email provider"* — which is why the Send Email Hook (this Function) is the copy
that reaches learners, not the dashboard template.

## Localization

Password reset (`recovery`) and email change (`email_change`) are localized to
the full profile-language set (the `auth_email_*` keys in `src/data/strings.js`).
Supabase's other actions (signup/invite/magiclink/reauthentication and the
notification emails) send a correct **fully-English** generic email, so a newly
enabled action never silently sends nothing — add `auth_email_subject_<action>`
keys plus an `ACTION_SUBJECT_KEYS` entry to localize one.

## Setup (one-time, out of band)

1. `ZOHO_CPAAS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the new
   **`SEND_EMAIL_HOOK_SECRET`** must be set as **Pages secrets** (dashboard).
2. In the Supabase dashboard → **Auth → Hooks → Send Email**: enable it, set the
   URL to `https://<your-domain>/api/auth-email-hook`, generate the secret, and
   paste it into `SEND_EMAIL_HOOK_SECRET`.
3. Ensure every redirect target (`/reset-password`, `/confirm-email`, the site
   origin) is in the project's **Redirect URLs** allow-list.
4. **Set the secrets before enabling the hook** — once the hook is on, every
   auth email goes through this Function, and a misconfiguration breaks them.

With **Secure Email Change off** (recommended, and what this project sets —
`double_confirm_changes = false`) the confirmation goes to the **new** address.
If it is on, the handler splits the two token/hash pairs and sends both emails;
note GoTrue's field names are reversed (`token_hash_new` → current address,
`token_hash` → new address).
