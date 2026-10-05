# Learnings

## A guard over an empty allow-list can pass while its wiring is broken
**Date**: 2026-10-05
**Area**: testing | build
**What happened**: Story 042's generated-config contract guard read `CONFIG_DIR = path.join(__dirname, '../../config')` from `src/config` — one level too high, resolving to `<root>/config`. It passed because the allow-list (`scripts/lib/generated-configs.json`) started empty, so the loop ran zero times; the moment the generator registered a course it would have thrown `ENOENT` instead of validating. Two review rounds found it only when reasoning about the first real registration, not from the green suite.
**Takeaway**: (1) A guard that iterates a data set (allow-list, glob, config list) is untested while that set is empty — exercise it against a fixture/registered entry, or assert the set is non-empty, so the file-reading plumbing is proven. (2) `path.join(__dirname, …)` from a deep source dir is easy to get one level wrong; when a test reads a sibling directory another module writes, prove the writer's path and the reader's path agree (the fix was `CONFIG_DIR = __dirname`). Mirror that in the generator (same `CONFIG_DIR` source), and prove the round trip: register → read → inject a violation → guard goes red.

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
**What happened**: Moving the lesson-video render off the Windows PC split the work across three runtimes that cannot import each other's code: Cloudflare Pages Functions (JS), a Modal CPU orchestrator (Python) and the phone recorder (static HTML). The object layout (`raw/<slug>.mp4`, `raw/status/<jobId>.json`, `pipeline-assets/…`, published `assets/videos/<slug>.mp4|.jpg`) is defined once in `src/modules/video/pipeline-keys.js` and mirrored in `docs/video-pipeline/pipeline_lib.py`, with a parity test pinning the web/poster constants to `scripts/lib/*.js`. Raw takes stay out of the `videos/` 48h lifecycle. `PIPELINE_WORKDIR`/`PIPELINE_WEB_*`/`PIPELINE_CHROME_NO_SANDBOX` let the same `video_pipeline.py` run locally (Windows, unset) and as root in the Debian container (`--no-sandbox`, absolute font `file://` URLs, 720p web target); the local GPU call is wrapped in `with app.run()` only when `modal.is_local()`.
**Takeaway**: (1) Keep cross-runtime constants in one file per language and assert parity in a test — never hand-copy a key prefix. (2) The recorder has no session, so the pipeline endpoints use a single shared `OPERATOR_KEY` sent as `x-operator-key`; it lives only in Pages env + `sessionStorage`, never the static HTML. It is a stopgap: unlisted/noindex plus a shared secret is not strong auth, and Cloudflare Access is the next step. (3) Required fonts must be asserted before Stage 3 so a missing `Kalam-Bold.ttf` cannot silently degrade overlays in the container even though it works on the operator's PC.

---

## `friendClosedResponse` is the ungraded friend-challenge combination
**Date**: 2026-09-19
**Area**: architecture
**What happened**: Determining how to make a lesson record without scoring or feedback took several wrong turns. `simpleVideoUrl` does not suppress feedback (it only changes which media renders); `closedResponse` always emits praise/teacher feedback even without `interactiveVideoUrl`. Only `friendClosedResponse` skips scoring and feedback, and it records fine with `simpleVideoUrl` (phase `simpleVideo` is in `RECORDABLE_PHASES`).
**Takeaway**: For "record, no score, no feedback" use `friendClosedResponse` + `simpleVideoUrl`. Note `simpleVideoUrl` renders text only from `step.subtitles` (not `cue`), so add `subtitles` or the prompt is audio-only. Recap composition is driven by two lesson flags that replaced `webcamOnly` (story 010): `recapSources` (`system`/`friend`/`none`) picks which prompt clips concatenate, `recapOverlay` (`fluency`/`shareCta`/`none`) picks the card.

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

