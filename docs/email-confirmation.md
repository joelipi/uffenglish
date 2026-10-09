# Non-blocking email confirmation

A "click to confirm" welcome email is sent when a user signs up. It is
**optional**: signup completes and the user is signed in immediately, and the
confirmation click only records that the address is real so the account is
known to be reachable.

## Why not Supabase's built-in confirmation?

Supabase's `auth.email.enable_confirmations` is all-or-nothing: with it on,
`signUp()` withholds the session until the user clicks, which **blocks signup**.
The product requires signup to stay non-blocking, so confirmation is implemented
at the application layer and `enable_confirmations` stays **off**.

## Flow

1. `SignupForm` completes signup, creates the `user_profiles` row and signs the
   user in, then fires `sendWelcomeEmail()` **without awaiting it**
   (`src/modules/user/email-confirmation.js`). A failed or slow email can never
   affect the signup.
2. `functions/api/welcome-email.js` verifies the caller's Supabase JWT, mints a
   32-byte random token, stores **only its SHA-256 hex** in
   `email_confirm_tokens` with the **service-role key** (nobody else is granted
   the table, so a user cannot mint their own token and self-confirm) and emails
   a link to `/confirm-email?token=<raw>` via [Resend](https://resend.com).
3. The confirm page (`src/routes/ConfirmEmailRoute.jsx`) hashes the token with
   WebCrypto and calls the anon `confirm_email_hash()` RPC (migration 006),
   which marks `user_profiles.email_confirmed = true` and burns the token. The
   flag is **server-managed**: a `before insert or update` trigger rejects any
   `anon`/`authenticated` write to `email_confirmed`/`email_confirmed_at`, so a
   user cannot PATCH their own profile to self-confirm — only the RPC (running
   as the function owner) may set it.

The endpoint is deliberately fail-open: without `RESEND_API_KEY`, or when the
provider/store fails, it returns `200 { sent: false, reason }` instead of an
error, so a broken email provider cannot surface as a signup failure. It only
returns `401` when the caller is not an authenticated user (that stops the
endpoint being used to spam arbitrary addresses).

## Localization

The email copy lives in the shared translation table (`src/data/strings.js`,
keys `email_welcome_subject|heading|intro|cta|ignore`), so the email localizes
to **every language the app translates** and picks up new ones automatically —
no per-language code. `SignupForm` stashes the chosen `native_language` in
Supabase `user_metadata`; `functions/api/welcome-email.js` resolves it
(`src/modules/user/email-language.js`) in this order:

1. `user_metadata.native_language`
2. the request's `Accept-Language`
3. English

`email-language.js` accepts **any** two-letter code and normalizes full tags
(`es-ES` → `ES`, `pt_BR` → `PT`). Chinese is special-cased: `TW`, `zh-TW`,
`zh-Hant`, `zh-HK` and `zh-MO` all resolve to `TW` (**non-simplified /
Traditional**), while `zh`, `zh-CN` and `zh-Hans` resolve to `ZH` (Simplified).
An unknown-but-valid code (e.g. `XX`) falls back to the English copy.

To add a language, add its code to the five `email_welcome_*` entries — the
signup languages (EN/ES/PT/FR/DE/KO/HI/BN) plus ZH and TW are seeded today.

## Setup (one-time, out of band)

1. Create a [Resend](https://resend.com) account and verify the sending domain
   (DNS: SPF/DKIM). `welcome@ultrafastfluency.com` is the default sender.
2. Apply migration `supabase/migrations/006_add_email_confirmation.sql`
   (auto-deploys on merge to `main`).
3. Set `RESEND_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` as **Pages secrets** in
   the Cloudflare dashboard (Settings → Environment variables). The service-role
   key is used only to write/rotate token rows; it must never reach the client.
   `EMAIL_FROM` and `SITE_URL` are plain vars in `wrangler.toml` `[vars]` and
   must stay there, or `wrangler pages deploy` unset them (see `AGENTS.md`).
   `SITE_URL` roots the confirmation link and is preferred over the request
   `Origin`, so set it per environment (staging overrides it with
   `https://s.ultrafastfluency.com`).
4. Apply `006` to any project whose `user_profiles` predates it **before**
   deploying the Function.

## Querying verified accounts

```sql
select id, email, email_confirmed, email_confirmed_at
from public.user_profiles
where email_confirmed;
```

`email_confirmed` is not granted to `anon`, so anonymous callers cannot read it.
