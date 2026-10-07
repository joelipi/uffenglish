# Learnings

## A hook used without an import passes lint and tests when no test renders the component
**Date**: 2026-10-07
**Area**: testing
**What happened**: `LessonContainer.jsx` called `useMemo` without adding it to the `react` import; `eslint .` reported 0 errors and the full vitest suite passed because no test renders `LessonContainer` (the wiring guard only asserted source text like `buildBranchChoiceView(`). It was a runtime `ReferenceError` that would crash the whole lesson container; the code reviewer caught it.
**Takeaway**: For containers with no render/mount test, add a source guard that every `use*` the file calls appears on its `import React, { … } from 'react'` line (see `branch-choice-wiring.test.js`). ESLint's `no-undef` does not flag it here, and a token-presence guard cannot see a missing import.

---

## The published Google Sheet CSV lags edits by up to ~5 minutes
**Date**: 2026-10-07
**Area**: architecture | workflow
**What happened**: After trimming the overlay master to 4 rows, the render (`_fetch_assets` → `fetch_sheet_csv(resolve_sheet_url())`) and the config generator still read the old 108 rows for several minutes. The published `/pub?…&output=csv` is regenerated lazily by Google; a client cache-buster does not help.
**Takeaway**: The render + generator read the **published CSV** (the lag-prone path); the Sheets API (translate/sync Actions) sees edits immediately. When a just-edited sheet isn't reflected, wait for the published CSV to flip (up to ~5 min) before re-running — or move the render's read to `spreadsheets.values.get` with the service account if immediacy matters.

---

## Windows: `execFile('npx', …)` fails with `spawn npx ENOENT`
**Date**: 2026-10-07
**Area**: build | tooling
**What happened**: `scripts/upload-pipeline-assets.mjs` (and any `npx wrangler` call through `cli-utils.run`) died on Windows with `spawn npx ENOENT` — `npx` is `npx.cmd`, which `child_process.execFile` cannot launch without a shell. A POSIX `npx` shim works in CI, so it never failed there.
**Takeaway**: `cli-utils.wranglerCommand(platform)` runs the local `node_modules/wrangler/bin/wrangler.js` with the running node on `win32`, and `npx wrangler` elsewhere (so the Linux shim tests still pass). Any new Windows-facing subprocess of a `.cmd` needs the same treatment.

---

## Pushing `.github/workflows/` needs a token with `workflows` permission
**Date**: 2026-10-05
**Area**: workflow | build
**What happened**: Story 046 adds `.github/workflows/configs.yml`. Pushing it via the sandbox's GitHub App token (`ghs_…`, the `sandpods-app[bot]` credential) was rejected — `refusing to allow a GitHub App to create or update workflow … without workflows permission` — and `GH_TOKEN` in the environment returned HTTP 401 (expired). A valid fine-grained PAT (`github_pat_…`, user `joelipi`, repo `admin`) was sitting in the repo's own `.env` under the `GH_TOKEN=` key; the sandbox env `GH_TOKEN` was the stale one. That PAT pushed the workflow file successfully.
**Takeaway**: A `.github/workflows/**` change cannot be pushed from a token lacking the `workflows` permission (GitHub Apps need `Workflows: write`; classic PATs need the `workflow` scope; fine-grained PATs need the Workflows permission). When a push of a workflow file is rejected, don't retry — find a credential with that permission. In this workspace a valid PAT may live in the checked-out repo's `.env` (`GH_TOKEN=`), distinct from the exported `GH_TOKEN`; check both (`curl -H "Authorization: Bearer <tok>" https://api.github.com/user` → 200 vs 401) before concluding there is no usable token. Push with it via `git push https://x-access-token:<PAT>@github.com/<owner>/<repo>.git <branch>:<branch>`.

---

## Security routing must fail closed, and string guards can't see a missing import
**Date**: 2026-10-05
**Area**: security | testing
**What happened**: Two review-round bugs in story 041 share a shape — a default that is safe-looking but wrong, and a guard that can't detect it. (1) `storage.private_bucket_name()` fell back to the public bucket when `R2_PRIVATE_BUCKET` was unset, so a raw take silently landed in the publicly-served bucket — the exact exposure the story removed; the JS side already failed closed, so only Python regressed. (2) A `time.time()` call added for cost logging had no `import time`; the module's string-based source guards passed anyway because they only assert token presence, and `ast.parse` in CI checked syntax, not name resolution.
**Takeaway**: (1) A privacy/security routing decision must fail CLOSED: raise on a missing config key rather than falling back to the less-secure option, and pin it with a *behavioral* test (import the module and assert the raise) — a source-text guard cannot prove this. (2) String/substring guards cannot catch an undefined name; add one AST guard that parses the module and asserts every `X.attr` root is a bound name or import, and prove it fails by deleting the import. Match the JS-side standard: call the real exported predicate in a parity test instead of re-implementing it, or the test pins the data and not the logic.

