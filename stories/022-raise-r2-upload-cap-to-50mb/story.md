# Raise the R2 upload cap from 20 MB to 50 MB

## Context

The per-object upload cap is 20 MB, enforced in three places that must stay in lockstep:

- `functions/api/upload-segment.js:17` — `const MAX_BYTES = 20 * 1024 * 1024;` (the real server-side guard; returns `413 Payload Too Large` at `:80-86`).
- `src/modules/video/video-processor.web.js:1406` — `export const MAX_R2_UPLOAD_BYTES = 20 * 1024 * 1024;` (client pre-check; skips the request rather than sending a guaranteed 413).
- `functions/api/upload-segment.test.js:12` — `const MAX_BYTES = 20 * 1024 * 1024;` (test fixture).

Story 021 publishes the concatenated end-of-lesson recap to R2 as `videos/<shareCode>-<courseId>-<lessonId>-complete.mp4`, but a full stitched lesson can exceed 20 MB, so the complete video is silently skipped (`reason: 'too-large'`) while its per-segment clips publish. 20 MB is too small for concatenated videos; this story raises the cap to **50 MB** across all three sites.

**Platform check (researched).** 50 MB is well within Cloudflare's limits: the inbound request body limit is plan-based (Free/Pro 100 MB, Business 200 MB, Enterprise up to 5 GB) and R2's single-PUT object limit is 5 GiB. The app's 20 MB was purely self-imposed. The one real constraint is the **128 MB per-isolate memory** limit: the Function buffers the whole body with `await request.arrayBuffer()` (`upload-segment.js:83`), so several concurrent 50 MB uploads in one isolate could approach it. 50 MB is still safe for this app's traffic; streaming the body to R2 is a possible future hardening, not required here.

## Out of Scope

- **No streaming rewrite of the Function.** It keeps `await request.arrayBuffer()` + `env.UFF_R2.put(key, bytes, …)`. Switching to `put(key, request.body, …)` (R2 accepts a `ReadableStream`) would reduce memory pressure but changes the size-check semantics; deferred.
- **No change to the per-segment upload size.** Segments are short clips and stay far below either cap; only the shared constant changes.
- **No change to the key naming, namespace, auth, or 48h TTL.** Only the byte threshold moves.
- **No new endpoint, no R2 lifecycle config, no DB migration.**
- **No UI copy or translations.**
- **No change to the `too-large` skip behavior** — it still skips (logged + tracked) above the new cap; only the threshold changes.

## Implementation approach

### 1. Single source of truth for the cap

The cap is currently duplicated in three files. Introduce one shared constant module so the Function, the client, and the test cannot drift:

`src/modules/video/r2-upload-limits.js` (new):

```js
// Max bytes per R2 object accepted by functions/api/upload-segment.js.
// Shared by the Function (server guard), the client pre-check, and tests so the
// three cannot drift. 50 MB fits Cloudflare's inbound body limit (100 MB free)
// and R2's 5 GiB single-PUT limit.
export const MAX_R2_UPLOAD_BYTES = 50 * 1024 * 1024;
```

- `functions/api/upload-segment.js` imports it and uses it as `MAX_BYTES` (keep the local name or alias it; the Function already imports from `src/modules/api/supabase-constants.js`, so a `src/` import is an established pattern — verify with `npx wrangler pages functions build`).
- `src/modules/video/video-processor.web.js` re-exports it (`export { MAX_R2_UPLOAD_BYTES } from './r2-upload-limits.js';`) so existing importers (`complete-video-upload.test.js`, `complete-video-wiring.test.js`) keep working, and uses it in the size gate.
- `functions/api/upload-segment.test.js` imports it instead of hardcoding.

### 2. Update the human-readable strings

- `functions/api/upload-segment.js:17` comment → `// 50 MB per object`.
- `video-processor.web.js` comments/logs that say "20 MB" → "50 MB" (`:1403-1404`, `:1413`, `:1436`).
- `docs/product.md` (Features + Known Limitations) and `agents.md` (R2 note) → 50 MB.

### 3. Behavior

The only behavioral change is the threshold: a 20–50 MB complete video now uploads instead of being skipped; a >50 MB one is still skipped with `reason: 'too-large'`. The Function's `413` boundary moves from `> 20 MB` to `> 50 MB`.

## Tasks

### Task 1 - Shared cap constant (`src/modules/video/r2-upload-limits.test.js`, new)

- `MAX_R2_UPLOAD_BYTES` imported from `r2-upload-limits.js`
  - → equals `50 * 1024 * 1024` (52 428 800)
- `functions/api/upload-segment.js` source read as text
  - → imports `MAX_R2_UPLOAD_BYTES` from `../../src/modules/video/r2-upload-limits.js`
  - → does not contain the literal `20 * 1024 * 1024`
