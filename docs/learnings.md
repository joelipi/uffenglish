# Learnings

## iOS voice capture requires plain `video/mp4`, a gesture-resumed native-rate `AudioContext`, and playing `WebcamPreview` once visible
**Date**: 2026-10-22
**Area**: speech | ios | architecture
**What happened**: On iPadOS 27.0.1, every lesson recording take captured digital silence (`0.0000` amplitude) and hung on the `processing/transcribing` screen even though standalone `/audio-lab5` tests on the same iPad passed (`0.81+`). Four differences between the app's take and the passing lab page combined to cause it: (1) `speech.web.js` set `mp4Preferred = isWindows` and fell through to `else mimeType = 'video/webm'` on iOS (whereas every lab page and `video-processor.web.js` picked `video/mp4` first); on iPadOS 27, WebKit's `video/webm` `MediaRecorder` produces `chunks: 0`, never fires `recorder.onstop` (hanging `stopSpeechCamRecording()`), and starves the concurrent `AudioWorklet` tap; (2) `localAudioContext` was created 3 seconds after the user tap (after the 3-2-1 countdown expired user activation) at `{ sampleRate: 16000 }` with `gain = 0`; (3) `WebcamPreview.jsx` assigned `video.srcObject = stream` while `#pip-wrapper` was `display: none` (`d-none`) and never called `video.play()` when `show` became `true`; and (4) `speech-orchestrator.js` checked `if (!videoBlob)` before `if (!capture.usable)`.
**Takeaway**: On iOS, (1) always prefer plain `'video/mp4'` in `selectRecordingMimeType` (`src/modules/speech/audio-resample-logic.js`) and pass a timeslice (`recorder.start(250)`) plus a `recorder.onstop` safety timeout so `stopSpeechCamRecording` can never hang; (2) pre-create and `.resume()` `localAudioContext` inside the user tap gesture (`startSpeechCamRecording`) at the device's native sample rate with `silentGain.gain.value = 0.001`, then downsample to 16 kHz in JS via `resampleTo16k()`; (3) call `video.play()` via `syncWebcamPreviewElement` when `WebcamPreview` transitions to `show = true`; and (4) release the capture after every take on iOS (`shouldForceReleaseComposite`) so playback never mutes a still-open mic track.

---

