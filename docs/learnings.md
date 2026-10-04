# Learnings

## `video-processor.native.jsx` is an unwired placeholder, not a live renderer
**Date**: 2026-09-19
**Area**: architecture
**What happened**: A change to the shared `VideoRenderPlanner` (adding a tailing `variant` field) was flagged as breaking native, but `video-processor.native.jsx` has no importer, no `react-native`/`expo` dependency in `package.json`, and Vite does not resolve `.native.jsx`. It is reference code for a future RN port; only its `exportSegmentsToR2` is a true no-op stub.
**Takeaway**: Keep platform-agnostic domain logic (planner, CTA builders, overlay decision table) in `video-processor-logic.js`; keep only drawing in `video-processor.web.js`. When changing the shared planner contract, note in the native file's header that it does not implement the new field rather than adding speculative code to dead code.

---

## `friendClosedResponse` is the ungraded friend-challenge combination
**Date**: 2026-09-19
**Area**: architecture
**What happened**: Determining how to make a lesson record without scoring or feedback took several wrong turns. `simpleVideoUrl` does not suppress feedback (it only changes which media renders); `closedResponse` always emits praise/teacher feedback even without `interactiveVideoUrl`. Only `friendClosedResponse` skips scoring and feedback, and it records fine with `simpleVideoUrl` (phase `simpleVideo` is in `RECORDABLE_PHASES`).
**Takeaway**: For "record, no score, no feedback" use `friendClosedResponse` + `simpleVideoUrl`. Note `simpleVideoUrl` renders text only from `step.subtitles` (not `cue`), so add `subtitles` or the prompt is audio-only. Recap composition is driven by two lesson flags that replaced `webcamOnly` (story 010): `recapSources` (`system`/`friend`/`none`) picks which prompt clips concatenate, `recapOverlay` (`fluency`/`shareCta`/`none`) picks the card.

---

## Pages Functions can import from `src/` — verify with `wrangler pages functions build`
**Date**: 2026-09-20
**Area**: build | architecture
**What happened**: To dedupe Supabase fallback constants between the SPA (`src/modules/api/supabase.js`) and the Pages Function (`functions/api/upload-segment.js`), I extracted `src/modules/api/supabase-constants.js` and imported it from the Function via `../../src/...`. `wrangler pages functions build --outdir=...` compiled successfully and the constants were bundled into the output.
**Takeaway**: A constants-only module in `src/` can be imported by a Pages Function as long as it has no `import.meta.env` (which the Function bundle can't resolve). Verify any cross-directory Function import with `npx wrangler pages functions build --outdir=/tmp/...` and grep the output for the expected value.

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

## Course configs are fetched by courseId — guard tests must glob `src/config/*.json`
**Date**: 2026-09-22
**Area**: testing
**What happened**: `AppLayout.jsx` fetches `/src/config/${courseId}.json`, so any JSON in `src/config/` can be a live course. A config-invariant test that hardcoded `['model.json', 'friend.json']` would silently miss a future course config with friend slugs but no `recapSources: 'friend'` flag.
**Takeaway**: For config-invariant guards (e.g. "every friend-slug step lives in a `recapSources: 'friend'` lesson"), glob all `src/config/*.json` with `readdirSync` instead of hardcoding file names.

---

## i18n structure: strings.js + languages.js + derived LOCALE_MAP
**Date**: 2026-09-22
**Area**: architecture
**What happened**: Adding Hindi/Bengali required touching every UI string plus three separate language dropdowns; the profile components each carried a hand-maintained `LOCALE_MAP` that had already drifted from the language list by 8 languages, and the code reviewer flagged the duplication.
**Takeaway**: UI copy lives in `src/data/strings.js` (every key must carry `hi`/`bn` — verify with a Devanagari/Bengali script regex over the exported `strings` table). Language dropdowns read `GUEST_LANGUAGES`/`PROFILE_LANGUAGES`/`SIGNUP_LANGUAGES` from `src/data/languages.js`; `LOCALE_MAP` is derived from `PROFILE_LANGUAGES` (`Object.fromEntries(...)`) so it cannot drift. When adding a language, update all three lists + every strings.js key; never hand-edit a locale map.

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