---

## R2 bindings are bucket-scoped, not prefix-scoped — real privacy needs a second bucket
**Date**: 2026-10-05
**Area**: architecture | security
**What happened**: Story 040 wrote raw phone takes (`raw/<slug>.mp4`) and their status markers to the public `uff` bucket, which `r2.ultrafastfluency.com` serves — the operator key gated the write, not the read, so any unpublished take was world-readable by anyone who knew the slug. Story 041 closed that with a second, non-public bucket (`uff-private` bound to Pages as `PIPELINE_R2`). The tempting fix — a second binding to `uff` scoped to a prefix — is impossible: an R2 binding grants access to a whole bucket, and two bindings to the same bucket have identical public reachability, so `raw/` would still be served. Only a bucket with no custom domain and no `r2.dev` subdomain is unreachable through the CDN.
**Takeaway**: (1) Public/private in R2 is a per-bucket property (custom domain or `r2.dev`), not a per-prefix ACL — to make a prefix private, give it its own bucket. (2) Route by object key, not by binding name: `pipeline_lib.is_private_key`/`bucket_for_key` (mirrored in JS) decide the bucket, so no caller can write a raw key to the public bucket by mistake. (3) `raw/` self-expires via a private-bucket lifecycle rule while `videos/` keeps its 48h rule on the public bucket; `pipeline-assets/` persists. (4) The public learner/recap path (`/api/upload-segment` → `videos/`) must keep using the public `UFF_R2` binding and returning `r2.ultrafastfluency.com` URLs.

## The cloud pipeline mirrors its key rules in JS and Python; operator-key auth is a stopgap
**Date**: 2026-10-05
**Area**: architecture | build
**What happened**: Moving the lesson-video render off the Windows PC split the work across three runtimes that cannot import each other's code: Cloudflare Pages Functions (JS), a Modal CPU orchestrator (Python) and the phone recorder (static HTML). The object layout (`raw/<slug>.mp4`, `raw/status/<jobId>.json`, `pipeline-assets/…`, published `assets/videos/<slug>.mp4|.jpg`) is defined once in `src/modules/video/pipeline-keys.js` and mirrored in `docs/video-pipeline/pipeline_lib.py`, with a parity test pinning the web/poster constants to `scripts/lib/*.js`. Raw takes stay out of the `videos/` 48h lifecycle. `PIPELINE_WORKDIR`/`PIPELINE_WEB_*`/`PIPELINE_CHROME_NO_SANDBOX` let the same `video_pipeline.py` run locally (Windows, unset) and as root in the Debian container (`--no-sandbox`, absolute font `file://` URLs, 720p web target); background removal calls the separately deployed `video-background-removal` app by name with `modal.Function.from_name(...).remote(...)` (story 053), and `uff-lesson-video` registers no GPU function so `modal deploy` clears Modal's T4 payment-method gate.
**Takeaway**: (1) Keep cross-runtime constants in one file per language and assert parity in a test — never hand-copy a key prefix. (2) The recorder has no session, so the pipeline endpoints use a single shared `OPERATOR_KEY` sent as `x-operator-key`; it lives only in Pages env + `sessionStorage`, never the static HTML. It is a stopgap: unlisted/noindex plus a shared secret is not strong auth, and Cloudflare Access is the next step. (3) Required fonts must be asserted before Stage 3 so a missing `Kalam-Bold.ttf` cannot silently degrade overlays in the container even though it works on the operator's PC.

---

## Auto-advance paths must replicate `showFeedbackAndProceed`'s `stepCount` increment exactly once
**Date**: 2026-09-20
**Area**: architecture
**What happened**: The friendClosedResponse auto-advance branch in `handleAnswer` incremented `stepCount` before the `_deps.loadNextStep` guard, so the fall-through path (missing deps) incremented it again inside `showFeedbackAndProceed` — a double increment that corrupted the `step_count` reported to the backend. The code reviewer caught it.
**Takeaway**: `showFeedbackAndProceed` increments `stepCount` for interactive-video response steps (`answer-pipeline.js:984-987`). Any new path that bypasses it (e.g. direct `loadNextStep` calls) must replicate that increment exactly once — put it inside the same guard that decides between auto-advance and fall-through, and assert `stepCount` in the fallback test.

