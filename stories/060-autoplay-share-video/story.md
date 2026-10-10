# Audible auto-playing after-video loop (aftersuccess / aftershare)

## Context

When the concatenated recap finishes rendering, `SuccessVideo` (`#resultVideo`) calls `video.play()` with sound. On iOS/Android that promise rejects: the "make my video" tap gesture expired during the seconds-long canvas render, so the learner sees a still frame plus `▶` and must tap again. Muted autoplay was explicitly rejected as a fix.

The approved workaround keeps audible motion going with no second tap: queue a display-only tail video into the same gesture-unlocked render session. The recorder is already stopped when the tail starts, so the tail is excluded from the downloaded/shared blob by construction. Sound travels via the already-running `AudioContext` (decoded buffer loop — the same single-audio-path precedent the Safari render path uses), while its `<video>` element stays muted (muted `playsInline` playback is OS-allowed without a gesture). A second hardcoded video swaps in on the Share tap (itself a fresh gesture). Both videos resolve per user language with the same guest-first + English-fallback rule the recap header banner uses. Until the real recordings exist, `intro.mp4` is duplicated as the stand-in content.

## Out of Scope

- Recording the real `aftersuccess` / `aftershare` content (operator records and uploads later; this story ships the stand-in).
- Any change to the recap render, the stitched blob bytes, per-segment ranges, R2 keys/TTL, the share sheet, captions, or burned subtitles.
- A replay button for the concatenated video: the render was already previewed live on canvas during compositing, and the share-sheet download is the review path.
- New dependencies, server-side rendering, or `.native.jsx` variants (web-only playback controller; the pure resolver module is platform-agnostic and shared).
- Auto-poster/LQIP entries for the after-videos (display-only loop, no poster needed).

## Implementation approach

New pure module `src/modules/video/after-video-logic.js` (no React, no DOM, no React Native imports — same portability rule as `video-processor-logic.js`):

- `AFTER_SUCCESS_BASE = 'aftersuccess'`, `AFTER_SHARE_BASE = 'aftershare'`.
- `resolveAfterVideoSlugs(base, guestLang, profileLang)`:
  - `lang = normalizeLanguageCode(resolveConfigLanguage(guestLang, profileLang))` (guest wins, `'en'` default; both helpers already exist and are unit-tested).
  - Return deduped `[`${base}-${lang}`, `${base}-en`, `${base}`]` (skip `${base}-en` when `lang === 'en'`).
- `buildAfterVideoUrls(base, guestLang, profileLang)` maps those slugs through the existing `getVideoUrl` (so dev uses the `/assets/videos/` proxy, prod uses the R2 CDN; no URL rebuilding inline).
- `KEEP_PLAYING_ON_HIDDEN = true` and `shouldAutoPauseOnHidden() === false`: the loop never pauses itself on `document.hidden`/`pagehide`; pausing is only ever user-initiated (tap) or lifecycle-initiated (navigation/reset).

New web-only controller `src/modules/video/after-video-player.web.js` (DOM/`AudioContext`/`fetch` allowed; React Native replaces it later, mirroring `video-processor.web.js`):

