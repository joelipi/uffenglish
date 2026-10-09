# Supabase auth emails (password reset, email change)

Supabase's built-in auth emails (password reset, email change, magic link, …)
are sent by GoTrue using the project's SMTP sender. Out of the box that is the
default service — **rate-limited to ~2 emails/hour, best-effort** — and its
dashboard templates are single-language. So password reset cannot be relied on
in production, and it is not localized.

We replace it with Supabase's **Send Email Hook**: GoTrue POSTs a signed webhook
to `functions/api/auth-email-hook.js` instead of sending, and that Function sends
the email through **Resend** with the same localized copy as the welcome email.

## Flow

1. GoTrue POSTs `{ user, email_data }` to `/api/auth-email-hook` with the
   `webhook-id` / `webhook-timestamp` / `webhook-signature` headers.
2. The Function verifies the `standardwebhooks` signature with
   `SEND_EMAIL_HOOK_SECRET` (rejecting stale timestamps) — see
   `functions/api/standard-webhook.js`.
3. It resolves the language (`user_metadata.native_language`, falling back to
   the `user_profiles.native_language` lookup with the service role) and builds
   the email (`src/modules/user/auth-email-content.js`).
4. It sends via Resend. Unlike the welcome-email endpoint this is **not
   fail-open**: a missing provider key returns `500` (a silent `200` would leave
   the user with no reset link), and a Resend failure returns `502`.

The email button links to Supabase's own verify endpoint
(`https://<project>.supabase.co/auth/v1/verify?token=<hash>&type=<action>&redirect_to=<url>`),
which verifies the token and redirects to the SPA (`/reset-password`,
`/confirm-email`, …) — the implicit flow the client already uses.

## Localization

Password reset (`recovery`) and email change (`email_change`) are localized to
the full profile-language set (the `auth_email_*` keys in `src/data/strings.js`).
Supabase's other actions (signup/invite/magiclink/reauthentication and the
notification emails) send a correct **fully-English** generic email, so a newly
enabled action never silently sends nothing — add `auth_email_subject_<action>`
keys plus an `ACTION_SUBJECT_KEYS` entry to localize one.

## Setup (one-time, out of band)

1. `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the new
   **`SEND_EMAIL_HOOK_SECRET`** must be set as **Pages secrets** (dashboard).
2. In the Supabase dashboard → **Auth → Hooks → Send Email**: enable it, set the
   URL to `https://<your-domain>/api/auth-email-hook`, generate the secret, and
   paste it into `SEND_EMAIL_HOOK_SECRET`.
3. Ensure every redirect target (`/reset-password`, `/confirm-email`, the site
   origin) is in the project's **Redirect URLs** allow-list.
4. **Set the secrets before enabling the hook** — once the hook is on, every
   auth email goes through this Function, and a misconfiguration breaks them.

Keep `double_confirm_changes` **false**: secure email change sends two emails
with two token/hash pairs, which this handler does not yet split.