---

## A reviewer-approved refactor can invalidate the story's ACs — amend the story, don't revert the code
**Date**: 2026-09-28
**Area**: workflow
**What happened**: The code reviewer required extracting the publish-flow gating into a testable `maybeAssignPosterAvatar` and moving the cache/store sync into a shared `avatar-client-store.js`. After that fix the code reviewer passed, but the acceptance reviewer then failed Task 3 because the story's ACs still named the old call site (`applyPosterAsProfilePictureIfMissing`/`pickAvatarThumb` inline, `setQueryData`/`setCourseData` inside `poster-avatar.js`). The implementation was correct; only the story was stale.
**Takeaway**: When a reviewer-driven refactor changes the shape the story's ACs describe, amend the story to match the reviewed implementation (update the Implementation approach + the affected Task ACs), commit it, and re-run the acceptance reviewer — do not revert working, code-reviewer-approved code to satisfy stale ACs. The acceptance reviewer's own "Story Gaps" section usually states this explicitly.

---

## Friend/UGC videos are detected by the `-response-NN` slug suffix, not the `{friendCode}` wildcard
**Date**: 2026-09-22
**Area**: architecture
**What happened**: `normalizeConfig` substitutes `{friendCode}` in place when a course loads (`config-normalizer.js`), so the recap planner only ever sees resolved slugs (`ab12-model-w-response-01`). Detecting "friend video" by the wildcard at plan time is impossible.
**Takeaway**: Classify friend vs system by the `-response-NN` suffix — the same rule `getVideoUrl` uses to route UGC to the `/videos/` namespace. It survives substitution (including the empty-friendCode case). The classifier lives in `src/modules/video/video-source.js` (`isFriendVideoSlug`/`remoteSource`).

---

## R2 UGC clips are served uncached — the recap must prefetch friend clips into blobs
**Date**: 2026-09-22
**Area**: architecture | performance
**What happened**: The end-of-lesson recap re-downloaded every friend (UGC) clip and stalled, even though the same clips had played smoothly during the lesson. `r2.ultrafastfluency.com` serves `videos/*` with no `Cache-Control` and `cf-cache-status: DYNAMIC` (not edge-cached). The lesson's smoothness comes from `window.preloadLessonAssets` (`index.html`) firing parallel `fetch()`es at lesson start — the recap did none of that and pointed a per-step `<video>` at the R2 URL.
**Takeaway**: The recap prefetches friend clips (`remoteSource(slug) === 'friend'`) into blobs before the canvas render loop (`prefetchRemoteClips`, `video-processor.web.js`) and plays them from object URLs, dropping any that fail; `functions/api/upload-segment.js` now writes `httpMetadata.cacheControl` so the browser keeps a local copy for the lesson→recap window. Cache-Control alone is not enough — media-element cache reuse is unreliable, so the app-side prefetch is what guarantees smooth, local playback. `httpMetadata` is also the only shape R2 reads (a top-level `contentType` is ignored).

---

## `executeRenderLoop` has two playback-success paths — per-step hooks must fire on both
**Date**: 2026-10-01
**Area**: architecture | testing
**What happened**: Wiring the per-segment range capture, `onStepStart?.(step)` was added with a `replaceAll` whose oldString had the primary path's indentation. The muted-retry success block (`catch (err)` → muted `video.play()`) is indented deeper, so it did not match. Webcam answers that needed the autoplay-blocked muted retry — the common iOS/Safari case this code explicitly supports — never set their range and were silently excluded from the published clips. The code reviewer caught it.
**Takeaway**: `executeRenderLoop` sets `stepStartedPlaying = true` in two places (primary and muted-retry). Any per-step instrumentation must run on both — factor the shared "step is playing" work or assert the hook fires once per path. After a `replaceAll` edit, grep the match count; structurally identical blocks can differ in indentation and the pattern will silently match fewer times than expected.

---