## A rejection hook that runs after `processing/transcribing` must move the phase back itself
**Date**: 2026-10-21
**Area**: architecture | speech
**What happened**: A Bluetooth microphone delivered a live stream with no frames. The take was all zeros, `stopLocalAudioTap()` flattened it, the waveform drew flat and `transcribeAudioBuffer` waited forever (no timeout, and the worker's `onerror` never settled the pending promise). The learner pressed stop and never got out: `onRecordingStop` transitions to `processing/transcribing`, whose mapping sets `bottomState: 'hidden'` — and `onStopEarly` only showed the "TRY AGAIN" message. `triggerPreflightRejected` is not consumed anywhere in `src/`, so **no** rejection hook (`onStopEarly`, `onPreflightRejected`, `onGibberishDetected`) returns to a phase that mounts the mic. The message was actionable in text and not in UI.
**Takeaway**: Every UI hook whose job is "this take failed, try again" must end with a phase transition (today `recording/answering`, guarded so an already-correct phase does not log "Unexpected transition"). Check it with a store-level test of the recovery helper, not only a source guard — a `text` assertion cannot see a missing control. `onNoAudioCaptured` and `onStopEarly` were fixed from a pure `src/modules/lesson/no-audio-recovery-logic.js`; `onPreflightRejected` and `onGibberishDetected` still have the dead end. Separately: a capture that carries no signal (`analyzeCapturedAudio` in `src/modules/speech/speech.core.js`) must be reported before Whisper, because a silent buffer can never produce a transcript and an unanswered worker promise is unbounded — `transcribeAudioBuffer` now settles on a 45 s timeout, worker error, failed `postMessage` and `terminate`.

---

## Making a lesson terminal leaves one copy surface behind: the answer notification
**Date**: 2026-10-21
**Area**: product | notifications
**What happened**: The chain's CLOSING lesson (the last `shareCta` lesson of a friend chain) records a sign-off and deliberately records **no friend link** (nothing could answer it), so three copy surfaces were made terminal-aware: the burnt share-card line, the success-screen CTA and the share text. A fourth surface was missed: `resolveFriendResponseNotification` still fires for that lesson — its only gate is `hasEarlierShareCtaLesson`, which the closing lesson passes — and `NotificationList.web.jsx` rendered `notifications_respond_deadline` ("You only have 48 hours to respond") on **every** `friend_response`. The person whose questions were answered by the chain's end was therefore told to respond to a lesson that does not exist. The line was **deleted** (not reworded): a copy line that promises an action the flow can no longer deliver is worse than no line, and the "48 hours" it was counting down to was the thing that had stopped being true.
**Takeaway**: (1) When a lesson becomes terminal, enumerate the *events it emits*, not only the screens it renders — the notification a finished lesson sends to the other learner is copy too. (2) Before making such a line terminal-aware, ask whether it should exist at all: a per-case fix is not a string swap (the row carries only `course_id`/`lesson_id`, and the bell has no course config, so the terminal flag would have to travel from the responder through `record_friend_response` — a migration plus live-DB verification), and a neutral reword ("the video is available for 48 hours") keeps a line whose only job was urgency — and the urgency was exactly what was false. (3) A copy line that is *rendered unconditionally* (`notification.type === 'friend_response'`) is a promise about every notification of that kind, not about one lesson; that is the shape to check when a flow gains a last case.

---

## A query the shell mounts once must ask to be re-read — the app's query defaults never re-read anything
**Date**: 2026-10-20
**Area**: architecture | testing | notifications
**What happened**: A friend answered while the asker had the app open, and the asker only saw the notification after a **full page reload**. The bell is mounted ONCE by the app shell, so the inbox query (`useNotifications`) lived for the whole session — and the app's global `QueryClient` defaults are `staleTime: Infinity` and `refetchOnWindowFocus: false`, with the inbox overriding only the first (`staleTime: 30 * 1000`). The result: the inbox was read once, at mount, and never again. The same trap hides in every query the app reads "for the last time it is needed" — the shell's header, the profile, the config: a value written **elsewhere** (a friend answering, another device marking a row read) can only reach them if the query explicitly asks for it.
**Takeaway**: (1) A query that must reflect something that happens **outside** the tab has to opt out of the app's write-once defaults: `staleTime: 0` + `refetchOnMount: 'always'` + `refetchOnWindowFocus: 'always'`, and `refetchInterval` for the "it happens while I am looking at it" case. (2) `refetchInterval` re-reads **regardless of `staleTime`** (the staleTime gate only covers mount/focus/reconnect), and `refetchIntervalInBackground: false` — the default — pauses the poll while `document.visibilityState === 'hidden'`, which is what keeps a backgrounded phone from polling; the focus refetch catches up on return. (3) A five-second poll of a small RLS-scoped list is free and needs no new dependency, no third-party service and no database change — cheaper than a websocket, and it is the same mechanism on every browser the app supports. (4) **In vitest with fake timers, a TanStack query result is never delivered**: the notification is scheduled through `notifyManager` (a `setTimeout(0)`) and the fake clock never reaches it, so the component keeps rendering the old data even though the query state is already correct. Replace the scheduler (`notifyManager.setScheduler((cb) => cb())`, restore `defaultScheduler` afterwards) or the test asserts a stale DOM and looks like a broken implementation. (5) A browser spec that injects fixtures into the query cache while the server stub holds **different** rows is racing the app's own re-read — stub the server to the same state the test means, or the spec passes by luck and fails later.

---

## A config step's subtitle tracks are per-locale AND per-phrase — trimming either breaks playback
**Date**: 2026-10-20
**Area**: architecture | testing
**What happened**: Converting lesson B of `wouldyourather-test.json` from the longer combined videos (`wouldyourather-a-02` / `-03`, which speak all four question variants in one take) to single-take per-variant videos (`-02-01` / `-03-01`) was done by trimming the step's `cue` to one variant and keeping only the `en` subtitle track. A Spanish user then read **English** on the friend response step, because `getLocalizedTranslation(step.subtitles, lang)` (src/modules/utils/utils.js) falls back to `.en` whenever the requested locale is missing — a missing locale is invisible, it just silently degrades. The retained `en` track also still held the combined video's **4 cues** on a video that speaks **1 phrase**, so the subtitle cues ran past the end of the recording. The correct data already existed: the step in lesson A that owns the same video slug carries the matching 6-locale single-phrase track.
**Takeaway**: When a config step changes which video it plays, its `subtitles` must be copied from the step that owns that **video slug** — not trimmed in place, and not carried over from the old video. Keep **every** locale (`en, es, pt, bn, fr, hi`): the app picks the user's own language and falls back to English only when no locale matches, so a step that ships one locale reads as English to every non-English user. Keep the cue count equal to the phrases the new video actually speaks. Guard it with a test that asserts the locale set, the cue count per locale, and equality with the same slug's track in the sibling lesson — and prove the guard fails by re-injecting the bug (see `src/config/wouldyourather-test.test.js`).

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

## Adding a `{token}` UI string also needs the fixed placeholder dictionary in `strings.test.js`
**Date**: 2026-10-08
**Area**: testing
**What happened**: Story 056 added `friend_courses_lesson_count` ("{count} lessons"). The full suite then failed in the pre-existing `src/data/strings.test.js`: its `PLACEHOLDER_KEYS` list is auto-derived from every `en` value containing `{...}`, but the interpolation test feeds a **fixed** placeholder object (`score`/`date`/`time`/…), not one built from the string, and asserts no `{` remains. `count` was absent from that object, so the new key's Hindi/Bengali output kept `{count}` and failed.
**Takeaway**: When adding a string key with a `{placeholder}`, add that placeholder name to the fixed object in `strings.test.js`'s `placeholder interpolation in hi/bn` test. The same file also requires every key to carry Hindi (Devanagari) and Bengali values for `hi`/`bn`.

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

---## A retired config is a DELETION in the diff, not a changed config

**Date**: 2026-10-20
**Area**: ci | debugging
**What happened**: Retiring the unused course configs made the **caption workflow on `main` fail**: `Error: ENOENT: no such file or directory, open '…/src/config/friend.json'`. `.github/scripts/captions-changed.sh` resolves the configs a push touched with `git diff --name-only … -- 'src/config/*.json'`, and a retired config appears in that diff as a **deletion** — so the list handed to the generator named a file that no longer exists. The app was unaffected; only the workflow went red.
**Takeaway**: (1) **A "changed files" list is not a "changed files that still exist" list.** Anything derived from a diff has to filter by the working tree before it is handed to a tool that opens the files — the same lesson as the retired-config guard, one layer up. (2) The check belongs in the **resolver**, not in the generator: the generator should keep failing loudly on a file that does not exist, and the resolver should never name one. (3) A red CI run on `main` after a merge is worth reading as a *regression of the merge*, not as flaky infrastructure — this one had been introduced by the very merge that triggered it.

---

## Three Playwright specs assert UI that a later commit removed — they fail on `main`, not on your change

**Date**: 2026-10-21
**Area**: testing | workflow
**What happened**: Commit `090591b1` ("Remove upper bar back buttons; update headings and colors") changed the public profile's friend-links heading from the localized `profile_friend_practice_heading` string to a hardcoded English sentence that interpolates the profile owner's name, and removed the courses page's back button. Three Playwright specs still assert the old UI, so they fail on `main` before any change of yours: `tests/friend-courses.spec.js` ("the course list scrolls and the back button stays reachable" — the `friend-courses-back` testid is gone), `tests/friend-lesson-link.spec.js` (expects the old heading text) and `tests/profile-visitor-lessons.spec.js` (expects the Hindi heading, which the hardcoded English copy can never produce).
**Takeaway**: (1) A UI-copy change and the specs that pin that copy belong in the same commit — a spec that asserts a string the component no longer renders is a red suite for everyone who runs it next, and it looks like a regression of whatever you just did. (2) When a heading must name the profile owner, keep it in the strings table with a `{name}` placeholder (and add the placeholder to the fixed dictionary in `src/data/strings.test.js`) — a hardcoded English template in the component silently un-localizes the page, which the profile's own "reads in the visitor's language" rule forbids. (3) Establish the baseline before chasing a red spec: `git checkout origin/main -- <paths>`, run, `git checkout HEAD -- <paths>` — the same three specs fail identically on the pre-change code. **Update 2026-10-21**: all four are green again. `friend-lesson-link` and `profile-visitor-lessons` were fixed by the heading's `{name}` placeholder and the badge data model; `friend-courses` (the page's back button was removed with the upper-bar buttons) and `friend-first-question-overlay` (the '?shareCode= on b' case) were fixed on 2026-10-21 — the page's way out is the app shell's header, and the generated course's first response step resolves to the SIMPLE video phase.

---

## "This site can't be reached / ERR_FAILED" is a NAVIGATION failure, and the app's own link caused it

**Date**: 2026-10-21
**Area**: routing | debugging
**What happened**: A visitor on an iPad clicked a course/lesson link on a public profile and got a browser error page ("This site can't be reached … ERR_FAILED") with the address bar on `https://ultrafastfluency.com/` — the site's ROOT. The report was intermittent and only seen on that device. Three wrong explanations came first (a retired course config, a dead `shareCode`, a webview wrapper): all three were ruled out by reading the code — the profile's lesson link is built from live `friend_links` data, every current entry points at a lesson that exists in the shipped config, and the app is served from the apex. What the code actually showed: the profile's lesson link was a plain `<a href>` with an ABSOLUTE url, so the click was a **document load** — and a document load is the only thing in the app that can end in a browser-level error page at all (the browser failing a navigation, e.g. one that supersedes an in-flight load). The app also had two more paths to the same root URL: the catch-all `{ path: '*', element: <Navigate to="/" replace /> }` (any unmatched path silently became the root until story 071, 2026-10-18) and the `LessonError` "Go Home" button, which was an `<a href="/">` full page load to the root until 2026-05-30 and pointed at `/` until 2026-10-05. Every one of those is now either client-side or gone.
**Takeaway**: (1) **A browser error page is never the app's fault in the rendering sense** — "the site can't be reached" means the browser failed a NAVIGATION. When the symptom is a browser error page, look for a document load in the app (a plain `<a href>`), not for a rendering bug. (2) An in-app link must be a react-router `<Link>` to a PATH: a relative path cannot leave the router, and it keeps the in-memory guest language (a full load resets it and re-opens the language modal). Keep the absolute form for the link a learner SENDS (`buildShareUrl`), which legitimately leaves the app. (3) **Making a link client-side moves the cost to the URL-derived state**: `?shareCode=` was captured once at start-up in `App.jsx` (outside the router, where `useLocation` is unavailable) and would now be missed, because the app is already mounted when the visitor clicks. It is captured by `useShareCodeFromLocation` (inside the router, called from `RootLayout`) on every location change — and never cleared, because the lesson advances with a navigation that carries no query string. (4) Prove the new guard can fail: a marker set on `window` survives a client-side navigation and is wiped by a document load, so a Playwright spec that asserts the marker is still there fails exactly when the link is turned back into an `<a href>` (verified by mutation).

---

## A red Playwright spec on `main` is a baseline fact, not a regression of your change

**Date**: 2026-10-21
**Area**: testing | workflow
**What happened**: While fixing the profile's friend-practice link, `tests/friend-first-question-overlay.spec.js` ("friend lesson via ?shareCode= on b: first response step goes interactive") failed with `Expected: "interactiveVideo+friendClosedResponse"` / `Received: "simpleVideo"` — the lesson never left the intro video on lesson `b` of the `wouldyourather-test` fixture. The same spec fails identically on `origin/main` and on the commit before the change, so it is a pre-existing red spec, not a regression. The same run also caught a REAL regression of an earlier commit on this branch: `tests/notifications.spec.js` asserted the notification link was the hard-coded apex `https://ultrafastfluency.com/sam123`, but commit `a3476a3b` had made that in-app link origin-aware (it now resolves to the host under test) — the spec had to be updated, not the code.
**Takeaway**: (1) Establish the baseline **before** you touch a spec: `git worktree add /home/user/<dir> <ref>` + a symlinked `node_modules` gives you the old code without disturbing your branch, and it is the only way to tell "this was already red" from "I broke it". (2) A spec that pins a hard-coded host is pinning the OLD behaviour — when an in-app link becomes origin-aware, the spec has to compare against the page's own origin (`new URL(page.url()).origin`), or it will keep demanding the apex. (3) The `wouldyourather-test` fixture's config carries `courseId: "wouldyourather"` (not the file's basename), so a route that fetches `/src/config/<courseId>.json` and compares it with the config's own `courseId` sees a mismatch — worth knowing before chasing the red lesson spec. (4) **Never hard-code a value the CONFIG owns.** The profile's label is "Lesson 3 of 7" — the total is the course's lesson count. A spec that wrote "Lesson 1 of 6" broke the moment the chain grew a closing lesson, exactly like the label it was checking. Read the count from the config file in the spec (`JSON.parse(readFileSync(...)).lessons.length`) and assert the exact string: the spec then fails only when the app renders the wrong total. (5) **A red COUNT is not a signal — compare the failure SETS, across runs AND across commits.** Two runs of the SAME commit on this machine produced 34 and 31 failures, and the sets differed in BOTH directions: a spec that failed in one run passed in the other. The same 12 lesson-player files (`tutorial-modal`, `whisper-engine-fallback`, `simple-response-overlay`, `success-concat-button`, `composite-freeze-guard`, `lesson-g-video`, `lesson-topbar-bell`, `playback-video`, `poster-check`, `preloader-reveal`, `regression-guard`, `water-shimmer-scope`) fail on the pre-change code too — they need real media, a camera and a mic, which this sandbox does not have. So the only question that matters is "does THIS exact failure reproduce on the pre-change code"; the specs that assert on the app's own copy (the profile, the courses page, the lesson links) are the ones that carry signal. (6) **A red spec can also be asserting a phase the CONFIG cannot produce**: the '?shareCode= on b' case expected `interactiveVideo+friendClosedResponse`, but `resolveStepPhase` only takes the interactive branch for a step with an `interactiveVideoUrl`, and the generated friend course carries every clip as `simpleVideoUrl` (only the hand-written `model` course has interactive steps). The spec was green once and stopped matching the config; the fix was to expect the phase the config can produce (`simpleVideo`) and to rename the case after the invariant it actually checks (the step goes straight to the video, no mode chooser).

---

## A viewer-facing badge must join on data the VISITOR holds
**Date**: 2026-10-21
**Area**: profile | friend-chain
**What happened**: `buildVisitorPracticeView` marked an entry `completedTogether` when the viewer's `counted_lessons` contained `<courseId>_<entry.recordedLessonId>` — but `recordedLessonId` is the lesson the profile OWNER recorded, so only the owner's own history ever contains that key. The badge appeared exclusively when a logged-in learner looked at their own public profile, never on a partner's. The joint exchange lives on the opposite field: the visitor records `entry.lessonId` (the follow-on lesson the link opens), so that is the key to test, while the inbox direction (the owner answered the viewer) should feature the entry but must NOT badge it — the visitor still has their turn.
**Takeaway**: A predicate computed from the viewer's session may only read data the viewer can have. Before joining on a field from the other party's row, walk the write path and ask whose `counted_lessons`/inbox actually receives that value; if only the owner can hold it, the check is a self-check. This is the badge-sized version of the rule that a chain clip's R2 key must be derivable from what the READER knows.

---

## "Done together" needs a PAIR, and the inbox is not a pair history
**Date**: 2026-10-21
**Area**: profile | friend-chain | data-model
**What happened**: Keying the completed-together badge on `entry.lessonId` (the right lesson) still read the viewer's `counted_lessons`, which is per LEARNER and per LESSON — it has no partner dimension. A learner who did lesson `b` with friend Q therefore got a "Completed it together ✅" badge on friend P's profile for the same lesson, even though they had never done it with P. Repeating a lesson with different friends is expected, so the approximation was unacceptable. The existing pair evidence could not be reused: `record_friend_completion` stores only the `friends`/`friend_owners` id arrays (no lesson), and the `friend_response` inbox row — which does name actor, recipient, course and lesson — is deduped to ONE row per `(recipient, actor, type)`, so each new answer overwrites the previous lesson. It is also readable only by the recipient, i.e. never by the visitor.
**Takeaway**: (1) **A per-learner aggregate cannot answer a per-pair question.** If a feature says "together", "with", "shared" or "each other", the record needs both identities; deriving it from one party's history is a heuristic that silently over-claims. (2) **Check the dedupe key before treating an inbox row as an event log** — a unique key without the lesson dimension turns a history into a "latest value". (3) When the only precise record would live in the OTHER party's private inbox, the read is impossible by design: add a pair-scoped ledger written by the same SECURITY DEFINER RPC that already credits the friendship, and expose it to the actor only (`auth.uid() = actor_id`). Backfill only what proves the pair (the surviving inbox rows), and say in the migration that older joint lessons were overwritten — do not guess them from link order, which cannot distinguish "done with this friend" from "done alone" or "done with someone else". (4) Scope the read in the query too (`actor_id` AND `owner_id`), so the badge stays correct even if the RLS policy is later widened.

## `peck story create` names the story directory after the repo's NEXT number, not the one you pass
**Date**: 2026-10-22
**Area**: workflow
**What happened**: `peck story create 089-health-course` created `stories/088-089-health-course/story.md` on branch `088-089-health-course` — the numeric prefix came from the next free story number in the repo, and the name I passed was appended after it. The number 088 was already taken by another branch (`088-mic-silence-warning`, no story directory), so the story and that branch disagreed about the same number, and `peck story list` showed "088 089-health-course". I had to rename the directory and the branch by hand (`mv` + `git branch -m`) to get `stories/089-health-course` on `089-health-course`.
**Takeaway**: The number you pass to `peck story create` does NOT control the story directory or the branch name — read the printed `STORY_FILE` / `GIT_BRANCH_NAME` and check them against the numbers already in use (`ls stories/`, `git branch --list`) BEFORE writing the story. If the generated prefix collides with another branch's number, rename both the directory and the branch to the number you actually want, and confirm with `peck story list`.

## A dependency bump must not run a plain `npm install` — the committed lockfile is loose

**Date**: 2026-10-24
**Area**: build | workflow
**What happened**: Bumping `canvas-confetti` 1.6.0 → 1.9.4 with `npm install canvas-confetti@1.9.4` produced a 780-line `package-lock.json` diff (744 deletions) for a leaf package with no dependencies. The lockfile at `main` is internally stale: it lists `googleapis` in its root dependency list although `package.json` has no such dependency, and it omits `purgecss` from that list although `package.json` declares it. npm therefore "reconciles" the whole tree — pruning the unused `googleapis` subtree (and its `rimraf`/`node-fetch`/`qs`/… deps), adding the missing root entries and normalising `dev` flags. Both the stale and the reconciled lockfiles pass `npm ci --dry-run`, so this is churn, not a fix.
**Takeaway**: For a version bump, edit only the affected entries by hand (the root dependency range plus that package's `node_modules/<pkg>` `version`/`resolved`/`integrity`) and verify with `npm ci --dry-run` (in a temp dir with just the two JSON files) and `npm ls <pkg> --json`. Keep `npm install` for adding a genuinely new package. Note the shared-`node_modules` side effect: the worktree's `node_modules` is a symlink to the main checkout's, so an install prunes/adds packages for every session at once (here `googleapis` disappeared from the shared tree; nothing imports it). A future story that runs a full install will still produce the reconciliation — treat cleaning the lockfile as its own story, not part of a feature.

---

## `canvas-confetti`'s ESM build exports only `default` and `create`; the shape helpers live on the default export

**Date**: 2026-10-24
**Area**: build | frontend
**What happened**: Custom path/emoji confetti needs `confetti.shapeFromPath` / `confetti.shapeFromText` (added in 1.7.0). With the module entry Vite resolves (`dist/confetti.module.mjs`) `import('canvas-confetti')` yields a namespace whose only named exports are `default` and `create` — `mod.shapeFromPath` is `undefined`, and destructuring it silently disables custom shapes. The helpers, plus `reset`, are properties of the default export function (the CJS `module.exports`), so `(mod.default || mod).shapeFromPath(...)` is the working form. Two more library facts worth knowing: `shapeFromPath` re-creates `new Path2D` on every call and, without an explicit `matrix`, derives one by sampling ~250k `isPointInPath` hits (pass a cached matrix); `shapeFromText` uses `new OffscreenCanvas` with no feature guard, so it throws on browsers without OffscreenCanvas and rasterises the device's emoji font.
**Takeaway**: When a library ships both CJS and ESM builds, check the *built* entry's export list (`grep -n "export " node_modules/<pkg>/dist/*.mjs`) before destructuring helpers — an API present in the CJS `module.exports` may not be a named ESM export. Reach shape helpers through the default export and keep a built-in-shape fallback around the call. `src/modules/lesson/confetti-api-guard.test.js` pins both the option keys the app passes and this export surface for the next upgrade.
