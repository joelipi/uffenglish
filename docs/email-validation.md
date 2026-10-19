# Signup email validation — the zero-cost screen

Signup rejects addresses that cannot possibly receive mail, using **no paid API,
no account, no API key and no environment variable**.

## What this can and cannot prove

Be precise about the word "exists", because it determines what is worth building.

**Mailbox-level probing is impossible on this platform.** Cloudflare Workers and
Pages cannot open an outbound TCP connection on **port 25** — the port mail
servers listen on:

> "By default, Workers cannot create outbound TCP connections on port 25 to send
> email to SMTP mail servers."
> — [Cloudflare TCP sockets docs](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

`node:net` is available in the runtime, but it cannot reach a mail server, so
`SMTP RCPT TO` probing is out of reach. This is a platform limit, not a pricing
one — paying for an API does not lift it.

**And even where SMTP probing works, it does not prove existence.** Catch-all
domains accept every local part, and the large providers (Gmail, Outlook, Yahoo)
deliberately hide whether an individual mailbox exists. A probe that returned
"accepts" would still not be proof.

**The only reliable existence proof is double opt-in** — the recipient clicking a
link you sent them. This app already does exactly that, and it is the real
answer to "does this mailbox exist":

- `functions/api/welcome-email.js` stores a SHA-256 token hash, emails a
  `/confirm-email?token=…` link, and is **fail-open** so a broken mail provider
  can never fail a signup.
- `supabase/migrations/006_add_email_confirmation.sql` defines
  `confirm_email_hash()` and a trigger that stops a client from forging the flag.
- See [`email-confirmation.md`](./email-confirmation.md) for the full flow.

So the screen here is a **pre-flight filter** for addresses that are *certain* to
bounce. It complements the confirmation click; it does not replace it, and
`user_profiles.email_confirmed` still comes only from the clicked link.

## Why it costs nothing

The one network call is Cloudflare's public DNS-over-HTTPS resolver:

```
GET https://cloudflare-dns.com/dns-query?name=<domain>&type=MX
Accept: application/dns-json
```

It needs no API key, has no per-query billing and no usage tier, and it runs
over the same network as the app. Syntax, disposable and typo screening are pure
functions with no network at all.

Third-party validators were rejected deliberately: their free tiers are a
*shared meter* (100/day, 500/month, 5/day/IP across all users), which is not
"totally free" and can run dry in production.

## The fail-open contract

This screen is the **third** failure contract in this repo, and the difference
matters:

| Module | Contract | Why |
| --- | --- | --- |
| `functions/api/turnstile-verify.js` | fails **closed** | a bot gate must not admit bots |
| `functions/api/welcome-email.js` | fails **open** | the confirmation mail is optional |
| `functions/api/email-validate.js` | fails **open for every uncertainty** | a signup must never be lost because the resolver had a bad minute |

**A signup is the revenue-bearing action.** Coupling it to a DNS lookup means a
resolver fault would otherwise block every new account on the site. So only
*deterministic* verdicts block. Every uncertainty allows signup and logs
`console.warn` so the volume is visible in the Pages logs.

This is not a "best effort" hole: a blocked address still cannot be created. It
is the difference between rejecting a known-bad domain and rejecting the world
when DNS is down.

### Reason codes

The only codes that may produce `valid: false`:

| Code | Meaning |
| --- | --- |
| `empty` | no address was submitted |
| `too-long` | over the 254-character RFC 5321 cap |
| `syntax` | whitespace, a wrong number of `@`, or an empty local part |
| `domain` | a malformed domain label or a non-alphabetic TLD |
| `disposable` | a throwaway / temporary-mail provider |
| `typo` | a high-confidence misspelling; the response carries `suggestion` |
| `domain-not-found` | the domain does not exist (NXDOMAIN) |
| `null-mx` | RFC 7505 Null MX (`0 .`) — the domain declares it accepts no mail |
| `no-mail-route` | no MX record *and* no A/AAAA record, so nothing can deliver |

The code that always allows signup:

| Code | Meaning |
| --- | --- |
| `lookup-unavailable` | SERVFAIL, a timeout, an unreadable body, a non-2xx response, or a non-ASCII domain we decline to look up |

`lookup-unavailable` is also never cached — pinning a domain for ten minutes
after one bad minute from the resolver would be worse than re-querying, which is
free.

## The six DNS branches

`classifyDnsResult(dnsJson, { domain, addressRecords })` is pure and exported, so
every branch is unit-testable without a network.

| Resolver answer | Verdict |
| --- | --- |
| `Status: 3` (NXDOMAIN) | reject `domain-not-found` |
| any other non-zero `Status` (e.g. `2` SERVFAIL), or an unreadable body | allow `lookup-unavailable` |
| `Status: 0` with MX `0 .` (RFC 7505 Null MX) | reject `null-mx` |
| `Status: 0` with ≥1 real MX record | allow `ok` |
| `Status: 0`, no MX, A/AAAA record found | allow `ok` — **implicit MX** |
| `Status: 0`, no MX, no address record | reject `no-mail-route` |

Two of these deserve their own note.

**The Null MX case is why `Status: 0` alone is not good enough.** RFC 7505 lets a
domain answer NOERROR while publishing `0 .`, which means "I accept no mail".
`example.edu` is a live example: `Status: 0`, `Answer: [{ type: 15, data: "0 ." }]`.

**The implicit-MX fallback is required, not optional.** RFC 5321 §5.1 says a
domain with an A or AAAA record and no MX uses that address as an implicit MX.
Rejecting every MX-less domain would therefore reject legitimate setups, so when
the MX query comes back empty the Function queries `type=A`, then `type=AAAA`,
and only then decides. `classifyDnsResult` returns an internal
`needs-address-lookup` sentinel for that third state, so "not looked up" stays
distinguishable from "looked up and empty". **The sentinel is never returned to
a client.**

A non-ASCII domain is not looked up at all: a percent-encoded unicode name can
return NXDOMAIN even when the punycode form exists, so we decline to guess rather
than invent a false rejection.

## Privacy

Only the **domain** is ever sent to the resolver. The local part appears in no
query string, no log line and no error message, and there is a test asserting
exactly that. Nothing is persisted — no D1, no KV, no Cache API, no stored PII.

## Cache semantics

An isolate-local `Map` keyed by domain (never by address, so a signup burst from
one domain costs one lookup):

- `EMAIL_VALIDATE_CACHE_TTL_MS = 600000` (10 minutes; MX TTLs are commonly 300s)
- `EMAIL_VALIDATE_CACHE_MAX_ENTRIES = 500`, FIFO eviction by insertion order
- **only deterministic verdicts are cached**

It is per-isolate and best-effort: Cloudflare runs many isolates, so this lowers
cost rather than guaranteeing one lookup per domain. The local stages (syntax,
disposable, typo) run before the cache and are free anyway.

## Deployment note: there are no variables to set

This feature deliberately reads **no `env` property at all**. That is not just
elegance — `wrangler pages deploy` applies `[vars]` from `wrangler.toml` and
**drops dashboard plain-text variables that are not listed there**, so any new
variable would be a silent production footgun. Adding none removes the class of
bug entirely. (Dashboard *secrets* survive, but this screen needs neither.)

Because of that, `functions/api/email-validate.js` needs no `wrangler.toml`
change and no dashboard configuration.

## Extending the tables

**Disposable domains** — `DISPOSABLE_DOMAINS` in
`src/modules/auth/email-validation-logic.js` is a committed, offline `Set`. It is
never fetched at request time, because a blocklist lookup that fails open would
be worse than no check at all. Matching is on the **exact normalized domain**:
append the domain and nothing else.

> Never add `example.com`, `example.org` or `example.net`. They are the reserved
> documentation domains, and the existing signup specs use `jo@example.com` as
> their identity — blocking them would fail the suite *and* the reserved domains
> are the clearest proof that exact matching (not suffix matching) is correct.

**Typo suggestions** — `DOMAIN_TYPOS`, also exact-match. A wrong entry here
rejects a real signup, so keep it to unambiguous transpositions. Two categories
must stay out:

- `googlemail.com` is a **real Google domain**, not a typo.
- A provider's ccTLDs are real domains too (`yahoo.co.uk`, `yahoo.fr`,
  `yahoo.com.br`). A provider is never matched by prefix, only by its exact
  misspellings.

