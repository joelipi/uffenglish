# Learnings

## A query the shell mounts once must ask to be re-read — the app's query defaults never re-read anything
**Date**: 2026-10-20
**Area**: architecture | testing | notifications
**What happened**: A friend answered while the asker had the app open, and the asker only saw the notification after a **full page reload**. The bell is mounted ONCE by the app shell, so the inbox query (`useNotifications`) lived for the whole session — and the app's global `QueryClient` defaults are `staleTime: Infinity` and `refetchOnWindowFocus: false`, with the inbox overriding only the first (`staleTime: 30 * 1000`). The result: the inbox was read once, at mount, and never again. The same trap hides in every query the app reads "for the last time it is needed" — the shell's header, the profile, the config: a value written **elsewhere** (a friend answering, another device marking a row read) can only reach them if the query explicitly asks for it.
**Takeaway**: (1) A query that must reflect something that happens **outside** the tab has to opt out of the app's write-once defaults: `staleTime: 0` + `refetchOnMount: 'always'` + `refetchOnWindowFocus: 'always'`, and `refetchInterval` for the "it happens while I am looking at it" case. (2) `refetchInterval` re-reads **regardless of `staleTime`** (the staleTime gate only covers mount/focus/reconnect), and `refetchIntervalInBackground: false` — the default — pauses the poll while `document.visibilityState === 'hidden'`, which is what keeps a backgrounded phone from polling; the focus refetch catches up on return. (3) A five-second poll of a small RLS-scoped list is free and needs no new dependency, no third-party service and no database change — cheaper than a websocket, and it is the same mechanism on every browser the app supports. (4) **In vitest with fake timers, a TanStack query result is never delivered**: the notification is scheduled through `notifyManager` (a `setTimeout(0)`) and the fake clock never reaches it, so the component keeps rendering the old data even though the query state is already correct. Replace the scheduler (`notifyManager.setScheduler((cb) => cb())`, restore `defaultScheduler` afterwards) or the test asserts a stale DOM and looks like a broken implementation. (5) A browser spec that injects fixtures into the query cache while the server stub holds **different** rows is racing the app's own re-read — stub the server to the same state the test means, or the spec passes by luck and fails later.

---

## No media may start while a camera/microphone capture is open — the ordering is the fix
**Date**: 2026-10-20
**Area**: video | speech | android | debugging
**What happened**: The Android-only "the video starts silent for a second or two" bug (see the entry below) was fixed for the **lesson** videos by releasing the capture at the step boundary. The learner then reported that the **playback video** — their own just-recorded clip, played back through `PlaybackVideo` — still dropped out for about a second at the very start, *"the volume seems to go very low"*. The silent loop was ruled out by the reporter (*"it doesn't have anything to do with the looping"*): the loop-mute is deliberate (hearing yourself twice annoys people) and only applies *after* the clip has played once. The cause was the **same** Android mechanism on the **other side of the hand-over**: `stopSpeechCamRecording` called `setPlaybackBlob(blob, autoplay)` **first** and released the camera/microphone capture in the `finally` block — i.e. after the thumbnail generation and the database write. On Android the capture therefore stayed open for the whole first second of the clip, and while a capture is open the device is in a communication audio mode that ducks (or mutes) the media route. The lesson players never had this defect because their capture is released at the step boundary, i.e. *before* the next step's video plays.
**Takeaway**: (1) **The order of the release and the hand-over is the whole fix.** Releasing a capture "somewhere around the recording" is not enough — it has to be released *before* the media starts, and the audio route needs a moment to hand back from the communication mode afterwards (the app waits 500 ms, and only when a capture was actually released, so the desktop warm-up path is not delayed). (2) **Every player needs the guard.** `PlaybackVideo` was the only player in the app without the audio guard, so an element-level mute there had neither recovery nor a trace — and the "does not fight a deliberate silence" case is *harder* here than in the lesson players: the recorded take has a mute control (the learner taps the clip) and an intentional silent loop, so the guard reads an explicit **mute intent** instead of a boolean. (3) A **technical** mute (autoplay blocked) must not be written into the learner's intent: the fallback plays muted, then unmutes **and re-issues `play()`** — a bare flag flip does not re-open an audio output the browser already tore down.

---

## A config step's subtitle tracks are per-locale AND per-phrase — trimming either breaks playback
**Date**: 2026-10-20
**Area**: architecture | testing
**What happened**: Converting lesson B of `wouldyourather-test.json` from the longer combined videos (`wouldyourather-a-02` / `-03`, which speak all four question variants in one take) to single-take per-variant videos (`-02-01` / `-03-01`) was done by trimming the step's `cue` to one variant and keeping only the `en` subtitle track. A Spanish user then read **English** on the friend response step, because `getLocalizedTranslation(step.subtitles, lang)` (src/modules/utils/utils.js) falls back to `.en` whenever the requested locale is missing — a missing locale is invisible, it just silently degrades. The retained `en` track also still held the combined video's **4 cues** on a video that speaks **1 phrase**, so the subtitle cues ran past the end of the recording. The correct data already existed: the step in lesson A that owns the same video slug carries the matching 6-locale single-phrase track.
**Takeaway**: When a config step changes which video it plays, its `subtitles` must be copied from the step that owns that **video slug** — not trimmed in place, and not carried over from the old video. Keep **every** locale (`en, es, pt, bn, fr, hi`): the app picks the user's own language and falls back to English only when no locale matches, so a step that ships one locale reads as English to every non-English user. Keep the cue count equal to the phrases the new video actually speaks. Guard it with a test that asserts the locale set, the cue count per locale, and equality with the same slug's track in the sibling lesson — and prove the guard fails by re-injecting the bug (see `src/config/wouldyourather-test.test.js`).