## `peck story load <number>` is ambiguous when two stories share a numeric prefix
**Date**: 2026-10-05
**Area**: workflow
**What happened**: `peck story load 039` silently returned `039-extend-friend-lesson-chain` even though the requested story was `039-homepage-share-code`, and `peck story load 039-homepage-share-code` / `peck story load stories/039-homepage-share-code` both returned "Story not found". The worktree was left on the wrong branch; the right story directory only existed on the `039-homepage-share-code` branch, so `cat stories/039-homepage-share-code/story.md` failed until the branch was checked out manually. (That story was later renumbered to `045-homepage-share-code` when it was rebased onto a `main` that already had a `039`.)
**Takeaway**: `peck story load` matches loosely by number and is unreliable when two stories share a numeric prefix (this repo has both a `039-*` and a `040-*` pair). To load a specific story: `git checkout <full-branch-slug>` then read it with `git show <branch>:stories/<slug>/story.md`. Verify `git branch --show-current` matches the story slug before editing anything.

---

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
## Playwright's `chromium` download is two pieces; the failing specs are the guest-gate, not codecs
**Date**: 2026-10-05
**Area**: testing | tooling
**What happened**: `npx playwright test` failed with `Executable doesn't exist: chromium_headless_shell-1223`. `npx playwright install chromium` (v1.60.0) downloads **two** revision-1223 builds — `chromium-1223` (full, used for headed/`page`-as-browser) and `chromium_headless_shell-1223` (the default headless target). The first run's tail only showed the headless-shell line because it streams last, which briefly looked like the full browser was missing; `ls ~/.cache/ms-playwright` confirmed both plus `ffmpeg-1011`. After install, 60 of 91 configured specs passed.
**What happened (codecs)**: Because `agents.md` §5 says video specs need real Chrome for H.264/AAC, `npx playwright install chrome` (system Google Chrome 154, which also apt-installs the OS libs `--with-deps` would) was installed and `tests/lesson-g-video.spec.js` was re-run with `channel: 'chrome'` via a throwaway config. It failed **identically** (`page.waitForFunction(() => window.appStore.getState().configData)` timeout). Across the full run there were **zero** `Format error`/`undecodable_source_codec`/codec console errors and zero `403 (Forbidden)` — every one of the 28 failures was the documented guest-language gate (`docs/learnings.md:86`): specs await `configData` before dismissing the guest modal, and `configData` is not set until the language is settled.
**Takeaway**: Install browsers with `npx playwright install chromium` and trust `ls ~/.cache/ms-playwright` over the stream tail. Real Chrome is needed only for specs that actually decode H.264/AAC; when a "video" spec times out on `configData`, it is the guest gate, not the browser — verify by grepping the run for codec errors before reaching for `channel: 'chrome'`. Do not add a `channel: 'chrome'` project to `playwright.config.js` to work around this: CI (`playwright.yml`) runs bundled Chromium, and the channel does not change the outcome.

---

## ESLint was never actually installed, and its legacy config pointed at a deleted `js/` tree
**Date**: 2026-10-05
**Area**: tooling
**What happened**: The repo carried a legacy `.eslintrc.json` (added in `b456401` "React Migration") that targeted `js/**/*.{js,jsx}`, but ESLint was not in `package.json`, the lockfile, or `node_modules`, there was no `lint` script, and no workflow ever ran it. The source tree had since moved to `src/`, so even with ESLint the glob matched nothing. The config's one rule was `no-restricted-syntax` (warn) flagging `window.`/`document.` member access outside `*-webonly.*` files. The repo also has eight inline `eslint-disable(-line|-next-line) react-hooks/exhaustive-deps` directives for a plugin that was never configured — under ESLint 10 flat config those become **errors** ("Definition for rule ... was not found").
**Takeaway**: `eslint@^10` is flat-config-only and rejects `ESLINT_USE_FLAT_CONFIG=false`, so `eslint.config.js` (ESM — `"type":"module"`) replaces `.eslintrc.json`: migrate the rule verbatim, retarget the glob to `src/**`, and preserve the `*-webonly.*` exclusion. To make the existing `react-hooks/exhaustive-deps` disable directives resolve without inventing a rule set, register `eslint-plugin-react-hooks` and set the rule to `'off'` (plus `linterOptions.reportUnusedDisableDirectives: 'off'` so the never-enabled suppressions stay quiet). Result: `eslint .` exits 0 with 96 intended `no-restricted-syntax` warnings, 0 errors. Prove the rule can fail by injecting `window.location` into a non-`webonly` `src` file.