Both tables are shared with the server: `functions/api/email-validate.js` imports
the same helpers, so the rules are implemented once and cannot drift.

## Layout

| File | Role |
| --- | --- |
| `src/modules/auth/email-validation-logic.js` | pure rules + the never-throwing client wrapper |
| `functions/api/email-validate.js` | the authoritative gate; pure DNS classifier + request handling |
| `src/components/auth/SignupForm.jsx` | calls the check after the captcha gate, before `signUp`; returns reason **codes** |
| `src/components/auth/SignupForm.web.jsx` | resolves codes to copy via `strings.js` |

The hook holds no user-facing text — it returns `emailError` (a reason code) and
`emailSuggestion`, and the view turns them into a localized message. Logic owns
decisions, display owns language.

As of story 070, `/signup` redirects to `/courses` and no longer renders a
form, so the only reachable signup surface is
`src/components/modals/SaveClipsSignupForm.jsx`, which passes `captcha: false`
(the email check still runs; only the Turnstile gate is skipped).

## Testing locally

`npm run dev` proxies `/api` to `http://localhost:8788`, so exercising the real
Function needs `npx wrangler pages dev` alongside Vite. The unit tests stub
`globalThis.fetch` and route by `type=`, so they run offline and deterministically:

```bash
npx vitest run src/modules/auth/email-validation-logic.test.js functions/api/email-validate.test.js
```