- `startAfterVideoLoop({ displayCanvas, base, guestLang, profileLang, audioContext })`: stops any active loop first (single active loop invariant); tries the candidate URLs in order — set the hidden tail element (`id="afterVideo"`, `muted = true`, `loop = true`, `playsInline` + `webkit-playsinline`, 1px hidden like the render's `originalVideo`) to the candidate and await `canplay` (with `error` + 10s timeout advancing to the next candidate, same timeout shape as `SimpleVideoPlayer`); in parallel `fetch` the same candidate, `decodeAudioData`, and start a looping `BufferSource` on the passed **running** context (the single audible path; the element stays muted so there is no double output). Drawing runs on `requestAnimationFrame` with the shared `VideoRenderPlanner.calculateLayout` cover math onto `displayCanvas`. Throws when every candidate fails or the buffer path fails — the caller then runs the blob fallback (never a silent/muted-only loop).
- `swapAfterVideoLoop(base, langArgs)` reuses the running loop's canvas/context and restarts video+buffer from the new base's candidate list.
- `stopAfterVideoLoop()` pauses, stops the buffer, revokes object URLs, and releases the element; it never closes a caller-owned `AudioContext` itself (lifecycle section below owns that). No `visibilitychange`/`pagehide` pause listeners anywhere in this module.
- Tap-to-pause lives on the visible canvas: pause stops both video and buffer; resume recreates the buffer and calls `video.play()` (a real gesture, so audible).

Processor handoff in `src/modules/video/video-processor.web.js` (the "queue into the pipeline" step):

- `handleProcess` (the gesture handler in `SuccessButtons.jsx`) synchronously creates/resumes an `AudioContext` and passes it into `processVideo(fluencyData, lessonId, canvas, { audioContext })` (new optional 4th arg; absent → today's self-created context, so older callers/tests keep working).
- `process()` uses the passed context (never closes it on the success path), resumes it early exactly as today, then: `executeRenderLoop` (recorded plan, unchanged — the tail MUST NOT reuse `executeRenderLoop` because the existing recap guard asserts exactly one `await executeRenderLoop(` call) → `recorder.stop()` → calibrate `rawRanges` to `segments` (pre-tail only) → resolve `{ blob, ext, segments }` data → start the tail loop reusing `originalVideo`/`audioContext`/`videoCanvas`/`displayCanvas` with `AFTER_SUCCESS_BASE`. `cleanup()` (element removal, context close, URL revocation) is deferred until the loop stops. The tail step never touches `onStepStart`/`onStepEnd`/`rawRanges`, so it cannot leak into `segments`, `exportSegmentsToR2`, or `uploadCompleteVideoToR2` (both keep receiving the pre-tail values).
- Tail failure (all candidates 404, buffer failure, muted `play()` rejection) → `cleanup()` + today's fallback: hide canvas, mount `#resultVideo` blob preview with `▶`. Fallback is never muted-only and never silent.

UI wiring (components stay render-only; all rules above come from the modules):

- Store (`src/modules/store/store.js`): new `afterVideoActive: null | 'aftersuccess' | 'aftershare'` + `setAfterVideoActive`. Set on loop start/swap/stop; cleared in `hideSuccessScreen`, `resetForNewLesson`, and `resetForNextStep` (flag only — no side effects in the store).
- `SuccessButtons.jsx`: `runProcessing` keeps `successCanvasVisible: true` when the loop starts (blob + `ready` state still set exactly as today, so the Share/Continue row reveals unchanged); `handleShare` synchronously calls `swapAfterVideoLoop(AFTER_SHARE_BASE, freshGuestFirstLang)` first, then invokes the existing `shareHandlerRef` (share proceeds in parallel; the swap's `play()` owns the Share-tap gesture). The swap is a safe no-op when no loop is active (fallback path: Share works exactly as today).
- `SuccessVideoCanvas.jsx`: stays mounted while the loop is active, `data-testid="after-video-canvas"`, `onClick` toggles controller pause/resume, user-paused state shows the same `▶`-style overlay language as `SuccessVideo`.
- `SuccessVideo.jsx`: renders the blob preview only when `blob && !afterVideoActive` (fallback and pre-loop states; the existing blob-renders-`#resultVideo` spec stays green because it never activates the loop).
- Loop stop triggers: canvas unmount, `hideSuccessScreen`, lesson navigation, Continue/Repeat buttons. `aftershare` missing on swap keeps the `aftersuccess` loop running (the blob share already proceeded); only an `aftersuccess` failure falls back to the blob preview.

## Tasks

### Task 1 - After-video resolver module and unit tests

- Guest Spanish session + `resolveAfterVideoSlugs('aftersuccess', 'es', null)`
  - → returns `['aftersuccess-es', 'aftersuccess-en', 'aftersuccess']` in that order
- Guest empty + profile Bengali + `resolveAfterVideoSlugs('aftershare', null, 'bn')`
  - → returns `['aftershare-bn', 'aftershare-en', 'aftershare']`
- English session + `resolveAfterVideoSlugs('aftersuccess', 'en', 'es')`
  - → returns `['aftersuccess-en', 'aftersuccess']` (guest wins, no duplicate `en`)
- Region tag + `resolveAfterVideoSlugs('aftershare', 'ES-MX', null)`
  - → first entry is `'aftershare-es'`
- Any base + `buildAfterVideoUrls(base, lang...)`
  - → every entry equals `getVideoUrl(slug)` for the slug list in order (dev-relative vs prod-absolute follows the existing helper, asserted via injectable base or URL suffix match)
- Any session + `shouldAutoPauseOnHidden()`
  - → returns `false` and `KEEP_PLAYING_ON_HIDDEN === true`
- New test file `src/modules/video/after-video-logic.test.js` + `npx vitest run src/modules/video/after-video-logic.test.js`
  - → passes; resolver imports `normalizeLanguageCode`, `resolveConfigLanguage`, `getVideoUrl` (no inline URL building, no React/DOM imports — assert via a source guard in the same file's describe block)

### Task 2 - Display-only tail loop in the render session

- Recorded render finishes + tail candidate available + `startAfterVideoLoop` succeeds
  - → tail cannot enter the stitched blob: it starts inside the `recorder.onstop` handler strictly after `recorder.stop()` fired and after `calibrateSegmentRanges` produced `segments` (guard asserts the start call sits after `calibrateSegmentRanges(rawRanges` and before `resolve({ blob, ext, segments })` in index order, and that `recorder.stop()` is issued after `await executeRenderLoop(`)
  - → `segments` contain no tail entry (the controller module contains no `onStepStart`/`onStepEnd` tokens; guard asserts their absence there and their presence only inside `executeRenderLoop` in `video-processor.web.js`)
  - → `exportSegmentsToR2` and `uploadCompleteVideoToR2` receive the pre-tail blob/segments (guard asserts neither call site references the tail bases, `startAfterVideoLoop`, or the candidate list)
- Tail loop active + frame drawn
  - → tail `<video>` has `muted === true`, `loop === true`, `playsInline` set (guard asserts all three on the element identified by `id="afterVideo"`)
  - → audible path is a looping WebAudio buffer (`decodeAudioData` + `createBufferSource` + `loop = true` in the controller slice; guard asserts index order fetch → decode → loop-start on comment-stripped source)
  - → at most one `#afterVideo` element exists (guard asserts the id is assigned only on activation, a stop-first invariant precedes every start, and teardown removes the element; no DOM-count assertion — no real loop runs headlessly)
- Tail loop active + tab hidden
  - → no pause call fires (guard asserts the controller contains no `visibilitychange`/`pagehide` listener and no `document.hidden` branch that pauses)
- All tail candidates 404 or buffer decode fails or muted `play()` rejects
  - → controller throws, caller runs `cleanup()`, canvas hides, `#resultVideo` blob preview mounts with tap-to-play (Playwright: stub candidates to 404 + set blob → `#resultVideo` visible, canvas hidden)
- Guard suite `src/modules/video/after-video-wiring.test.js` follows the repo guard rules (assert raw source for URLs, scope every slice from the function/export start to the next top-level marker instead of EOF, assert index order for sequenced calls) and is proven able to fail by temporarily injecting the forbidden token before submitting
  - → `npx vitest run src/modules/video/after-video-wiring.test.js` passes and the fail-proof run is noted in the test file header

### Task 3 - Success-screen wiring, store flag, and browser spec

- Blob ready + loop started + `successVideoButton.state === 'ready'`
  - → `displayCanvas` stays visible, Share (`#createVideoButton`) + Continue + Repeat row visible, `#resultVideo` absent (Playwright: drive store to ready with loop active → canvas visible, resultVideo count `0`)
- Loop active + learner taps the canvas
  - → playback pauses (video paused + buffer stopped); second tap resumes audible playback (vitest `after-video-player.test.js` with mocked media asserts the full pause/resume cycle deterministically; Playwright asserts the tap surface is safe — click causes no error, no navigation, canvas stays visible, loop flag kept)
- Loop active (`aftersuccess`) + Share button tapped
  - → `handleShare` calls `swapAfterVideoLoop(AFTER_SHARE_BASE, …)` before invoking `shareHandlerRef`, and the swap resolves URLs guest-first for the current session language (guard asserts both the call and the before-order inside the `handleShare` slice, plus that the existing `shareHandlerRef.current()` invocation is preserved after it)
  - → the `shareVideo` flow still runs unmodified (guard asserts the `shareHandlerRef` block is untouched apart from the prepended swap line)
- Share tapped + no loop active (fallback path)
  - → swap no-ops and Share works exactly as today (guard asserts the no-active-loop early return in `swapAfterVideoLoop`; Playwright: stub all after-video routes 404 + set blob + click Share → no exception, loop flag stays `null`)
- Loop active (`aftersuccess`) + every `aftershare` candidate 404s on swap
  - → `aftersuccess` loop keeps playing (no fallback to blob, no empty frame)
- `hideSuccessScreen`, `resetForNewLesson`, or `resetForNextStep` runs while loop active
  - → `afterVideoActive` returns to `null`, controller stopped, tail URLs revoked (guard asserts the flag reset in all three store functions; Playwright asserts canvas hidden after reset)
- Blob set + loop never activated (fallback path)
  - → `#resultVideo` renders exactly as today (asserted by the fallback case in `tests/after-video-loop.spec.js`; the replayable-blob case in the running `tests/success-concat-button.spec.js` stays green — note the old `tests/success-screen.spec.js` is `testIgnore`d and cannot serve as coverage)
- New Playwright spec `tests/after-video-loop.spec.js` drives store state directly (no R2 dependency: `page.route` stubs `**/assets/videos/aftersuccess*` and `**/aftershare*` with 404 for the fallback case; visibility/toggle cases set `afterVideoActive` via `setAfterVideoActive` and assert DOM)
  - → `npx playwright test tests/after-video-loop.spec.js` passes on bundled Chromium (all assertions are media-free); console-error listener reports no new errors. Real audible playback stays a manual device check (Notes) — bundled Chromium lacks H.264, so any future media-bearing case must run real Chrome (`channel: 'chrome'`).

### Task 4 - Desktop download delivery (Windows/Mac/Chromebook/Linux)

- Context: the Web Share spec rejects with an identical `AbortError` both when the user cancels and when no share targets are available, so a silent rejection can mean the sheet never appeared — exactly the Windows report (spinner, no sheet, "dismissed" log with no dismissal). Desktop OS implementations are unreliable (Windows flaky/absent targets; Edge and Firefox desktop lack file sharing); mobile sheets are reliable.
- Any iOS (incl. iPadOS MacIntel+touch) or Android UA + share tapped
  - → native sheet path unchanged (`deliverVideo` → `shareVideo`; unit asserts `navigator.share` untouched on the download branch and the sheet used on native)
- Any Windows/Mac/Chromebook/Linux UA (incl. touchscreen laptops) + share tapped
  - → mp4-ensured blob saved via transient anchor download (`downloadVideoBlob`: object URL → `link.download = name` → click → sync remove → deferred revoke; unit asserts attr/click/removal/revoke order with fake timers)
- Any desktop UA + ready screen rendered
  - → `#createVideoButton` carries `bi-download` (mobile keeps `bi-share-fill`); the localized Share label is unchanged (Playwright asserts the desktop icon class; guard asserts both icon tokens and the `getDeviceShareTarget() === SHARE_TARGET_DOWNLOAD` gate)
- Share tapped twice in rapid succession (either target)
  - → second tap ignored while the first is in flight (`sharingRef` synchronous guard + `disabled={sharing}` spinner; guard asserts guard-set precedes the swap call and `setSharing(false)` resets in `finally`)
- Sheet dismissed by the user (native target)
  - → benign info log, button resets, no error (guard asserts the `AbortError` branch; pre-existing error log for real failures unchanged)
- New/changed files: `share-target-logic.js` (+`share-target-logic.test.js`, injected-UA fixtures per OS), `video-share.web.js` (`ensureMp4Blob` extracted verbatim from `shareVideo`, `downloadVideoBlob`, `deliverVideo`), `SuccessButtons.jsx` (target-resolved `deliverVideo`, download icon), `video-share-download.test.js`, wiring-guard additions, Playwright icon assertion
  - → `npx vitest run src/modules/video/` passes; `npm run lint` has 0 errors; `npx playwright test tests/after-video-loop.spec.js` passes

## Technical Context

- No new dependencies. All imports already in the codebase: `normalizeLanguageCode` (`src/modules/utils/utils.js`), `resolveConfigLanguage` (`src/modules/bilingual/config-normalizer.js`), `getVideoUrl` (`src/modules/video/video-url.js`), `VideoRenderPlanner.calculateLayout` (`src/modules/video/video-processor-logic.js`), zustand store, existing `AudioContext`/`MediaRecorder`/canvas patterns in `video-processor.web.js`.
- R2 layout (public `uff` bucket, 48h `videos/` TTL is dashboard-configured): lesson media `assets/videos/<slug>.mp4`; after-videos resolve to `assets/videos/aftersuccess[-<lang>].mp4` and `assets/videos/aftershare[-<lang>].mp4` (dev serves them through the existing `/assets/videos/` Vite proxy). Supported language suffixes: `en/es/pt/fr/hi/bn` (the `HOME_LANGUAGES` set; suffixes mirror the `video-header-<lang>.png` banner convention).
- Stand-in upload until the real recordings exist (copy-pasteable; approved temp dir per environment):
  - `npx wrangler r2 object get uff/assets/videos/intro.mp4 --file /tmp/opencode/intro.mp4`
  - `npx wrangler r2 object put uff/assets/videos/aftersuccess.mp4 --file /tmp/opencode/intro.mp4 --content-type video/mp4`
  - `npx wrangler r2 object put uff/assets/videos/aftershare.mp4 --file /tmp/opencode/intro.mp4 --content-type video/mp4`
  - The resolver's bare-slug fallback makes these two objects sufficient for every language until localized recordings land (later: upload `aftersuccess-<lang>.mp4` / `aftershare-<lang>.mp4` per language; no code change).
- Verify commands: `npx vitest run src/modules/video/after-video-logic.test.js`, `npx vitest run src/modules/video/after-video-wiring.test.js`, `npx vitest run`, `npm run lint`, `npx playwright test tests/after-video-loop.spec.js` (media-free assertions run on bundled Chromium; audible playback is a manual device check, not CI).

## Notes

- Non-automatable (device/operator verified, not test-asserted): real `aftersuccess`/`aftershare` recordings are not part of this story; audible tail continuation and background-audio persistence vary by OS version and must be confirmed on physical iOS/Android (background play is best-effort — some OS builds suspend background tabs regardless of page code); R2 object uploads are operator steps.
- UX contract from the requester: tap pauses/resumes the loop like the rest of the app's video controls; no replay button for the concatenated video (share-sheet download is the review path); the loop runs until paused or until navigation/reset; the background reminder keeps audio going where the OS permits.
- iOS policy summary for the implementer: unmuted `<video>.play()` without a gesture rejects; muted `playsInline` playback is allowed; a running `AudioContext` (resumed inside the original tap) can start new buffer sources without a new gesture — which is why the tail is audible while its element stays muted. Never "fix" a rejection by leaving the loop muted-only; the specified fallback is the blob preview.
- Guard rule: the new wiring guard must be proven able to fail (temporarily inject e.g. a `document.hidden` pause or a tail `onStepStart` call, watch it go red, then revert) before the story is marked complete.
- Contention caveat: the Share-tap swap runs while `shareVideo` may transcode via WebCodecs on the same thread; on low-end Android the loop may jank during the transcode. That is accepted (the loop is a best-effort reminder, the share is the payload) — do not block the share on loop start, and do not block the loop swap on share completion.