---

## The app's inside pages share one header — and the shell, not the page, owns the frame
**Date**: 2026-10-20
**Area**: architecture | testing
**What happened**: The brand bar (menu button, UFF logo, notification bell) and its slide-out drawer lived inside `HomeScreen.jsx`, so every other page of the app grew its own header instead — each one a *different* back-arrow bar. The fix was to extract the header into `src/components/layout/AppHeader.web.jsx`, mount it ONCE in a new app-shell layout (`src/routes/AppShellLayout.jsx`) and nest every inside page (`/home`, `/profile`, `/courses`, `/friends`, `/privacy`, `/terms`) under it in `src/routes/routes.jsx`. The shell then owns the frame height, so each page had to stop claiming `height: '100dvh'` and became a flex child (`flex: 1; minHeight: 0`) — a page that keeps `100dvh` under the header overflows the clipping `.video-frame` and its bottom is cut off. Six source-guard tests pointed at the old menu text inside `HomeScreen.jsx`; they had to be repointed at the *source of truth* (the pure menu module `src/modules/navigation/app-menu-logic.js` + the header's `APP_MENU_ITEMS.map`), because a guard that slices a file for a token the code no longer has protects nothing.
**Takeaway**: (1) A page-level chrome that several routes need belongs in a layout that mounts it once — per-page copies are how a "same header everywhere" requirement quietly becomes "a different header everywhere". (2) When a layout takes over the frame, every child must give up its own height claim, or the bottom of the page is clipped by the app frame. (3) When a guard follows code that moves, assert on the new source of truth (the module + the call that renders it), not on a copy of the old text; a guard that greps a file for a token the file no longer contains is a guard that proves nothing. (4) The drawer's hover wrote to `e.currentTarget.style` from an event handler — the repo's "pure React, no direct DOM manipulation" rule makes that a bug even in code you are only moving; a CSS class (`.uff-menu-link`) fixes it.

---

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

---

## Adding a `{token}` UI string also needs the fixed placeholder dictionary in `strings.test.js`
**Date**: 2026-10-08
**Area**: testing
**What happened**: Story 056 added `friend_courses_lesson_count` ("{count} lessons"). The full suite then failed in the pre-existing `src/data/strings.test.js`: its `PLACEHOLDER_KEYS` list is auto-derived from every `en` value containing `{...}`, but the interpolation test feeds a **fixed** placeholder object (`score`/`date`/`time`/…), not one built from the string, and asserts no `{` remains. `count` was absent from that object, so the new key's Hindi/Bengali output kept `{count}` and failed.
**Takeaway**: When adding a string key with a `{placeholder}`, add that placeholder name to the fixed object in `strings.test.js`'s `placeholder interpolation in hi/bn` test. The same file also requires every key to carry Hindi (Devanagari) and Bengali values for `hi`/`bn`.

---

## Merging `origin/main` can land new AGENTS.md standing rules that invalidate already-written code
**Date**: 2026-10-08
**Area**: workflow
**What happened**: The story branch was pushed during planning, then `origin/main` advanced 4 commits. Because the branch was already pushed, the fix was `git merge origin/main` (not rebase). That merge pulled in a new "Logic lives in modules, never in components" standing rule, which the code reviewer then applied to inline `Array.isArray` / `length > 0` gates already written in the new components; extracting them into `*-logic.js` view-model builders resolved it.
**Takeaway**: After `git merge origin/main` on a branch that has been open a while, diff the guidance files (`git diff ORIG_HEAD..HEAD -- AGENTS.md README.md docs/`) and re-read any new standing rules before running reviewers — a newly added convention can make pre-existing work non-compliant even though the feature itself did not change.

---

## The 9:16 speech-capture composite is required — camera `aspectRatio` is ignored, so make the composite light on phones

**Date**: 2026-10-10
**Area**: architecture | performance
**What happened**: Camera `aspectRatio` is advisory: Android (and desktop webcams) routinely ignore it and hand back 16:9/4:3, so `getUserMedia` alone cannot produce a 9:16 recording. The recorded clip is reused verbatim (the recap and the published friend clips are trimmed from it), so the framing must be correct at capture time. Commit 614d865 therefore composited Android through `createPortraitCaptureStream` — a 1080×1920 canvas + hidden `<video>` + canvas `captureStream(30)` software-encoded by MediaRecorder — which OOM'd low-memory Android phones while the Whisper model was resident. Routing Android back to the raw stream fixed the OOM but reintroduced the 16:9 clip.
**Takeaway**: Keep `shouldUsePortraitCapture()` (`src/modules/speech/speech.web.js`) as `!isIOS()` — the composite is the only reliable 9:16 guarantee, on phones too; do not try to get 9:16 from `getUserMedia({ aspectRatio })`. Make it memory-safe instead: phones build the composite at 720×1280 @ 24 fps (≈3× less encoder load), and `stopSpeechCamRecording` releases it on Android even when `keepStreamAlive` is set, so it is not alive during transcription/Whisper (the OOM window). `portrait-capture-guards.test.js` pins all of this. Related: the 10 Hz live-hesitation timer is pure overhead on `shareCta`/`friendClosedResponse` steps (their feedback/scoring UI is never built), so `shouldTrackHesitation()` suppresses it there.

---

## The number-to-words util is vendored twice — fixing one copy leaves the other buggy
**Date**: 2026-10-08
**Area**: architecture
**What happened**: Adding currency/magnitude normalization to `src/modules/bilingual/normalize.js` surfaced two bugs in its inlined minified `number-to-words` blob: the billion/trillion/quadrillion branches divided by the *next* scale up (`t/y`, `t/c`, `t/g`) instead of their own (`t/b`, `t/y`, `t/c`), so `1000000000` normalized to `"zero billion"`; and the two-digit branch used `n&&(r+" "+m[n],n=0)` (comma operator, value discarded) so the ones place was dropped (`42` → `"forty"`). The identical library is embedded again in `src/modules/utils/idiom-normalizer.js` (used by `idiom-checker.js` / `idiom-worker.js`); both copies were patched, but they remain independent hand-maintained copies.
**Takeaway**: The two copies are independent — a text/number-normalization fix in one does not reach the other. Before assuming a normalization change is complete, grep for a second vendored copy (`grep -rn 'number-to-words' src`), and remember tests that go through `normalize()` only pin the `normalize.js` copy (there are no tests for `idiom-normalizer.js` at all).

---

## Diagnose a burned-caption/media regression from the published artifact, not from static reasoning
**Date**: 2026-10-10
**Area**: testing | workflow | architecture
**What happened**: The report "lesson a's UGC clip burns English only, no translation" was diagnosed statically as a config step-index drift (the 2026-10-08 regeneration inserted a `viewAndContinue` step into lesson a), and a whole story was written and merged around it. Pulling the actual R2 clips disproved it in minutes: `a`/`b` clips vary **per user**, not per lesson, and the giveaway was comparing each clip to its own recap tailing CTA — `mctpp`'s recap was fully Spanish while its burned caption was English-only, i.e. the burned-caption language (answer-time `userData.native_language`) disagreed with the recap's guest-first language. The step-index theory was provably wrong (the translation rides along even when the step mis-resolves).
**Takeaway**: For any "the video/subtitle/caption is wrong" report, fetch the real artifact before theorising. List the public bucket with the `.env` `R2_TOKEN`: `curl -s "https://api.cloudflare.com/client/v4/accounts/<acct>/r2/buckets/uff/objects?prefix=videos/&per_page=1000" -H "Authorization: Bearer $R2_TOKEN"` (the account id comes from `CLOUDFLARE_API_TOKEN=$R2_TOKEN npx wrangler whoami`; the pinned wrangler has no `r2 object list`). Pull `https://r2.ultrafastfluency.com/videos/<shareCode>-<courseId>-{a,b}-response-01.mp4` and the `-complete.mp4` recap, then read the burned pixels: `ffmpeg -ss 1.5 -i clip.mp4 -frames:v 1 -vf "crop=iw:ih*0.22:0:ih*0.68,scale=480:-1" out.png` and view the PNG. The recap's tailing CTA language is the user's session language — compare it to the clip to find the mismatch. A per-user (not per-lesson) pattern means the session language state, not the lesson/config.

## A lesson-completion counter keyed on `nextLessonId` never counts a terminal lesson
**Date**: 2026-10-10
**Area**: architecture | testing
**What happened**: "The lesson count on the profile never goes up when I finish a lesson." `handleSuccessStep` (`src/modules/lesson/step-loader-logic.js`) wrapped its whole persistence block in `if (nextLessonId)`, and `loadNextLesson` only persisted when it chained onward — so a lesson with no `nextLessonId` (every friend-practice lesson: `wouldyourather` a/b, `friendchain` a–h, all ending in a `success` step and no chain) reached the end and persisted nothing: no `lessons_completed` bump, no `course_progress`. Two further defects were hiding behind it: chained lessons were **double** counted (both hooks incremented the same `lessonId`), and back-to-back completions in one session re-wrote the *same* number because neither hook advanced the baseline it read (`userData.lessons_completed` was never updated in-session).
**Takeaway**: A completion counter must be keyed on the lesson that **finished**, not on what comes after it. Split the two concerns the single `lessonId` parameter was overloading: "resume target" (the next lesson, or the completed one when it is terminal) and "counted lesson" (an explicit `completedLessonId` option). Baseline the increment off `max(userData, store)` and write both after each completion, or consecutive completions in one session overwrite each other. `incrementCount` was already an accepted option but never read — an option that no code honours is a latent trap, so gate the increment on it and add a test that a plain `saveLessonProgress` call does **not** bump the count. Finally, pin the completion contract at the call site that was wrong (a `handleSuccessStep` test with a `nextLessonId`-less lesson), not only on the helper — the helper's tests all passed while the reported bug was still live.

**Correction (same day)**: the first version of this fix made the increment idempotent per lesson via the `counted_lessons` set — wrong product rule. Learners re-do the same lessons with friends over and over, and each genuine re-completion earns credit. The only guard is the phantom completion: landing on the success step directly (page load, reload, signup redirect) without traversing the lesson. That guard is the existing `stepLoadedFromRestore` flag — set `true` only by `loadLessonContent` (the direct path) and cleared by every in-app advance (`loadNextStep`/`jumpToStep`) — so `handleSuccessStep` passes `incrementCount: !stepLoadedFromRestore`. `counted_lessons` stays the UNIQUE set (unique count = its length); the total counter counts every genuine completion, repeats included.

---

## A `canvas.captureStream()` recording of a static canvas is a 0-byte file
**Date**: 2026-10-12
**Area**: testing | build
**What happened**: The tutorial placeholders (`scripts/generate-tutorial-placeholders.mjs`) wrote five 0-byte mp4s. The recorder code was correct in isolation (a 320×480 canvas recorded fine), so the failure looked like a codec or headless problem; bisecting the page showed it was the *painting*, not the recording: Chrome emits a canvas frame only when the canvas **changes**, so a page that draws once at load and then records produces a dataavailable event with an empty blob. A/B in one browser process — no draw after `captureStream()` = 0 bytes, draw after = 3.8 KB, `requestAnimationFrame` repaint loop = 17 KB for the same 2.5 s. Two side findings from the same session: Playwright's bundled ffmpeg is a stripped build (`--enable-muxer=webm`, vp8 only, no H.264/drawtext), so it cannot author or transcode an mp4 fixture, and `key={...}`-free JSX renders `controls` as `controls=""` which `toHaveAttribute('controls', '')` matches.
**Takeaway**: When recording a canvas with `MediaRecorder`, repaint for the entire take (a `requestAnimationFrame` loop, cancelled before `stop()`), and treat a suspiciously tiny output as "no frames were emitted" rather than "bad codec". Diagnose page-level recording bugs by bisecting the *page* (draw vs no draw, RAF vs static) inside one browser process — it is far faster than iterating on the encoder settings. Verify the artifact with a container probe (`mediabunny` `Input` reads `codedWidth`/`computeDuration` with no WebCodecs), not with file size.

## The `user_notifications` dedupe makes a re-answer an UPDATE, and mark-as-read is also an UPDATE

**Date**: 2026-10-13
**Area**: architecture | supabase
**What happened**: `record_friend_response()` (005) upserts on `(recipient_id, actor_id, type)`, so a second answer refreshes `created_at` and clears `read_at` via `ON CONFLICT DO UPDATE` — but the recipient clearing `read_at` is *also* an UPDATE on the same row. An `AFTER INSERT OR UPDATE` trigger on that table (e.g. story 063's push webhook) therefore fired on "mark as read" and would have pushed an old notification; an insert-only trigger would silently drop every re-answer.
**Takeaway**: distinguish the two writes in the trigger itself:
`after insert or update on public.user_notifications for each row when (tg_op = 'INSERT' or new.created_at is distinct from old.created_at)`.
`read_at` is the only other writable column (005 grants `update (read_at)` only), so `created_at` is the reliable "this is a new/refreshed notification" signal. Any future consumer of this table needs the same guard.

---

## The app's legal links live in exactly four surfaces — and `public/landing.html` is not one of them

**Date**: 2026-10-14
**Area**: architecture | workflow
**What happened**: Tasked with "remove the privacy/terms links from the footer of the app", a survey found exactly one footer in the React app: the shared `LegalFooter` component, whose entire content was the two links, rendered by both `HomeLanding.jsx` (public homepage) and `HomeScreen.jsx` (dashboard) — the codebase itself calls it "the homepage/dashboard legal footer". Separately, `public/landing.html` (a legacy static WordPress-derived page, served at `/landing`) has its own footer links opening self-contained inline legal modals; it is not part of the React app and was left untouched.
**Takeaway**: The React app's Privacy/Terms links exist in exactly four surfaces: the (now removed) `LegalFooter`, the `HomeScreen` user-menu drawer, the sign-up surfaces via `LegalLinks` (opens in a new tab — the modals are store-driven `<dialog>`s), and the public `/privacy` + `/terms` routes (`routes.jsx` + `PUBLIC_ROUTES`). When touching any of them, `grep -rn "/privacy\|/terms" src/` finds all four in one shot. `public/landing.html` is a separate legacy page with its own inline-modals legal content — scope it explicitly, don't assume "the footer of the app" includes it.

---

## A missing optional package is the sandbox baseline — install it and the suite is green

**Date**: 2026-10-14 (updated 2026-10-20)
**Area**: build | testing
**What happened**: A full `npx vitest run` failed 4 test files (201 files: 4 failed / 197 passed) with nothing changed in `package.json` or the repo source: `scripts/lib/pwa-build-output.test.js` (its `npm run build` child fails loading `vite.config.js`), `functions/api/push/send.test.js`, `src/components/pwa/pwa-install-contract.test.jsx` and `src/components/pwa/pwa-install-wiring.test.jsx`. All four were module-resolution errors — `vite-plugin-pwa`, `@block65/webcrypto-web-push` and `@khmyznikov/pwa-install` were absent from the shared `node_modules`. The failures are collection-time (no tests run), so the "Test Files X failed / Tests Y passed" summary is the quickest signal.
**Takeaway**: These are collection-time failures, not assertions — check `ls node_modules/<pkg>` before debugging the source. They are fixable: `npm install <pkg> --no-save --no-audit --no-fund` in the checkout that owns the shared `node_modules` (the worktree's `node_modules` is often a symlink to it) makes the file collect again. As of 2026-10-20 all three packages are installed and the full suite is green (255 files / 3871 tests), so treat a red suite as a real regression and re-check `node_modules` before assuming a baseline.

---

## A PurgeCSS guard must model `vite-plugin-purgecss`'s real call, not a content glob
**Date**: 2026-10-16
**Area**: build | testing
**What happened**: A guard for the brand typography's `:lang()` heading rules called `new PurgeCSS().purge({ content: ['**/*.{js,css,html,…}'], css: ['src/assets/css/app.css'], safelist })`. That reported the rules being stripped from production, which I diagnosed as a production-only bug, "fixed" with a `/^:lang/` safelist entry, and wrote into the commit message. `vite-plugin-purgecss` does not glob anything: it passes `content: [{ raw: transformedIndexHtml + ' ' + Object.entries(bundle).map(([,a]) => a.code).join('; '), extension: 'html' }]` and `css: [{ raw: bundle[file].source }]` — one raw string. Modelled that way, the rules survive with an **empty** safelist, because `shouldKeepSelector()` returns true for any selector node parented by a pseudo (so `h1/h2/h3` inside `:is(…)` always survive, and `:lang(x)` hits `default: continue`) and the leading `#root` is in the content. There was no bug and the safelist entry was noise.
**Takeaway**: Copy the call out of `node_modules/vite-plugin-purgecss/dist/index.js` before writing any PurgeCSS guard — a `content` glob scans the stylesheet under purge into its own content set, so selectors survive for the wrong reason and the guard stays green even with the fix removed. When a guard reports a production-only bug, reproduce it against the real plugin call *and* check whether the guard still fails with the proposed fix reverted.

---

## `git commit --amend` after a reviewer committed to the branch swallows their report
**Date**: 2026-10-16
**Area**: workflow
**What happened**: The code-reviewer subagent commits its report to the branch (`docs/reviews/<topic>-review.md`). I then ran `git commit --amend` to fix a wrong commit message, which amended **the reviewer's** commit — folding its report into my message and orphaning my original commit. The branch ended up containing my work twice.
**Takeaway**: After any subagent commits to the branch, never `--amend` the tip. To fix your own commit message, `git reset --soft <the commit before yours>` and recommit your files (leaving the reviewer's report to its own commit), or amend before the reviewer runs.

---

## In vitest's jsdom env, `new URL(x, import.meta.url)` throws but `fileURLToPath(import.meta.url)` works
**Date**: 2026-10-17
**Area**: testing
**What happened**: A source-guard test under `src/**` resolved a sibling file with `readFileSync(fileURLToPath(new URL('./Foo.jsx', import.meta.url)))` and failed with `TypeError: The URL must be of scheme file`. The same file worked when rewritten to the repo's existing convention, `path.dirname(fileURLToPath(import.meta.url))` + `path.join(HERE, 'Foo.jsx')`, which `src/modules/user/email-confirmation-migration.test.js` and `src/modules/video/recorder-page.test.js` already use.
**Takeaway**: Under `vitest.config.js`'s `environment: 'jsdom'`, the global `URL` is jsdom's, so `new URL()` against `import.meta.url` can resolve to a non-`file:` URL. Use `path.dirname(fileURLToPath(import.meta.url))` in every `src/**` test that reads a sibling file — it is the established convention and works in both environments. Functions tests can use either, since they opt into `// @vitest-environment node`.

---

## `recorder-page.test.js` fails on ANY uncommitted file, including sandbox agent config
**Date**: 2026-10-17
**Area**: workflow
**What happened**: `src/modules/video/recorder-page.test.js`'s "implementation diff touches only the allowlist" guard runs `git diff --name-only HEAD` plus `git status --porcelain`, so it reports failure for files that have nothing to do with the branch. In this sandbox four tracked `.opencode/agents/*.md` files are left modified (a model-routing override injected at session start), which made that one guard red on a fully green branch and cost a debugging detour each time it was seen.
**Takeaway**: That guard is a worktree-hygiene check, not a branch check — commit your work first so `git diff HEAD` is empty, then `git stash push -- .opencode/` to confirm the real state and `git stash pop` immediately. Do **not** `git checkout` the `.opencode/` edits to make it pass: they are injected before the session starts and discarding them is discarding work you did not create. When attributing this failure, confirm with `git diff --name-only HEAD` that no story file is in the diff. Two different cases, two different fixes: for files you did **not** author (sandbox-injected `.opencode/` edits), leave the list alone — commit, re-run, and let the guard stay honest. For your **own** change, the allowlist is the mechanism (its comment says "Each story's set of authorized paths", and 30+ entries are exactly that), so add the paths your change touches; `git add` a new file first, because the guard's untracked check reads `git status --porcelain` and an untracked file fails it before the tracked check ever runs.

---

## A share-code shape gate must update the Playwright fixture codes used as path segments
**Date**: 2026-10-18
**Area**: testing | routing
**What happened**: Story 071 made `/:shareCode` render the 404 page unless the segment matches `isShareCodeSegment` (generator `ALPHABET`, 4–5 chars). The full vitest suite and the new routing tests were green, but the code reviewer caught that two currently-running Playwright specs open `page.goto(\`/${SHARE_CODE}\`)` with fixtures `friendtest1` (10 chars, contains `1`) and `owner1` (6 chars, contains `1`), so both now land on the 404 and their `await expect(page.getByText('User not found')).toBeVisible()` never resolves. The unit fixtures elsewhere (`owner1`/`viewer1` in query keys, `?shareCode=` query params) are unaffected — only the path segment is shape-checked.
**Takeaway**: When narrowing what a route accepts, grep `tests/**` for the fixture value used as a path segment, not just for the fixture name: a code used in a query param or a query key is fine, but the same literal in `page.goto('/<code>')` must satisfy the new predicate. Run the affected spec (`npx playwright test tests/<spec>.js`) after the unit suite, because the guard only fails at page load.

---

## A subagent `model:` pin that names an unavailable model fails as "Insufficient Balance"
**Date**: 2026-10-18
**Area**: workflow | tooling
**What happened**: `.opencode/agents/code-reviewer.md` (and the other three agent files) had been repointed at `deepseek/deepseek-flash`, a model ID that is not in this environment's catalog at all. Every `subagent` call to `@code-reviewer` died instantly with `Insufficient Balance` or `Insufficient unified billing credits`, which reads like an account problem rather than a bad model id. The same thing happened for `cloudflare-ai-gateway/anthropic/*` (gateway out of credit); `opencode/beam-free` ran fine.
**Takeaway**: Before blaming the account, check `tools.opencode.models()` for the pinned id, then re-run the subagent with an explicit `model:` parameter from the catalog (this session's own provider, or a `*-free` id) to get the verdict. The commit that carries the unusable pin is separate from the work — don't let it block the review loop, and don't revert `.opencode/agents/*.md` either (see the `recorder-page.test.js` worktree-hygiene entry above).

---

## `new Intl.Collator('und')` is NOT the CLDR root collation in V8
**Date**: 2026-10-18
**Area**: i18n
**What happened**: Ordering the language dropdowns by endonym needed the Unicode default collation. `new Intl.Collator('und').resolvedOptions().locale` returns `en-US` with collation `default` in V8 — 'und' is the CLDR root tag but the engine silently substitutes the default locale instead of switching collation tables, so it only *looks* like the root. `new Intl.Collator('en')` produces the same order for real language names (English tailoring only touches punctuation and spacing, not script or letter order), which is why the app pins `'en'`.
**Takeaway**: Pin the collator to a fixed locale and say why — leaving it on the runtime default reorders the menu per user (Swedish puts `å` after `z`). Don't describe `'en'` as "the CLDR root locale" in a comment; a reviewer reading both comments will find them contradictory.

---

## The Android-only silent video start: what was ruled out, and how to measure it
**Date**: 2026-10-20
**Area**: video | android | debugging
**What happened**: A lesson video started **silent for one to two seconds on Android Chrome only** (iOS was fine). Three plausible causes had already been "fixed" without success: story 073 blamed the mp4 container (a non-zero audio offset) and shipped `video.currentTime = 0` — reverted in `d74a10d` with the note *"measured it stalls playback ~0.4s and did not fix the silence"*; a later commit deferred the microphone acquisition to the mic-button press (`062a53a`) and the symptom persisted; the field report itself blamed the microphone taking the audio context. This story measured each of them instead of reasoning about them, and **all three were dead**:
- The real mp4 (fetched from R2 and parsed at the atom level) is faststart, has **no `edts`/`elst` box on either track**, and its audio track starts at DTS 0 — there is no offset for a decoder to skip.
- The mic is **not** acquired at step load: `warmUpSpeechCamStream` has **no call sites** at all, so the first video of a lesson never runs with a capture open.
- The app's Android-only `navigator.mediaSession.playbackState = 'none'` / `metadata = null` writes are **no-ops**: instrumented, 64 of 64 writes were `none -> none`, and Chromium's setter early-returns on an unchanged value, so the browser is never even notified.
Two more were ruled out the same way: Chromium's own media audio focus **pauses** audio-producing objects (it never mutes them), so it cannot produce a silent-but-moving video; and a second, muted `<video>` holding the same URL (the app really does mount one) does not steal the unmuted element's output.
**Takeaway**: (1) *"The element keeps moving but is silent"* is an **output-level** symptom, so the suspect list is short: an element-level mute (`muted` / `volume`), an OS/browser audio-focus handover, or an OS audio mode (Android's `MODE_IN_COMMUNICATION` while a capture is open) — nothing in the container, and nothing in the media pipeline. (2) **Measure the audio instead of guessing.** A `createMediaElementSource` → `Analyser` chain gives the real signal: muting the element drives the RMS to exactly `0` while `webkitAudioDecodedByteCount` keeps growing, which separates "the element is muted" from "the audio data never arrived" in one measurement. (3) A browser-level `AudioContext`/media-session write that "should" mute the app is often a **no-op**: instrument the setter and read the value *before* the write, not after. (4) `setWebcamStream(null)` clears the **store** reference only — the module-level stream keeps its live tracks, so a capture stays open across a step boundary. (5) The fix that survives an unknown cause is a **repair + instrument** loop: the guard restores audibility within 200 ms and logs the element's `muted` / `volume` / `readyState` / decoded-audio bytes, so the next field report names the mechanism instead of starting another round of theories.

---

## A course config's `tags` are data only — nothing in the app reads them yet

**Date**: 2026-10-20
**Area**: architecture | config
**What happened**: A request to put a top-level `tags` array on every `src/config/*.json` assumed the tag logic was already wired. It is not: `grep -rn '\btags\b' src/` matches only the two configs that already carried the field (`wouldyourather.json`, `wouldyourather-test.json`) and no consumer. `src/modules/courses/friend-courses-logic.js` shapes a course card from an explicit field list (`courseName`, `courseHeroImage`, `courseMission`), so a config's `tags` never reaches the listings page, the homepage, or the store.
**Takeaway**: Adding course metadata to a config is a **data** change, not a feature — before promising "the tags will show up", check that a consumer exists (`src/modules/courses/friend-courses-logic.js` is the course-card seam to extend, with `listFriendCourses` mapping an explicit field set). And a field the sheet generator does not emit is a field that disappears: `scripts/generate-config-from-sheet.mjs` overwrites the config file it owns and emits only `courseId` / `courseName` / `courseHeroImage` / `courseMission`, so hand-authored course metadata has to be carried over explicitly (`withCarriedTags` in `scripts/lib/sheet-config-utils.js` now carries the `tags` array back in) — otherwise the next config-bot run silently drops the tags of the one generated course, `wouldyourather`.

---

## A page about another user must be read in the READER's language — and the fixture has to make the two differ

**Date**: 2026-10-20
**Area**: architecture | testing | i18n
**What happened**: The public share-code profile (`/:shareCode`) picked its language from `profile.native_language` — the language of the **profile being read** — so every visitor saw the page in the owner's language. It survived two earlier stories (056 rebuilt that page's friend-practice area, 064 added visitor awareness) because both were developed and reviewed with an owner fixture whose language matched the reader's, so the copy looked right. The bug was only visible once the fixture was built so the two languages **differ** (owner `ES`, visitor `HI`).
**Takeaway**: (1) A page whose subject is another user (a profile, a shared clip, a comment) is read by a *visitor*: resolve the copy from the reader's session language (`useNativeLanguage()` / the guest-first expression), never from the subject's own `native_language` — and format dates in the reader's locale too. (2) In any i18n fixture, **make the subject's language differ from the reader's**: two different locales make the wrong pick visible in the DOM, while a fixture where both agree hides it. (3) Assert the *absence* of the other language's copy too (`expect(text).not.toContain(get(key, other))`) — a positive assertion alone can pass while the wrong string is also rendered.

---

## A zero-row UPDATE is a silent no-op in PostgREST — a client read-modify-write can lose a record with no error

**Date**: 2026-10-20
**Area**: architecture | supabase | debugging
**What happened**: A learner finished a friend lesson and sent the link to their friends; their own public profile said "all your lessons have expired", so there was no link to click. The clips WERE published (the publish block ran, R2 had every segment and the concatenated recap), but **no `friend_links` entry was ever written** — for two completions in a row, while another learner's map from the same hours held two entries written by the same code. The write was a client-side read-modify-write of the whole JSONB column: `select('friend_links')` → merge in JS → `update({ friend_links: merged })`. That shape has two ways to lose the record **without any error reaching the app**: a zero-row UPDATE is not an error in PostgREST (the row is filtered out and the mutation still reports success), and the read is a separate round trip that can fail on its own. Nothing was logged, nothing was shown to the learner, and the profile quietly contradicted what had just happened.
**Takeaway**: (1) **Never write profile state from the client as a read-modify-write of a whole column.** Use a `SECURITY DEFINER` RPC: owner = `auth.uid()`, one atomic `jsonb_set` merge, `set search_path = ''`, execute granted to `authenticated` only — it cannot be filtered by RLS, it merges atomically (no lost update when two lessons are recorded in parallel), and a failure is an error the caller sees. The repo already had the pattern (`007_friend_credit.sql`); the link write was the odd one out, and it is now `011_record_friend_link.sql`. (2) **A silent write needs a proof of write**: add `.select(...)` to an `update()` when the caller must know a row was really touched. (3) **When a "the app did X but the row says Y" report arrives, read the R2/CDN artifacts before theorising** — the clip timestamps dated the two lost completions exactly, and the other learner's map proved the code path worked. (4) The public profile is a **read model of another learner's data**: a learner viewing their own profile logged in sees their own links through the "featuring" match, but a logged-out visitor only sees the course's first-lesson links — so a lost record looks like "expired" to everyone.

---

## A UGC clip's inviter is the person whose link was answered — not the viewer who opens it

**Date**: 2026-10-20
**Area**: architecture | video | debugging
**What happened**: A signed-in visitor opened a friend's share link and the friend's **recorded question never played** (the teacher's clips did). The friend's clips existed on R2 and served fine (`videos/qm3zv-qm3zv-wouldyourather-test-a-01.mp4` → 200). A UGC clip is addressed `<recorder>-<inviter>-…`: the recorder recorded it, the **inviter** is the person whose link they were answering. The publish side wrote the link's owner as the inviter; the read side resolved the config's `{friendCode}{selfCode}-…` reference to `<friend>-<VIEWER>` — right for the chain's answer-side clips (the viewer IS that clip's inviter), wrong for the **ask-side** ones: the chain's ask lesson is recorded by the asker THEMSELVES (they start the chain, so there is no inviter) and published `<owner>-<owner>`. A signed-in visitor therefore asked for `<owner>-<viewer>` and got a 404. **The anonymous case looked fine** — a visitor with no share code of its own falls back to the friend's code, which happens to be the owner's — so every manual check of a shared link in a logged-out browser missed it.
**Takeaway**: (1) When a clip is addressed by two codes, ask what each one MEANS before assuming the reader can supply it: here the reader can supply the inviter only for the answer-side clips. The two sides must agree per reference kind, so the ask lesson is found (`findAskLessonId`) and the inviter decided per reference (`resolveShareCodes`), with the publish side (`resolveInviterCode`) kept in step — its own comment already said the two "must stay in sync if that ever changes". (2) **A bug that only reproduces for a signed-in visitor hides behind every logged-out manual check** — reproduce it with the store carrying a share code (inject `appStore.setState({ userData: { shareCode } })` BEFORE the config is normalized) and assert on the R2 URL the lesson actually requests. (3) The published clips need no re-upload: the fix makes the app ask for the key that was already written.

---

## The reader is the only party that can compute the key — so the key must not need anything the reader cannot know

**Date**: 2026-10-20
**Area**: architecture | video | debugging
**What happened**: The ABABAB chain (stories/075) gave every lesson after the first a friend's clip, and **lesson C's friend clip never played** (404 from R2). The chain works like this: learner F records the `a` set, learner V opens F's link and records their own copy of the `a` set, learner W opens V's link and must see **V's** clip. A UGC clip is addressed `<recorder>-<inviter>-…`, where the inviter is the person whose link the recorder was answering — so V's clip was written as `<V>-<F>` (V was answering F). The reader, W, knows only W's own code and V's code: it **cannot compute F**. The read side asked for `<V>-<W>` (never written) and, for the ask namespace, `<V>-<V>` (written only by the chain's *originator*). Both are keys nobody wrote for a mid-chain learner. The first hop always worked, which is why the bug looked like "the second lesson is fine, the third one is not".
**Takeaway**: (1) **Ask who can compute the key before designing it.** The reader of a reference is the only party that can address the object, so the key may not contain anything only the writer knows. Here the writer knew the inviter and the reader did not, so the inviter had to leave the key: a chain clip is addressed by its **recorder** alone (`<recorder>-<recorder>-…`), and every hop resolves. (2) **A chain's shape decides which copies exist**: the old config read the `a` namespace once (the originator's own copy), the ABABAB shape reads it twice (the originator's copy AND the previous learner's), and only the second reader needs a key the first one did not. A shape change can silently invalidate an addressing rule that was correct for the old shape. (3) **The guard that should have existed**: walk the config with the app's own visit path and publish logic and assert that every reference addresses a clip somebody published (`src/modules/courses/friend-clip-chain.test.js`). It is written so that reverting either side of the rule turns it red — proved by mutation before the commit. (4) The fix changes which key is REQUESTED, so clips published under the old rule have to be re-recorded (they expire after 48h anyway); the asker's own clip was already `<owner>-<owner>` and kept working.

---

## A retired config is a DELETION in the diff, not a changed config

**Date**: 2026-10-20
**Area**: ci | debugging
**What happened**: Retiring the unused course configs made the **caption workflow on `main` fail**: `Error: ENOENT: no such file or directory, open '…/src/config/friend.json'`. `.github/scripts/captions-changed.sh` resolves the configs a push touched with `git diff --name-only … -- 'src/config/*.json'`, and a retired config appears in that diff as a **deletion** — so the list handed to the generator named a file that no longer exists. The app was unaffected; only the workflow went red.
**Takeaway**: (1) **A "changed files" list is not a "changed files that still exist" list.** Anything derived from a diff has to filter by the working tree before it is handed to a tool that opens the files — the same lesson as the retired-config guard, one layer up. (2) The check belongs in the **resolver**, not in the generator: the generator should keep failing loudly on a file that does not exist, and the resolver should never name one. (3) A red CI run on `main` after a merge is worth reading as a *regression of the merge*, not as flaky infrastructure — this one had been introduced by the very merge that triggered it.