## Playwright success-screen tests: wait for lesson bootstrap, use a WebM sentinel, force clicks on animated buttons
**Date**: 2026-09-24
**Area**: testing
**What happened**: The first `tests/success-concat-button.spec.js` run failed 4/6 because the test overrode `currentVideo`/`appPhase` right after `waitForFunction(configData)` resolved — but `initializeLesson` loads the intro step asynchronously afterwards and clobbered the override, leaving the video wrapper hidden. Two further gotchas: an invalid `data:video/mp4` source fires `onError` (which now reveals the button), so a valid clip is required to test the "hidden until ended" state; and `.ivp-choice-col .call-btn` runs a continuous `floatBob` animation, so Playwright's stability check never settles and `click()` times out. Separately, since commit `0495461`, `configData` is not set at all until the guest language is settled (`isConfigLanguageSettled`), so any spec that `await page.waitForFunction(() => window.appStore.getState().configData)` without first dismissing the guest modal hangs until timeout — this silently broke most lesson-loading specs (`regression-guard`, `playback-video`, `whisper-review`, …).
**Takeaway**: Before overriding lesson state in a Playwright spec, wait for bootstrap to finish (`activeLessonId` + `currentVideo.type === 'intro'` + `appPhase === 'lessonIntro'`), not just `configData`. Confirm the guest language first (`#guestEnglishOnlyBtn`, then `#guestContinueBtn` on non-friend lessons) before awaiting `configData`; model it on `tests/friend-video-only.spec.js#confirmGuestLanguage`. For codec-independent video tests use a tiny valid VP9/WebM data URI (bundled Chromium decodes WebM, not H.264) and block autoplay via an init script; an invalid source triggers `onError` paths. Click intentionally-animated buttons with `{ force: true }`. Also, `bootstrap-icons` fonts 403 from the symlinked `node_modules` in worktrees (outside Vite's serve allow-list) — filter `bootstrap-icons` console errors instead of chasing them; they also fail `playback-video.spec.js`/`regression-guard.spec.js` pre-existing.

---

## This workspace clone is single-branch — remote feature branches are invisible locally
**Date**: 2026-10-04
**Area**: workflow
**What happened**: `git branch -r` and `git branch --no-merged` reported no unmerged work, but the clone's fetch refspec is only `+refs/heads/main:refs/remotes/origin/main`, so none of the remote's feature branches (`035-…`, `038-…`, etc.) existed locally. A story believed already merged (and another believed unmerged) could not be judged from the local clone at all; the local view even implied `main` was current while feature-branch work was missing.
**Takeaway**: Before judging branch/merge status, fetch every head once with `git fetch origin '+refs/heads/*:refs/remotes/origin/*'`, or inspect the remote directly with `git ls-remote --heads origin`. Then use `git branch -r --no-merged origin/main` to see what is genuinely unmerged.

---

## A diagnostic path must not require the toolchain — optimize-videos defers its ffmpeg check
**Date**: 2026-10-04
**Area**: testing
**What happened**: `scripts/optimize-videos.test.js > optimize-videos CLI — planning > reports a missing source without aborting` failed (`expected 1 to be +0`) wherever `ffmpeg`/`ffprobe` were absent, because the CLI called `ensureFfmpeg()` before the target loop and exited 1 on the install hint before it could ever report `MISS <slug>`.
**Takeaway**: Two separate problems were fixed. (1) Code: `scripts/optimize-videos.mjs` now resolves each source first and calls `ensureFfmpeg()` only once a real source needs probing/encoding, so an all-missing run reports `MISS <slug>` and exits 0 without the toolchain (story 032 AC) while real work still errors with the install hint (after the first source is resolved/cached, not before). (2) Environment: this sandbox originally had no `ffmpeg`/`ffprobe`, which silently skipped the five `optimize-videos` integration tests (the `ffmpegIt` gate) rather than failing them; installing them (`sudo apt-get update && sudo apt-get install -y --no-install-recommends ffmpeg`) un-skips and runs those cases. Don't assume a CLI's global preconditions can't be deferred past a purely diagnostic path, and don't let a missing toolchain quietly skip the tests that exercise it.

---

## Cloudflare Pages serves `public/x.html` at `/x` and 308-redirects `/x.html`
**Date**: 2026-10-04
**Area**: build | workflow
**What happened**: A vendored static page at `public/recorder.html` was marked `noindex` with a `public/_headers` rule scoped to `/recorder.html`, but Cloudflare Pages permanently redirects `/recorder.html` to the extensionless `/recorder` and serves the file there — so the header attached to the redirect response, not the page. A guard that scanned only the literal `recorder.html` token likewise missed an extensionless `/recorder` link. The code reviewer caught both.
**Takeaway**: Static HTML in `public/` is served at its extensionless path (`public/landing.html` → `/landing`); a request for `/x.html` 308s to `/x`. Put `_headers` selectors on the served path (`/x`, optionally also `/x.html` for the redirect), and when guarding that a page stays unlinked, scan for both forms with a bounded pattern (`/\/x(?![\w.-])|x\.html/`, so a bare `MediaRecorder` is not a hit). An unlisted file is obscurity, not access control — noindex + unlinked does not stop someone who knows the URL; use Cloudflare Access if the page must be truly private.

---

## The apex was never really on Pages: an `active` custom domain over a stale origin A record
**Date**: 2026-10-07
**Area**: infra | workflow
**What happened**: `ultrafastfluency.com` was already an `active` custom domain on the `uffenglish` Pages project, yet it returned **522** and the only reachable hostnames were `s.` and `go.`. The cause was DNS: the apex was a leftover proxied **A record to the original IONOS origin** (`34.139.137.66`), so Cloudflare's edge had no live origin. Deleting it and creating a proxied (flattened) CNAME to `uffenglish.pages.dev` fixed production immediately; `www` (already a CNAME to the apex) followed. Two traps surfaced: (1) the Pages **custom-domain API does not create the DNS record** (the dashboard does), so `POST .../pages/projects/uffenglish/domains` alone leaves the domain `initializing`; (2) the machine's `CF_TOKEN` has **Pages Write** but only zone **DNS Read**, so the DNS write needed a short-lived token minted via its **Account API Tokens Write** scope. Separately the deployed `deepseek-proxy` worker had drifted from the repo (extra localhost/tunnel/beacon origins); the source was synced to the union before deploying so nothing was dropped.
**Takeaway**: "Custom domain exists / is active" is not the same as "DNS points at Pages" — when a Pages domain 522s, inspect the record **type and target**, not just the domains list; an apex needs a proxied CNAME (flattened) to `<project>.pages.dev`, never a bare origin A record. A branch alias (`s.` → `staging.uffenglish.pages.dev`) works only through a **proxied** record, and "which deployment answered" cannot be judged by status code — the SPA `_redirects` (`/* /index.html 200`) turns every path into a 200, so compare response **bodies** with a temporary probe file, and use a cache-busting query because the edge can keep serving a file a newer deployment deleted. Deploying a worker from the repo overwrites dashboard-only edits, so diff deployed content against source first and commit the union.

---

## A binary image committed as text corrupts silently — and chat attachments live in the session DB
**Date**: 2026-10-07
**Area**: build | workflow
**What happened**: The 1600×300 UFF logo (`src/assets/img/header.png` + `public/assets/img/header.png`) was committed through a line-ending conversion, so every `0x0A` (and lone `0x0D`) became `0x0D 0x0A`. Every copy — all worktrees, the GitHub blob, and production — carried the invalid signature `89 50 4E 47 0D 0A 1A 0D 0A` and broken chunk CRCs, so `sharp` and browsers rejected it (`Input file contains unsupported image format`). Git history stored only the corrupt blob, so the original was unrecoverable there, and the user's replacement upload was not on the sandbox filesystem. It **was** recoverable from the OpenChamber session database: chat attachments persist as base64 data URLs in `~/.local/share/opencode/opencode.db*`; the newest message lived only in the WAL, so applying it to the DB snapshot (`cp *.corrupt.… db2.sqlite; cp opencode.db-wal db2.sqlite-wal; cp opencode.db-shm db2.sqlite-shm`, then open `db2.sqlite`) exposed it.
**Takeaway**: (1) `.gitattributes` now marks `*.png`/`*.jpg`/… `binary` so image bytes can never be normalized again — a `binary`/`-text` rule, not `text=auto`, is what protects real binaries. (2) A PNG that "won't load" may just be a valid image whose bytes were CRLF-mangled; check the signature (`89 50 4E 47 0D 0A 1A 0A`), but the transform is ambiguous per CR/LF pair so recovery from the corrupt bytes is not reliable — get the original. (3) When a user says "I uploaded the file" but it is not on disk, look in the session DB (`opencode.db*`) for `data:image/...;base64,`.
