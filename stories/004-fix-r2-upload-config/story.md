# Fix R2 upload 500: SUPABASE_URL/ANON_KEY missing in the Pages Function

## Context

Logged-in users publishing friend-challenge clips (`w`/`wf`) get `[R2Upload] upload failed: HTTP 500 Server misconfigured: SUPABASE_URL/ANON_KEY missing` for every segment, and PostHog records `publish_clips_segment_failed { error: "upload" }`. The 500 is returned by the Cloudflare Pages Function `functions/api/upload-segment.js` when `env.SUPABASE_URL` or `env.SUPABASE_ANON_KEY` is absent from the deployed Function environment.

Root cause: `wrangler.toml` `[vars]` ships `SUPABASE_URL` but not `SUPABASE_ANON_KEY` — commit `a53815e` removed it because having the key in both `wrangler.toml` and the Pages dashboard breaks deploys with `Binding name 'SUPABASE_ANON_KEY' already in use` (documented in `agents.md` §5). The Function therefore depends entirely on the dashboard variable, which is evidently not set in the deployed environment. The client (`src/modules/api/supabase.js`) already solves this exact problem with hardcoded publishable fallbacks; the Function does not.

Fix: give the Function the same built-in fallbacks. The anon key is publishable — it already ships in the client bundle — so hardcoding it server-side is not a secret leak. This makes `/api/upload-segment` work regardless of dashboard/wrangler config, and the dashboard variable becomes optional rather than required.

## Out of Scope

- No changes to the client upload path (`src/modules/video/r2-upload.web.js`, `src/modules/video/video-processor.web.js`) — the client already surfaces server errors correctly and the server fix unblocks it.
- No changes to the auth/ownership logic, the 20 MB cap, the key-namespace check, or the R2 write in the Function.
- No changes to `src/modules/api/supabase.js` or its fallback values.
- No change to the `Bearer JWT` artifact in the 401 response body of `functions/api/upload-segment.js` (a secret-redaction artifact, unrelated to this bug).
- No change to the R2 48h TTL lifecycle (dashboard-configured, per `README.md:98`).

## Implementation approach

Single-file code change in `functions/api/upload-segment.js`, mirroring the client pattern in `src/modules/api/supabase.js`:

1. Add two module-level constants with the same publishable values the client falls back to:
   - `DEFAULT_SUPABASE_URL = 'https://jbrbmbmupjfangqvaevx.supabase.co'`
   - `DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_xd9bYag0bVG7m74CemthjQ_sJEbQG9S'`
2. In `onRequestPost`, after the token check, resolve:
   - `const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;`
   - `const supabaseAnonKey = env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;`
3. Use `supabaseUrl`/`supabaseAnonKey` in both the `/auth/v1/user` and `/rest/v1/user_profiles` fetches (replacing the direct `env.SUPABASE_URL`/`env.SUPABASE_ANON_KEY` reads).
4. Delete the `if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return new Response('Server misconfigured: SUPABASE_URL/ANON_KEY missing', { status: 500 });` branch — the resolved values are always non-empty, so it can never fire.

The Function is a standalone module (no imports), so it is directly unit-testable by calling `onRequestPost({ request, env })` with a plain `request` object exposing `headers.get(name)` and `arrayBuffer()` — no real `Request`/`fetch` needed. `globalThis.fetch` is stubbed to simulate the two Supabase endpoints.

## Tasks

### Task 1 — Add Supabase fallback config to the upload-segment Function

- `functions/api/upload-segment.js` is read
  - → it defines `DEFAULT_SUPABASE_URL` equal to `'https://jbrbmbmupjfangqvaevx.supabase.co'`
  - → it defines `DEFAULT_SUPABASE_ANON_KEY` equal to `'sb_publishable_xd9bYag0bVG7m74CemthjQ_sJEbQG9S'`
  - → `onRequestPost` resolves `supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL` and `supabaseAnonKey = env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY`
  - → the resolved `supabaseUrl`/`supabaseAnonKey` (not `env.*` directly) are used in both the `/auth/v1/user` and `/rest/v1/user_profiles` fetches
  - → the `Server misconfigured: SUPABASE_URL/ANON_KEY missing` 500 branch is removed