- `src/modules/video/video-processor.web.js` source read as text
  - → re-exports `MAX_R2_UPLOAD_BYTES` from `./r2-upload-limits.js`
  - → does not contain the literal `20 * 1024 * 1024`
- `functions/api/upload-segment.test.js` source read as text
  - → imports `MAX_R2_UPLOAD_BYTES` (does not hardcode `20 * 1024 * 1024`)

### Task 2 - Function enforces 50 MB (`functions/api/upload-segment.test.js`, extend existing)

- `onRequestPost` with `contentLength: MAX_R2_UPLOAD_BYTES` (exactly 50 MB), valid token, matching share_code
  - → `200` (the boundary is inclusive; only `> cap` is rejected)
- `onRequestPost` with `contentLength: MAX_R2_UPLOAD_BYTES + 1`
  - → `413`, `env.UFF_R2.put` not called
- `onRequestPost` with no `content-length` and `bytes: new ArrayBuffer(MAX_R2_UPLOAD_BYTES + 1)`
  - → `413`, `env.UFF_R2.put` not called
- `onRequestPost` with no `content-length` and `bytes: new ArrayBuffer(MAX_R2_UPLOAD_BYTES)` (exactly 50 MB)
  - → `200`, `env.UFF_R2.put` called once
- the existing 20 MB-era 413 tests are updated to use `MAX_R2_UPLOAD_BYTES` (no hardcoded 20 MB remains)

### Task 3 - Client gate uses 50 MB (`src/modules/video/complete-video-upload.test.js`, extend existing)

- `uploadCompleteVideoToR2` with a transcoded blob of `MAX_R2_UPLOAD_BYTES` bytes
  - → `{ uploaded: true, url }` (exactly at the cap uploads)
- `uploadCompleteVideoToR2` with a transcoded blob of `MAX_R2_UPLOAD_BYTES + 1` bytes
  - → `{ uploaded: false, reason: 'too-large' }`, `uploadSegmentToR2` not called
- `MAX_R2_UPLOAD_BYTES` imported from `video-processor.web.js`
  - → equals `50 * 1024 * 1024`

### Task 4 - Docs

- `docs/product.md` read
  - → the concatenated-recap Feature bullet and the Known Limitations entry say 50 MB, not 20 MB
- `agents.md` read
  - → the R2 note says 50 MB, not 20 MB

## Technical Context

- **No new dependencies.** Reuses the existing module graph. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (`vitest.config.js` runs colocated `*.test.js`, excludes `tests/**`/`*.spec.js`). Gate: `npm test -- --run`.
- **Cross-directory Function import is established:** `functions/api/upload-segment.js:14` already imports `../../src/modules/api/supabase-constants.js`. A constants-only module with no `import.meta.env` bundles fine; verify with `npx wrangler pages functions build --outdir=/tmp/uff-fn-build` and grep the output for `52428800`.
- **Cloudflare limits (researched 2026):** inbound request body Free/Pro 100 MB, Business 200 MB, Enterprise up to 5 GB; R2 single-PUT 5 GiB; 128 MB memory per isolate. 50 MB is safe; the buffering memory note is documented in Context.
- **Existing tests that reference the cap:** `functions/api/upload-segment.test.js:12,155-173`; `src/modules/video/complete-video-upload.test.js:29,97-98`; `src/modules/video/complete-video-wiring.test.js:53` (asserts the export exists — unaffected).
- **`poster-avatar-wiring.test.js:28`** slices `exportSegmentsToR2` to `indexOf('export const MAX_R2_UPLOAD_BYTES')`. If the constant becomes a re-export line, keep that exact string present (the re-export satisfies it) so the slice still terminates correctly.

## Notes

- **Confirmed product behaviour (user request):** raise the per-object upload cap from 20 MB to 50 MB because 20 MB is too small for concatenated videos.
- **Decision (assumption, evidenced):** 50 MB is within Cloudflare's platform limits (100 MB free-tier inbound body, R2 5 GiB), so no plan change is needed. The app's 20 MB was self-imposed.
- **Decision:** single-source the cap in `src/modules/video/r2-upload-limits.js` so the Function, client, and tests cannot drift (the code reviewer flagged the hand-mirrored copies in story 021).
- **Known trade-off:** the Function buffers the whole body (`request.arrayBuffer()`), and the 128 MB isolate memory limit is per-isolate, not per-request. At 50 MB this is acceptable for current traffic; streaming to R2 is deferred (Out of Scope).
- **Manual verification:** finish a lesson whose concatenated recap is 20–50 MB and confirm `videos/<shareCode>-<courseId>-<lessonId>-complete.mp4` now appears on R2 (previously skipped); confirm a >50 MB recap is still skipped with a `publish_complete_video_skipped` event.
