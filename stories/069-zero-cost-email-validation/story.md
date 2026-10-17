# Zero-cost email existence screen at signup (DNS pre-flight, copy kept out of the hook)

## Context

Signup must reject addresses that cannot possibly receive mail, at zero cost and with no third-party account. Two facts bound the design:

- **SMTP mailbox probing is impossible here.** Cloudflare Workers/Pages cannot open outbound TCP on port 25 ("By default, Workers cannot create outbound TCP connections on port 25"), so `node:net` can never reach a mail server from `functions/**`. There is no way to ask a mail server whether one mailbox exists.
- **Even with SMTP it would not prove existence.** Catch-all domains accept every local part and the large providers deliberately hide mailbox existence. The only reliable existence proof is **double opt-in — the recipient clicking a link**, which this repo already has: `functions/api/welcome-email.js` mails `/confirm-email?token=…` and migration `supabase/migrations/006_add_email_confirmation.sql` sets `user_profiles.email_confirmed` (`docs/email-confirmation.md`).

So this story adds a **cheap pre-flight screen** that catches addresses which are *certain* to bounce — malformed, disposable, misspelled, or on a domain with no mail route — and leaves the authoritative proof to the existing confirmation click. It is a complement, not a replacement: nothing in the welcome-email path or the `006` migration changes.

**The network dependency is Cloudflare's free DoH resolver.** `GET https://cloudflare-dns.com/dns-query?name=<domain>&type=MX` with `accept: application/dns-json` is keyless, unmetered and has no per-query billing. Verified live: `gmail.com` → 5 MX records, `kernel.org` → 3, `zzq-not-a-real-tld-4471.zzzz` → `Status: 3` (NXDOMAIN), and `example.edu` → `Status: 0` with a real RFC 7505 Null MX `Answer: ["0 ."]`. Every third-party validator falls short because its free tier is a shared meter (100/day, 500/month, 5/day/IP) that can run dry — rejected as not "totally free". This story adds **no API key, no account, no runtime dependency, and no new environment variable**.

**Where the code goes.** Three layers, mirroring the Turnstile pair that already solves the same shape of problem (`src/modules/auth/turnstile-logic.js` ← pure contract; `functions/api/turnstile-verify.js` ← authoritative server call; `useSignupForm` in `src/components/auth/SignupForm.jsx` ← the gate):

1. `src/modules/auth/email-validation-logic.js` — pure logic (no React, no DOM, no Supabase) plus the one documented `fetch` wrapper, exactly like `verifyTurnstileToken`.
2. `functions/api/email-validate.js` — the real gate, because a client-only check is trivially bypassed. Pages Functions already import pure `src/modules/**` helpers this way (`functions/api/welcome-email.js:21-23`), so the syntax/disposable/typo rules are shared, never duplicated.
3. Wiring in `useSignupForm` (the check runs after the captcha gate and strictly before `supabase.auth.signUp`) and in `SignupForm.web.jsx` (reason **code** → localized copy). Both signup surfaces get it for free because `/signup` and `src/components/modals/SaveClipsSignupForm.jsx` share the hook (the modal passes `captcha: false`).

## Out of Scope

- **Any SMTP/mailbox-level verification**, or any paid/third-party validation API, key or account.
- **Changing the existing welcome-email confirmation flow or the `006` migration.** The pre-flight screen is not a verification signal; `email_confirmed` still comes only from the clicked link.
- **Role-account blocking** (`admin@`, `info@`, `support@`) — legitimate signups for small businesses.
- **Free-provider / corporate-vs-consumer classification, scoring, or batch validation.**
- **New environment variables or secrets.** There must be none, and none are added to `wrangler.toml` `[vars]`; that is what makes this free and deployment-safe.
- **Login, password-reset and profile email forms** — signup only.
- **Subdomain/suffix matching for the disposable list** — the committed set is matched on the exact normalized domain (see Implementation approach §1).
- **Caching or persisting verdicts beyond the Function isolate** — no D1/KV/Cache API, no stored PII.
- **Merging into `main`.** Push the story branch when verified; merging is a separate step.

## Implementation approach

### 1. Shared pure module — `src/modules/auth/email-validation-logic.js`