### Task 2 — Unit test for the Function

- `npm test -- --run` (vitest, jsdom) is executed
  - → `functions/api/upload-segment.test.js` exists at `functions/api/upload-segment.test.js` and passes
  - → env WITHOUT `SUPABASE_URL`/`SUPABASE_ANON_KEY` + valid token + owned shareCode + valid key → response status 200, body `{ ok: true, url: "https://r2.ultrafastfluency.com/videos/{shareCode}-model-w-response-01.mp4" }`, and `env.UFF_R2.put` was called with the key and `contentType: "video/mp4"` (regression for the reported 500)
  - → env WITH `SUPABASE_URL`/`SUPABASE_ANON_KEY` + valid token + owned shareCode → the stubbed `fetch` was called with the env `SUPABASE_URL` (not the fallback) for both the `/auth/v1/user` and `/rest/v1/user_profiles` calls
  - → request missing `x-share-code` or `x-r2-key` → status 400
  - → key not starting with `videos/{shareCode}-` or not ending in `.mp4`/`.jpg`/`.jpeg` → status 403
  - → request with no `Authorization` header → status 401
  - → stubbed `/auth/v1/user` returns non-ok → status 401
  - → profile row has a `share_code` that differs from `x-share-code` (case-insensitive) → status 403
  - → request with `content-length` header > 20 MB → status 413
  - → happy path (env vars present, valid token, owned shareCode, valid key) → status 200 and `env.UFF_R2.put` called

## Technical Context

- The Function lives at `functions/api/upload-segment.js` and is a Cloudflare Pages Function invoked as `onRequestPost({ request, env })`. It is a standalone module with no imports.
- The client already uses publishable fallbacks in `src/modules/api/supabase.js` (`URL: import.meta.env.VITE_SUPABASE_URL || 'https://jbrbmbmupjfangqvaevx.supabase.co'`, `ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_xd9bYag0bVG7m74CemthjQ_sJEbQG9S'`). The Function's fallbacks must match these values exactly.
- `wrangler.toml` `[vars]` ships `SUPABASE_URL` only. `agents.md` §5 documents that `SUPABASE_ANON_KEY` must NOT be added to `wrangler.toml [vars]` while it also exists in the Pages dashboard, or deploys fail with `Binding name 'SUPABASE_ANON_KEY' already in use`. The code fallback removes the dependency on the dashboard variable entirely, so this story does not touch `wrangler.toml [vars]`.
- Unit test command: `npm test -- --run`. `vitest.config.js` excludes `**/tests/**` and `**/*.spec.js` but not `functions/`, so `functions/api/upload-segment.test.js` is picked up by the default `**/*.{test,spec}.?(c|m)[jt]s?(x)` include.
- The test stubs `globalThis.fetch` (the Function calls `fetch` for `/auth/v1/user` and `/rest/v1/user_profiles`) and passes a plain `request` object with `headers.get(name)` and `arrayBuffer()` — the Function only uses those two members. `env` is a plain object with `UFF_R2.put` stubbed via `vi.fn()`.
- No new packages or versions are introduced; there is no Bootstrap section because no app, service, or package is created.

## Notes

- **Non-automatable deliverable — deployment docs:** update the `SUPABASE_ANON_KEY` comments in `wrangler.toml` (lines 12–14) and `.env.example` (lines 12–15) to state that the Pages dashboard variable is now optional because `/api/upload-segment` falls back to the publishable defaults. Do not add `SUPABASE_ANON_KEY` to `wrangler.toml [vars]` (see Technical Context).
- The anon key is publishable by design (Supabase anon keys are meant to be public; the client already ships it). Hardcoding it in the Function is not a security issue.
- If the vitest jsdom environment does not expose Node's `Response`/`fetch` globals, the test must stub them (e.g. `vi.stubGlobal('fetch', ...)`); the Function constructs `new Response(...)` and calls `fetch(...)`, so both must exist at call time.
- The 413 test can avoid allocating a 20 MB body: the Function checks `content-length` first, so a plain request object whose `headers.get('content-length')` returns `String(20 * 1024 * 1024 + 1)` is sufficient.
- The `Bearer JWT` string in the 401 response body is a pre-existing secret-redaction artifact and is intentionally left untouched.