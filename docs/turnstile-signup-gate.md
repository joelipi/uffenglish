# Cloudflare Turnstile signup gate

Cloudflare Turnstile protects the **standalone `/signup` form** against bot
account creation. This doc covers what is protected, why, and what has to be
configured for it to work.

## What is protected

| Surface | Path | Turnstile |
| --- | --- | --- |
| Signup page | `/signup` (also reached via `/signup?redirect=…`) | **protected** |
| Success-step modal | `SaveClipsModal` → `SaveClipsSignupForm` | **not protected** |

Both forms share `useSignupForm` (`src/components/auth/SignupForm.jsx`), so the
opt-out is a flag on that hook rather than a forked form:

```js
// src/components/auth/SignupForm.web.jsx — protected
useSignupForm({ onSignupSuccess, getCaptchaToken: … })

// src/components/modals/SaveClipsSignupForm.jsx — opted out
useSignupForm({ onSignupSuccess, nativeLanguage, captcha: false })
```

### Why the success-step modal is excluded

`SaveClipsModal` is a native `<dialog>` that stays **closed** until the guest
presses the create-video button. The Turnstile script is `async defer` and loads
once for the whole SPA, so its render pass has already finished by the time the
dialog opens — a widget mounted into a closed dialog gets no challenge and no
token. Excluding it is therefore not just a preference but the only behaviour
that works without deferring script load to the modal.

If that form ever needs protecting too, load
`https://challenges.cloudflare.com/turnstile/v0/api.js` lazily inside the modal
and render the widget only while `dialog.open` is true.

## How it works

```
browser                    Pages Function              Cloudflare
   │                            │                          │
   │  POST /api/turnstile-verify │                          │
   │  { token } ───────────────▶ │                          │
   │                            │  siteverify (secret) ───▶ │
   │                            │ ◀──── { success, action,  │
   │                            │        hostname }         │
   │  { ok: true } ◀────────── │                          │
   │                            │                          │
   │  supabase.auth.signUp() — only after ok:true          │
```

The browser **never** calls `siteverify` directly. The token is single-use and
expires after ~5 minutes, so the form pulls a **fresh** token at submit time
rather than reusing the one captured at render
(`TurnstileCaptcha.getToken()` → `turnstile.execute()` when the cache is empty,
and `expired-callback` drops a stale token).

## Files

| File | Role |
| --- | --- |
| `src/modules/auth/turnstile-logic.js` | Pure contract: site key, action, verify call. No React, no DOM. |
| `src/components/auth/TurnstileCaptcha.web.jsx` | The widget. Renders explicitly via `window.turnstile.render()`. |
| `functions/api/turnstile-verify.js` | Pages Function. Canonical `siteverify` proxy. |
| `src/components/auth/SignupForm.jsx` | `captcha` / `getCaptchaToken` options; the gate itself. |
| `index.html` | The `async defer` Turnstile script tag. |

## Configuration

### `VITE_TURNSTILE_SITE_KEY` — public, build-time

Ships in the client bundle like `VITE_SUPABASE_ANON_KEY`. A committed default in
`turnstile-logic.js` keeps a local dev server with no env file working; override
at build time. Documented in `.env.example`.

### `TURNSTILE_SECRET` — secret, server-only

A **Cloudflare Pages secret** on the project `uffenglish` (dashboard only —
never commit it, never put it in `wrangler.toml [vars]`). Read by the Function as
`env.TURNSTILE_SECRET`.

The Function **fails closed**: with no secret, or no allowlist, it returns 500
and no account is created. This is deliberate — an open captcha endpoint is
worse than a broken signup.

### `TURNSTILE_HOSTNAMES` — non-secret, `wrangler.toml [vars]`

Comma-separated frontend hostnames whose tokens the Function accepts. Must stay
in sync with the widget's domain list in the Cloudflare dashboard, because
`siteverify` returns the hostname the challenge was actually **solved** on.

**Never add `localhost` or `127.0.0.1` to the production allowlist.** The widget
is registered for those hostnames (so the challenge renders in dev), but a
production backend must not trust a token solved there.

## Adding a domain

Adding a frontend domain takes **two** steps — the widget's domain list and
`TURNSTILE_HOSTNAMES` — and siteverify checks both:

1. Update the widget's domains in the Cloudflare dashboard (or
   `PUT /accounts/{id}/challenges/turnstile/widgets/{sitekey}` — **PUT**, not
   PATCH; PATCH returns `10405 Method not allowed`).
2. Add the hostname to `TURNSTILE_HOSTNAMES` in `wrangler.toml [vars]` and
   redeploy.

Miss either one and signups from that domain fail closed with
`hostname-not-allowed`.

## Testing

```
npx vitest run src/modules/auth/turnstile-logic.test.js \
                functions/api/turnstile-verify.test.js \
                src/components/auth/SignupForm.turnstile.test.jsx \
                src/components/auth/TurnstileCaptcha.web.test.jsx
```

The Function is tested by calling `onRequestPost({ request, env })` directly
with plain objects and a stubbed `fetch`. The widget is tested against a mocked
`window.turnstile`, including the token-expiry and error paths.