Header comment states the three facts above (no port 25, existence needs the confirm click, DoH is the only free signal) and that the module is pure apart from `checkEmailAddress`'s documented `fetch`. No React/DOM/Supabase imports; the file is also imported by the Function, so it must have no module-level side effects.

| Export | Contract |
| --- | --- |
| `EMAIL_VALIDATE_PATH` | `'/api/email-validate'` (the client wrapper's only URL). |
| `EMAIL_VALIDATE_TIMEOUT_MS` | `5000` — client-side abort so a hung Function can never hang a signup. |
| `normalizeEmail(raw)` | trim, then lowercase the whole address (local part included) to match Supabase GoTrue's own normalization. Non-string/whitespace → `''`. Idempotent. |
| `MAX_EMAIL_LENGTH` | `254` (RFC 5321 §4.5.3.1 octet cap). |
| `validateEmailSyntax(email)` | `{ valid, reason }` over the normalized value. Reason precedence: `empty` (blank) → `too-long` (>254) → `syntax` (any whitespace, not exactly one `@`, empty local part) → `domain` (no dot, empty label, leading/trailing/consecutive dot, non-alphabetic TLD) → `{ valid: true }`. No local-part dot rules and no domain charset restriction: `jo@example.com`, `jo@example.edu`, `user+tag@gmail.com` and unicode domains pass local shape checks. |
| `extractDomain(email)` | lowercased domain after the last `@`, `''` when there is no `@`. |
| `isDisposableDomain(domain)` | membership in a committed, offline `Set` of throwaway/temp-mail domains (lowercased exact match), documented as hand-curated and appendable. Seed it with `mailinator.com`, `guerrillamail.com`, `10minutemail.com`, `tempmail.com`, `yopmail.com`, `trashmail.com`, `getnada.com`, `sharklasers.com`, `maildrop.cc`, `dispostable.com`. **It must never contain `example.com`/`example.org`/`example.net`** — the existing suites sign up as `jo@example.com`. |
| `suggestDomain(domain)` | exact-domain typo map → corrected domain, or `''` when not confident. At minimum `gmial.com`, `gmai.com`, `gnail.com`, `hotmial.com`, `outlok.com`, `yahho.com` → `gmail.com`/`hotmail.com`/`outlook.com`/`yahoo.com`. **Must not** map `googlemail.com` (a real Google domain) or any legitimate ccTLD variant (`yahoo.co.uk`, `yahoo.fr`, `yahoo.com.br`, …), and must return `''` for every already-correct domain. |
| `checkEmailAddress(email, { fetchImpl } = {})` | POST `EMAIL_VALIDATE_PATH` with `{ email: normalizeEmail(email) }`, `content-type: application/json`, `signal: AbortSignal.timeout(EMAIL_VALIDATE_TIMEOUT_MS)`; return the server verdict `{ valid, reason, suggestion }`. **Never throws.** Network throw, non-2xx, or unparseable body → `{ valid: true, reason: 'lookup-unavailable', suggestion: '' }` (fails OPEN — a signup is never lost to an infrastructure fault, including a dev server with no `/api` behind the proxy). |
| `emailValidationErrorKey(reason)` | reason code → `strings.js` key, with a documented fallback, mirroring `shareCodeErrorStringKey` (`src/modules/user/share-code-entry-logic.js:5-8,30-32`): `empty`→`auth_email_error_required`; `syntax`/`domain`/`too-long`/`bad-request`→`auth_email_error_invalid`; `disposable`→`auth_email_error_disposable`; `typo`→`auth_email_error_typo`; `domain-not-found`/`null-mx`/`no-mail-route`→`auth_email_error_no_mail`; anything else (including the never-rendered `ok`/`lookup-unavailable`) → `auth_email_error_invalid`. |

Only the DoH request leaves the process; syntax, disposable and typo checks are pure and offline. The client never re-implements them — it trusts the Function's `valid`.

### 2. Authoritative gate — `functions/api/email-validate.js`

Same shape as `functions/api/turnstile-verify.js`: exports pure helpers plus `onRequestPost({ request, env })`, uses a local `jsonResponse(body, status = 200)`, `AbortSignal.timeout`, `[email-validate]`-tagged `console.log`/`console.warn`/`console.error`, and is unit-tested by calling `onRequestPost` with plain objects and a stubbed `globalThis.fetch` (`functions/api/turnstile-verify.test.js`).

**Request order** (each earlier stage costs nothing):

1. Body: `request.json().catch(() => null)`; missing/non-string `email`, or a body over `EMAIL_VALIDATE_BODY_MAX_BYTES = 1024` → `400 { valid: false, reason: 'bad-request' }`, no lookup.
2. `normalizeEmail` → `validateEmailSyntax`; invalid → `200 { valid: false, reason }`, no lookup.
3. `isDisposableDomain(extractDomain(email))` → `200 { valid: false, reason: 'disposable' }`, no lookup.
4. `suggestDomain(...)` non-empty → `200 { valid: false, reason: 'typo', suggestion }`, no lookup.
5. DoH MX → `classifyDnsResult`.

Every verdict is `200 { valid, reason, suggestion }` (`reason: 'ok'` and `suggestion: ''` when valid); `400` is reserved for a malformed request. There is no per-IP throttle: abuse is bounded by the domain cache below, and the endpoint reveals nothing beyond "can this domain receive mail".

**`classifyDnsResult(dnsJson, { domain, addressRecords } = {})`** — pure and exported, so every branch is unit-testable without a network:

| Input | Result |
| --- | --- |
| `Status === 3` (NXDOMAIN) | `{ ok: false, reason: 'domain-not-found' }` |
| any other non-zero `Status` (e.g. `2` SERVFAIL), or `dnsJson` null/non-object/no numeric `Status` | `{ ok: true, reason: 'lookup-unavailable' }` — malformed or failed lookups fail OPEN |
| `Status === 0` with a trimmed MX `data` of exactly `0 .` (RFC 7505 Null MX; preference 0, exchange `.`) | `{ ok: false, reason: 'null-mx' }` |
| `Status === 0` with ≥1 non-null MX answer | `{ ok: true }` |
| `Status === 0`, **no** MX answers, caller passed a non-empty `addressRecords` (A/AAAA — implicit MX per RFC 5321 §5.1) | `{ ok: true }` |
| `Status === 0`, no MX answers, caller passed `addressRecords: []` | `{ ok: false, reason: 'no-mail-route' }` |
| `Status === 0`, no MX answers, `addressRecords` omitted/`undefined` | `{ ok: false, reason: 'needs-address-lookup' }` — internal sentinel telling the caller to perform the A/AAAA query; it must never be returned to a client |

The sentinel is deliberate: it makes "not looked up" distinguishable from "looked up and empty", so the Function cannot silently reject an MX-less domain that is perfectly deliverable. `onRequestPost` handles it by querying `type=A`, then `type=AAAA` if A is empty, and re-calling `classifyDnsResult` with the address answers. Rejecting every MX-less domain would be a false negative; the fallback is required, not optional.

**DoH request**: `GET` to `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX` (then `type=A`/`type=AAAA`), header `accept: application/dns-json`, `signal: AbortSignal.timeout(DOH_TIMEOUT_MS = 5000)`, `res.json()` guarded. Only the domain is ever sent — the local part never appears in a query, a log line or an error message.

**Non-ASCII domains**: a percent-encoded unicode name can return NXDOMAIN from DoH even when the punycode domain exists, so a non-ASCII domain is **not** looked up at all — return `{ valid: true, reason: 'lookup-unavailable' }` and `console.warn` once. This preserves the fail-open contract instead of introducing a false rejection.

**Abuse mitigation without a paid service**: an isolate-local `Map` keyed by domain (not by address), TTL `EMAIL_VALIDATE_CACHE_TTL_MS = 600000` (10 minutes — MX TTLs are commonly 300s), bounded at `EMAIL_VALIDATE_CACHE_MAX_ENTRIES = 500` with FIFO eviction by insertion order. It caches **only deterministic DNS verdicts** (`ok`, `domain-not-found`, `null-mx`, `no-mail-route`); `lookup-unavailable` is never cached, so a transient resolver fault cannot pin a domain for ten minutes. Documented as per-isolate and best-effort — Cloudflare may run many isolates, so the cache lowers cost, it does not guarantee one lookup per domain. Local stages (syntax/disposable/typo) run before the cache and are free anyway.

**Three distinct failure contracts, stated explicitly in the file header and in `docs/email-validation.md`:**

| Module | Contract | Why |
| --- | --- | --- |
| `functions/api/turnstile-verify.js` | fails **closed** | it is a bot gate; a broken gate must not admit bots |
| `functions/api/welcome-email.js` | fails **open** (`200 {sent:false, reason}`) | the confirmation email is optional |
| `functions/api/email-validate.js` | fails **open for every uncertainty** (`lookup-unavailable`), blocks only deterministic local/DNS verdicts | a signup must never be lost because the resolver had a bad minute |

Only `syntax`, `domain`, `too-long`, `empty`, `disposable`, `typo`, `domain-not-found`, `null-mx` and `no-mail-route` may produce `valid: false`. Every `lookup-unavailable` path logs `console.warn` so the volume is visible.

### 3. Wiring — hook returns codes, view resolves copy

`useSignupForm` (`src/components/auth/SignupForm.jsx`) gains `emailError` (a reason **code**, `''` when clean) and `emailSuggestion` (a domain or `''`), both reset at the top of `handleSubmit`. After the captcha block and immediately before `supabase.auth.signUp`:

```
const verdict = await checkEmailAddress(normalizeEmail(email));
if (!verdict.valid) { setEmailError(verdict.reason); setEmailSuggestion(verdict.suggestion || ''); return; }
```

The early `return` still runs the existing `finally { setLoading(false) }`, and `signUp` is not called. **`signUp`, the profile insert and the query-cache profile all receive the same `normalizeEmail(email)` value the screen checked** — amended during implementation from "the typed `email`". GoTrue normalizes server-side so either works, but giving the screened address and the created address one string is what makes "one canonical identity" true rather than dependent on a second normalization elsewhere; it also makes the screen's verdict provably about the account that gets created. A `checkEmailAddress` that returns `valid: true` (including `lookup-unavailable`) changes nothing downstream.

`src/components/auth/SignupForm.web.jsx` resolves the code — `Strings.get(emailValidationErrorKey(emailError), lang, { suggestion: emailSuggestion })` — into a second alert (`data-testid="email-error"`, `role="alert"`) beside the existing `error` alert; the hook itself never holds copy. `Strings.get` supports `{placeholder}` replacement (`src/data/strings.js:2772-2796`), so `auth_email_error_typo` reads "That email domain looks misspelled — did you mean {suggestion}?" with localized copy everywhere.

**Both surfaces must render the verdict, not just the standalone form.** `SaveClipsSignupForm.jsx` shares the hook with `captcha: false`, so a blocked address there would re-enable the button with no message — indistinguishable from a broken modal. It renders the same alert.

**Clearing a stale verdict belongs to the hook.** The hook exposes `handleEmailChange(value)`, which sets the address and drops `emailError`/`emailSuggestion` together; the views call it from the email `onChange`. Deciding which state a stale verdict invalidates is logic, not rendering, and two surfaces must recover identically. A view must never destructure a setter the hook does not return — it reads as `undefined` and only throws when the user types, so a structural guard compares the view's destructured names against the hook's returned names.

New `strings.js` keys, each carrying all six locales (`en/es/pt/fr/hi/bn`) with genuine Devanagari `hi` and Bengali `bn` copy: `auth_email_error_required`, `auth_email_error_invalid`, `auth_email_error_disposable`, `auth_email_error_typo`, `auth_email_error_no_mail`.

`src/components/auth/SignupForm.turnstile.test.jsx` currently mocks `turnstile-logic.js` only (`:37-39`), so the new module would perform a real `fetch`. Add `vi.mock('../../modules/auth/email-validation-logic.js')` with a valid default verdict and extend the order assertion at `:111` from `['token','verify','signUp']` to `['token','verify','email','signUp']` — extend the intent (still proves every gate precedes account creation), never weaken it. The email-gate behaviour itself lives in a new dedicated test file rather than bloating the captcha spec.

### 4. Docs

`docs/email-validation.md`: why zero-cost, why port 25 makes SMTP probing impossible here and why double opt-in remains the only existence proof (link `docs/email-confirmation.md`), the exact fail-open contract and every reason code, the DoH endpoint and its six `classifyDnsResult` branches, how to extend the disposable list and the typo map (and what must stay out of them), the cache semantics, and the "no env vars" deployment note (AGENTS.md: a non-secret Pages variable a Function reads must live in `wrangler.toml` `[vars]` — this design adds none). Add the feature to `docs/product.md` in the existing entry format.

## Tasks

### Task 1 - Shared pure logic module + unit tests

- `src/modules/auth/email-validation-logic.js` source (raw text)
  - → exports every name in the §1 table; no React/DOM/Supabase import; no module-level `fetch`; the only `fetch(` call site is inside `checkEmailAddress` (purity guard, comment-stripped only for bare `window`/`document` identifiers, per AGENTS.md)
- `normalizeEmail('  Jo @Example.COM ')` / non-string / `'JO@EXAMPLE.COM'`
  - → `'jo @example.com'` (trim + lowercase), `''`, `'jo@example.com'`; idempotent on the second call
- `validateEmailSyntax` over a table of 12+ inputs
  - → `''`/`'   '` → `empty`; a 255-char address → `too-long`; `'jo'`, `'jo@@example.com'`, `'jo k@example.com'`, `'@example.com'` → `syntax`; `'jo@example'`, `'jo@.example.com'`, `'jo@example..com'`, `'jo@example.com.'`, `'jo@example.c0m'` → `domain`; `'jo@example.com'`, `'jo@example.edu'`, `'user+tag@gmail.com'` → `{ valid: true }`
- `extractDomain` over `'Jo@Example.COM'`, `'jo'`, `''`
  - → `'example.com'`, `''`, `''`
- `isDisposableDomain` over `'mailinator.com'`, `'MAILINATOR.COM'`, `'gmail.com'`, `'example.com'`, `'example.org'`, `'example.net'`, `''`
  - → `true`, `true`, `false`, `false`, `false`, `false`, `false` (the reserved example domains are never flagged)
- `suggestDomain` over `'gmial.com'`, `'gmai.com'`, `'gnail.com'`, `'hotmial.com'`, `'outlok.com'`, `'yahho.com'`, `'gmail.com'`, `'googlemail.com'`, `'yahoo.co.uk'`, `'yahoo.com.br'`, `'kernel.org'`
  - → `'gmail.com'` ×3, `'hotmail.com'`, `'outlook.com'`, `'yahoo.com'`, then `''` for every correct/legitimate/unknown domain
- `checkEmailAddress` with a stubbed `fetchImpl` returning a server verdict
  - → called once with `EMAIL_VALIDATE_PATH`, `POST`, JSON body `{ email: <normalized> }`, an `AbortSignal`; verdict passed through unchanged
- `checkEmailAddress` with `fetchImpl` rejecting / returning `500` / returning a body that is not JSON
  - → `{ valid: true, reason: 'lookup-unavailable', suggestion: '' }` in all three cases, and the call never throws
- `emailValidationErrorKey` over every blockable reason + `'ok'` + an unknown string
  - → the documented keys; fallback `auth_email_error_invalid`; every returned key exists in the **raw** `strings` table exported from `src/data/strings.js` (import the table, not `Strings.get`, per AGENTS.md)

### Task 2 - Pages Function + unit tests

- `functions/api/email-validate.js` importing `normalizeEmail`, `validateEmailSyntax`, `extractDomain`, `isDisposableDomain`, `suggestDomain` from `../../src/modules/auth/email-validation-logic.js` (raw-source guard)
  - → the rule logic is not re-implemented in the Function (same shared-helper pattern as `functions/api/welcome-email.js:21-23`)
- `classifyDnsResult` over the six §2 rows plus the omitted-`addressRecords` sentinel
  - → the exact `{ ok, reason }` from the table; `needs-address-lookup` is the only extra value and is never returned to a client
- `onRequestPost` with a missing/oversized/non-string body
  - → `400 { valid: false, reason: 'bad-request' }`, zero `fetch` calls
- `onRequestPost` with each locally decidable rejection (whitespace-only `'   '` → `empty`, bad syntax `jo@example`, a 255-char address → `too-long`, non-alphabetic TLD `jo@example.c0m` → `domain`, disposable `jo@mailinator.com`, typo `jo@gmial.com`)
  - → `200` with `empty` / `syntax` / `too-long` / `domain` / `disposable` / `typo` + `suggestion: 'gmail.com'` respectively, and **zero** `fetch` calls
- `onRequestPost` with stubbed DoH answers: NXDOMAIN, SERVFAIL, timeout/abort, null MX, real MX, no-MX-with-A, no-MX-no-A
  - → `domain-not-found` / `lookup-unavailable` / `lookup-unavailable` / `null-mx` / `{ valid: true, reason: 'ok' }` / `{ valid: true }` / `no-mail-route`; every `lookup-unavailable` logs `console.warn`
- `onRequestPost` DoH request inspection
  - → URL is `https://cloudflare-dns.com/dns-query?name=example.com&type=MX`, `accept: application/dns-json`, `signal` is an `AbortSignal`; the local part (`jo@`) appears in neither the URL nor any `console.*` call
- `onRequestPost` for a non-ASCII domain (`jo@münchen.de`)
  - → `{ valid: true, reason: 'lookup-unavailable' }` with zero `fetch` calls (no percent-encoded NXDOMAIN false negative)
- `onRequestPost` twice for the same domain (`jo@gmail.com`, `kim@gmail.com`) and twice for different domains
  - → 1 DoH fetch for the repeat pair (2 addresses), 2 fetches for the differing domains; a SERVFAIL domain is **not** served from cache on the second call
- cache TTL + bound (`vi.resetModules()` + dynamic import for a fresh isolate, `Date.now` spied)
  - → `EMAIL_VALIDATE_CACHE_TTL_MS === 600000`, `EMAIL_VALIDATE_CACHE_MAX_ENTRIES === 500`; a verdict is refetched after the TTL elapses; inserting `MAX + 1` domains evicts the oldest (re-querying it fetches again, the newest does not)
- Function raw source + `wrangler.toml`
  - → no `env.` property access anywhere in the Function, and `[vars]` contains no email-validation key (the design adds zero variables/secrets)

### Task 3 - Hook, view, strings, turnstile test update, wiring guard

- `src/components/auth/SignupForm.jsx`
  - → `emailError` + `emailSuggestion` state, reset at submit start; `checkEmailAddress(normalizeEmail(email))` after the captcha block and before `supabase.auth.signUp`; a `valid: false` verdict sets both and returns without calling `signUp`
- `src/components/auth/SignupForm.web.jsx`
  - → second `role="alert"` element (`data-testid="email-error"`) rendering `Strings.get(emailValidationErrorKey(emailError), lang, { suggestion: emailSuggestion })`
- new `strings.js` keys with `en/es/pt/fr/hi/bn` copy (real Devanagari/Bengali)
  - → `src/data/strings.test.js` stays green (raw-table script checks)
- new `src/components/auth/SignupForm.email-validation.test.jsx` (mocks supabase, `queryClient`, `sendWelcomeEmail`, `turnstile-logic`, `email-validation-logic` — same harness style as the turnstile spec)
  - → order `['token','verify','email','signUp']`; a `disposable` verdict gives `signUpSpy` 0 calls, `insertCalls.length === 0`, `emailError === 'disposable'`; a `typo` verdict also sets `emailSuggestion === 'gmail.com'`; a `valid: true` verdict calls `signUp` once and leaves `emailError === ''`; `{ captcha: false }` (the SaveClips path) still performs the email check and blocks signup on rejection; `checkEmailAddress` receives the normalized address
- new `src/components/auth/SignupForm.email-display.test.jsx` (renders `SignupForm.web.jsx` with `useSignupForm` mocked to return a fixed code + suggestion, `TurnstileCaptcha.web.jsx` and `SignupConsent` mocked, guest language `hi`)
  - → the alert text equals `Strings.get(emailValidationErrorKey('disposable'), 'hi')` (Devanagari, not English); switching the mocked code changes the rendered copy; the `typo` code interpolates the suggested domain
- updated `src/components/auth/SignupForm.turnstile.test.jsx`
  - → `email-validation-logic.js` mocked with a valid verdict, order assertion extended to `['token','verify','email','signUp']`, and the four existing captcha cases still pass (including `captcha: false`)
- new `src/components/auth/signup-email-check-wiring.test.js` (raw source, no comment-stripping)
  - → slice `SignupForm.jsx` from `async function handleSubmit(e) {` to the first `\n    return {`; assert index order `getCaptchaToken(` < `checkEmailAddress(` < `supabase.auth.signUp(` and that `setEmailError(` appears before `supabase.auth.signUp(`; proving it can fail by moving the check below `signUp` in a scratch copy turns it red (record the mutation in the completion report)
- no new dependencies, no `wrangler.toml` edit
  - → `package.json` unchanged; no bootstrap commands needed

### Task 4 - Docs + full local verification

- `docs/email-validation.md`
  - → covers the five §4 anchors (zero-cost/DoH, port 25 + double opt-in, fail-open contract with every reason code, extending disposable/typo tables, cache semantics and zero env vars), links `docs/email-confirmation.md`
- `docs/product.md` Features list
  - → entry for the zero-cost signup email screen, matching the existing entry format
- `npx vitest run` + `npm run build` + `npm run lint`
  - → all green, verified locally; no GitHub workflow dispatched to "check" (AGENTS.md)
- story branch
  - → committed and `git push -u origin email-validation` (merging separate)

## Acceptance criteria

1. `src/modules/auth/email-validation-logic.js` exports every name in the §1 table and is pure (no React/DOM/Supabase; `fetch` only inside `checkEmailAddress`) → `email-validation-logic.test.js` *module surface* + *purity guard*.
2. `normalizeEmail` trims, lowercases local part and domain, returns `''` for non-strings, and is idempotent → `email-validation-logic.test.js` *normalizeEmail*.
3. `validateEmailSyntax` returns exactly `empty`, `too-long`, `syntax`, `domain` for the table in Task 1 and `{ valid: true }` for `jo@example.com`, `jo@example.edu`, `user+tag@gmail.com` → `email-validation-logic.test.js` *validateEmailSyntax*.
4. `extractDomain` returns the lowercased domain or `''` → `email-validation-logic.test.js` *extractDomain*.
5. `isDisposableDomain` is a committed offline `Set`, case-insensitive on exact domains, true for the seeded throwaway domains, and **false for `example.com`/`example.org`/`example.net` and real providers** → `email-validation-logic.test.js` *isDisposableDomain*.
6. `suggestDomain` maps each seeded typo, returns `''` for already-correct domains, and never maps `googlemail.com`, `yahoo.co.uk`, `yahoo.fr`, `yahoo.com.br` → `email-validation-logic.test.js` *suggestDomain*.
7. `checkEmailAddress` POSTs to `/api/email-validate` with the normalized address wrapped in `{ email }`, sends an `AbortSignal`, and passes the server verdict through → `email-validation-logic.test.js` *checkEmailAddress*.
8. `checkEmailAddress` fails OPEN and never throws: rejecting `fetchImpl`, a `500`, and an unparseable body each yield `{ valid: true, reason: 'lookup-unavailable', suggestion: '' }` → `email-validation-logic.test.js` *fail-open*.
9. `emailValidationErrorKey` maps every blockable reason to its documented key, falls back to `auth_email_error_invalid`, and every key it can return exists in the raw `strings` table → `email-validation-logic.test.js` *emailValidationErrorKey* + raw-table assertion.
10. `classifyDnsResult` implements all six §2 branches plus the `needs-address-lookup` sentinel: NXDOMAIN→`domain-not-found`; SERVFAIL/malformed→`{ ok: true, reason: 'lookup-unavailable' }`; `0 .`→`null-mx`; real MX→`{ ok: true }`; no MX + A/AAAA→`{ ok: true }`; no MX + `[]`→`no-mail-route`; omitted `addressRecords`→`needs-address-lookup` → `email-validate.test.js` *classifyDnsResult*.
11. `onRequestPost` returns `400 { valid: false, reason: 'bad-request' }` for a missing, non-string or oversized body and performs no lookup → `email-validate.test.js` *bad request*.
12. `onRequestPost` rejects each deterministic local reason (`syntax`, `domain`, `too-long`, `empty`, `disposable`, `typo` with `suggestion`) with `200` and zero `fetch` calls → `email-validate.test.js` *local rejections*.
13. `onRequestPost` rejects `domain-not-found`, `null-mx` and `no-mail-route`, and allows `lookup-unavailable` (SERVFAIL, timeout, malformed DoH body) with `valid: true` plus a `console.warn` → `email-validate.test.js` *DNS verdicts* + *fail-open*.
14. The DoH call is `GET https://cloudflare-dns.com/dns-query?name=<domain>&type=MX` with `accept: application/dns-json` and an `AbortSignal` timeout; the query and every log carry the domain only, never the local part → `email-validate.test.js` *DoH request*.
15. An MX-less domain triggers the implicit-MX fallback (`type=A`, then `type=AAAA` when A is empty) and is allowed when either returns a record → `email-validate.test.js` *implicit MX fallback*.
16. A non-ASCII domain is not looked up and returns `valid: true` (`lookup-unavailable`) → `email-validate.test.js` *non-ASCII domain*.
17. A second signup on the same domain costs one DoH fetch; different domains do not share a cache entry; `lookup-unavailable` is never cached → `email-validate.test.js` *domain cache*.
18. Cache constants are `600000`/`500`, entries expire after the TTL, and FIFO eviction bounds the map → `email-validate.test.js` *cache TTL and bound*.
19. The Function reads no `env.` property and `wrangler.toml` `[vars]` gains no email-validation key (no new variable or secret) → `email-validate.test.js` *no configuration*.
20. `useSignupForm` calls `checkEmailAddress` after the captcha gate and before `supabase.auth.signUp`, and a `valid: false` verdict calls `signUp` zero times and inserts zero profile rows → `SignupForm.email-validation.test.jsx` *order* + *rejection*.
21. A `valid: false` verdict sets `emailError` to the reason **code** and `emailSuggestion` to the server suggestion; a `valid: true` verdict leaves `emailError === ''` and signs up once → `SignupForm.email-validation.test.jsx` *reason codes*.
22. The email gate applies to the `captcha: false` surface (`SaveClipsSignupForm`) as well → `SignupForm.email-validation.test.jsx` *captcha false still checks*.
23. `SignupForm.web.jsx` resolves the code through `strings.js` — a non-English (`hi`) render shows the Devanagari copy, a different code changes the copy, and the typo copy interpolates the suggestion → `SignupForm.email-display.test.jsx`.
24. `SignupForm.turnstile.test.jsx` mocks the new module and asserts `['token','verify','email','signUp']`, with all prior captcha cases still green → `SignupForm.turnstile.test.jsx`.
25. A raw-source guard proves the wiring order in `handleSubmit` and fails when the check is moved after `signUp` → `signup-email-check-wiring.test.js`.
26. New `strings.js` keys carry `en/es/pt/fr/hi/bn` with real Devanagari and Bengali copy → `src/data/strings.test.js`.
27. `docs/email-validation.md` documents the zero-cost/DoH rationale, the port-25 impossibility plus the `/confirm-email` double opt-in relationship, the fail-open contract and reason codes, how to extend the disposable/typo tables, the cache semantics and the zero-new-variables rule → `email-validate.test.js` *docs guard* (reads the doc, asserts each anchor; failable by deleting an anchor).
28. `npx vitest run` reports 0 failures and `npm run build` + `npm run lint` exit 0, all verified locally with no GitHub workflow dispatched; the branch is pushed (`git push -u origin email-validation`) → commands and output recorded in the completion report.

## Notes for reviewers

- **Why the client cannot be the gate:** a browser check is bypassed by posting straight to Supabase. The Function is authoritative; the client wrapper exists only to produce one verdict the hook can branch on, and it fails open so a missing/blocked `/api` (dev server, proxy down) never blocks a signup.
- **Why `needs-address-lookup` exists:** without a three-state "no MX" answer, the Function would have to either reject every MX-less domain (false negative) or silently allow unlooked-up ones. The sentinel keeps the decision inside the pure classifier.
- **Why `lookup-unavailable` is not cached:** caching an infrastructure failure would turn a momentary resolver problem into a ten-minute "no opinion" window for that domain; it is fail-open anyway, so re-querying is free.
- **Local Function testing:** `npm run dev` proxies `/api` to `http://localhost:8788` (`vite.config.js:161-164`), so exercising the real Function needs `npx wrangler pages dev` alongside Vite. Unit tests stub `globalThis.fetch` instead (the `functions/api/turnstile-verify.test.js` pattern) — no network in CI.
- **Numerical/behavioural anchors:** the null-MX fixture is the live `example.edu` shape (`Status: 0`, `Answer: [{type:'MX', data:'0 .'}]`); the NXDOMAIN fixture is `zzq-not-a-real-tld-4471.zzzz` (`Status: 3`); the reserved example domains are asserted unflagged because `jo@example.com` is the identity every existing signup spec uses.
