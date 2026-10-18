# Stop the 9:16 camera composite from recording a frozen first frame

## Context

On Android Chrome, the **first** `friendClosedResponse` of a `wouldyourather` lesson a recorded a **single frozen camera frame with a complete, correct audio track**. The learner saw the freeze live: the full-screen recording view (`WebcamPreview` in `pip-container--takeover`) was static from the first frame onward, and the finished video carried the same static image.

### What we know

Every non-iOS device records through a synthetic pipeline in `src/modules/speech/speech.web.js`:

```
getUserMedia → hidden 2px <video> (:106-114) → ctx.drawImage() into a 720×1280/1080×1920 canvas (:116-137)
             → setInterval(draw, ~33-42ms) (:144) → canvas.captureStream() (:147) → MediaRecorder (:290)
```

**The audio is not part of that pipeline** — it is the untouched raw camera track (`speech.web.js:148`). So "video frozen, audio perfect" is the signature of a stalled composite, and the frozen live preview confirms it: `WebcamPreview.jsx:41` binds `getWebcamStream()`, i.e. the very same composite stream the recorder consumes. One artifact, two symptoms.

Per `docs/learnings.md:190`, Chrome emits a canvas `captureStream` frame **only when the canvas changes**. Once the source `<video>` stops advancing, `draw()` keeps repainting a pixel-identical image, the canvas never changes, and the take is one frozen frame. The composite has no defence against this; the recap's `executeRenderLoop` does.

Side by side, the pipeline that works vs. the one that froze:

| | speech composite (`speech.web.js`) | recap loop (`video-processor.web.js`) |
|---|---|---|
| repaint scheduler | `setInterval` (`:144`) | `requestAnimationFrame` (`:922`) |
| source paused by the OS | never checked | `video.paused` → `play()`, muted retry (`:856-868`) |
| `play()` rejected | swallowed as one `console.warn` (`:114`) | retried |
| metadata missing | `draw()` silently no-ops forever (`:119`) | `lastFrameCanvas` freeze-frame fallback (`:884-903`) |
| `drawImage` throws | uncaught; loop keeps firing but never paints (`:116-137`) | swallowed by `paintCompositeFrame`-equivalent guard |
| canvas in DOM | **no** — `document.createElement` only (`:98`) | **yes** — appended (`:203`, `:1394`) |

### What we know about "only the first response"

On the first response the Whisper engine is still loading, so `speech-orchestrator.js:220-242` takes the not-ready abort and calls `stopSpeechCamRecording({ keepStreamAlive: true, … })`. The recorder never started, so `stopSpeechCamRecording` takes its inactive branch (`speech.web.js:369-375`), where `!keepStreamAlive || isAndroid` is **true because of `isAndroid`** — destroying the composite built by `warmUpSpeechCam()` at step load. The second mic tap then rebuilds it with a fresh `getUserMedia` and calls `recorder.start()` roughly **10ms later** (`speech-orchestrator.js:198` then `:318`, only synchronous hooks between).

On every later response Whisper is warm, so the abort never fires, and the composite is rebuilt at step load with **seconds** of settling time before `recorder.start()`. That timing difference is the one thing we can point at; everything else is a hypothesis.

### What we do NOT know

We cannot tell from the outside whether the freeze was a stalled source `<video>`, a persistent `drawImage` throw, encoder memory pressure from the freshly-resident Whisper model, or Chrome's canvas-change detection. The plan therefore splits into a **Phase 1 of provably-safe structural fixes + instrumentation**, and a **Phase 2 that depends on what the field logs show**.

## Out of Scope

- The iOS raw-stream path (`shouldUsePortraitCapture()` returns `!isIOS()`, `speech.web.js:28-30`). Untouched.
- The `isCameraOff` placeholder composite (`speech.web.js:169-229`) — different canvas, 5 fps, not implicated.
- `VideoRenderPlanner.getTargetDimensions` and its other call sites — unchanged.
- The recap render loop (`executeRenderLoop`), overlay, subtitles, segment ranges, trimming, R2 upload — the recap worked (it replayed a frozen blob as a static image with correct audio, which is expected).
- Changing `shouldUsePortraitCapture()`, the composite's resolution/fps, or the MIME chain.
- The "release the composite on Android before Whisper" rule **for takes that actually recorded** — load-bearing for the OOM in `docs/learnings.md:158`. Only the never-started abort is exempted.
- Any new dependency.
- **Phase 2 items** (see below): rAF rewrite + watchdog, aspect-ratio change, user-facing banner.

## Implementation approach

### Pure rules move to `src/modules/speech/portrait-capture-logic.js`

Per `AGENTS.md` ("Logic lives in modules, never in components") and so the rules are unit-testable without a browser. `speech.web.js` stays a thin browser adapter. The module has **no React, no DOM and no browser globals**.

**1. `resolveCompositeDimensions({ isAndroid })`** → `{ width, height, fps }` — desktop `1080×1920 @ 30fps`; phones `720×1280 @ 24fps`. Extracted from `speech.web.js:95-97`.

**2. `compositeCropRect({ videoWidth, videoHeight, canvasWidth, canvasHeight })`** → `{ sx, sy, sw, sh } | null` — the cover-crop maths from `draw()` (`:120-135`), verbatim. `null` replaces the silent `if (!vw || !vh) return;` (`:119`); the caller treats `null` as "skip this tick".

**3. `paintCompositeFrame({ ctx, video, rect, canvasWidth, canvasHeight })`** → `boolean` — the one statement that touches a browser object, isolated behind fakes:

```
rect === null                 → false  (tick skipped; loop keeps running)
ctx.drawImage throws          → false  (swallowed; loop keeps running)
otherwise                     → true, after ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvasWidth, canvasHeight)
```

`ctx` and `video` are plain objects in tests, so this runs in jsdom with no canvas.

**4. `createLivenessCounter()`** → `{ recordPaint(), recordSourceAdvance(), snapshot(), reset() }` — `snapshot()` returns `{ framesDrawn, sourceAdvances }`, both starting at `0`. `recordSourceAdvance()` is called only when `video.currentTime` has actually increased.

**5. `createFreezeReporter(deps)`** → `{ start(), tick(), reset(), didReport() }` — the "report once" policy with every side effect injected:

```
deps = { snapshotCounter, nowMs, getMeta, getMessage, onConsoleError, onTrackEvent, onUserMessage }
```

- `start()` arms it, snapshots the counters as baseline, stamps `startedAtMs = nowMs()`, clears `didReport`.
- `tick()` returns `false` without side effects when not armed or already reported; otherwise evaluates `isTakeFrozen` and, on the first `true`, sets `didReport` and calls `onConsoleError` / `onTrackEvent('camera_frozen', …)` / `onUserMessage` **exactly once each**, then returns `true`.
- `reset()` disarms and clears `didReport`.

**6. `shouldForceReleaseComposite({ isAndroid, keepStreamAlive, recordingStarted })`** → `boolean`:

```
keepStreamAlive === false                       → true
isAndroid && recordingStarted                   → true
otherwise                                      → false
```

`recordingStarted` is `speechCamRecorder.state !== 'inactive'` evaluated **before** the recorder is nulled. This exempts the Whisper-not-ready abort (nothing was encoded, so the OOM window in `docs/learnings.md:158` doesn't apply) while preserving the release for real takes.

**7. `isTakeFrozen({ framesDrawn, sourceAdvances, baselineFramesDrawn, baselineSourceAdvances, nowMs, recordingStartedAtMs })`** → `boolean` — `true` only when both counters are unchanged and `nowMs - recordingStartedAtMs >= COMPOSITE_FROZEN_MS` (3000ms).

**8. `resolveCompositeWatchdog(snapshot)`** → `'resume' | 'wait' | 'idle'` — the resume ladder (`COMPOSITE_STALL_MS = 2000`), for Phase 2:

| # | condition | result |
|---|---|---|
| 1 | `hasEverHadMetadata === false` | `'wait'` |
| 2 | `paused && !ended && readyState >= 2` | `'resume'` |
| 3 | `lastSourceAdvanceAtMs !== null && nowMs - lastSourceAdvanceAtMs >= COMPOSITE_STALL_MS` | `'resume'` |
| 4 | `hasEverHadMetadata && readyState < 2` | `'resume'` |
| 5 | otherwise | `'idle'` |

### Phase 1 — Ship now (provably safe, no behaviour guesswork)

**A. Append the composite canvas to the DOM.** `speech.web.js:98` creates `canvas` but never appends it — the only capture canvas in the repo that isn't (`video-processor.web.js:203`, `:1394` both append, with a comment that a detached canvas yields a blank track). One line, zero risk, consistency with the codebase's own documented rule.

**B. Replace `ctx.drawImage` with `paintCompositeFrame`.** The swallowing lives in the pure module and is tested with fakes. The rAF/setInterval callback becomes:

```js
function tick() {
    const rect = compositeCropRect({ videoWidth: video.videoWidth, videoHeight: video.videoHeight, canvasWidth: canvas.width, canvasHeight: canvas.height });
    paintCompositeFrame({ ctx, video, rect, canvasWidth: canvas.width, canvasHeight: canvas.height });
    if (rect !== null) liveness.recordPaint();
    if (video.currentTime > lastSourceTime) { liveness.recordSourceAdvance(); lastSourceTime = video.currentTime; }
    // re-schedule
}
```

**The no-throw invariant:** nothing in `tick()` may throw. `paintCompositeFrame` swallows draw failures; `compositeCropRect` returns `null` instead of throwing; `video.currentTime` is a read-only property that doesn't throw. This invariant must hold for the entire callback body, not just the draw call — if it breaks, the loop dies.

**C. Exempt the never-started abort from the Android release.** `speech.web.js:369-375`: replace `if (!keepStreamAlive || isAndroid)` with `if (shouldForceReleaseComposite({ isAndroid, keepStreamAlive, recordingStarted: speechCamRecorder.state !== 'inactive' }))`. The `recordingStarted` check happens **before** `speechCamRecorder = null`. This kills the mid-flow teardown + second `getUserMedia` that makes take 1 different from takes 2+.

**D. Frozen-take detection (logging + telemetry only).** `startDeferredSpeechCamRecording()` creates a reporter whose sinks are `console.error`, `trackEvent` and nothing user-facing:

```js
const reporter = createFreezeReporter({
    snapshotCounter: () => liveness.snapshot(),
    nowMs: () => performance.now(),
    getMeta: () => ({ lessonId, stepIndex, responseType }),
    getMessage: () => Strings.get('error_camera_frozen', getAppLanguage()),
    onConsoleError: (msg, detail) => console.error(msg, detail),
    onTrackEvent: (name, props) => trackEvent(name, props),
    onUserMessage: () => { /* Phase 2 */ },
});
reporter.start();
// tick from a 1 Hz setInterval; reporter.reset() on both stop paths
```

On the first freeze: `console.error('[Recording] take produced no camera frames — the clip will be frozen', { framesDrawn, sourceAdvances, elapsedMs })` + `trackEvent('camera_frozen', { lessonId, stepIndex, responseType, elapsedMs })`. No user-facing banner yet.

**E. Fake-media Playwright regression guard.** Add `--use-fake-device-for-media-stream` to the Playwright launch args (or a dedicated project). Write a spec that drives a friend lesson, lets the composite paint, and asserts the recorded blob contains **more than one distinct video frame** and that no `camera_frozen` event fires. This is the only test that could have caught the original bug.

### Phase 2 — After field logs (conditional)

Only if the Phase 1 telemetry shows source stalls or the freeze persists:

- **rAF rewrite + watchdog**: switch `setInterval` to `requestAnimationFrame`, add the 1 Hz watchdog calling `resolveCompositeWatchdog`, with the resume ladder and muted retry. The no-throw invariant from Phase 1 is what makes this safe.
- **Aspect-ratio change**: add `resolveRecapDimensions` to `video-processor-logic.js` and switch the two call sites (`video-processor.web.js:263-268`, `:1557-1559`). Only if the probe log shows off-aspect takes.
- **User-facing banner**: wire `onUserMessage` to `setSystemMessage({ type: 'media-error', text: getMessage() })` once the field rate is known.

## Tasks

### Task 1 - Pure module + tests

Create `src/modules/speech/portrait-capture-logic.js` exporting `COMPOSITE_STALL_MS`, `COMPOSITE_FROZEN_MS`, `COMPOSITE_WATCHDOG_MS`, `resolveCompositeDimensions`, `compositeCropRect`, `paintCompositeFrame`, `createLivenessCounter`, `shouldForceReleaseComposite`, `isTakeFrozen`, `createFreezeReporter` and `resolveCompositeWatchdog`. Create `portrait-capture-logic.test.js` covering every rule.

- `resolveCompositeDimensions({ isAndroid: true })` → `{ width: 720, height: 1280, fps: 24 }`
- `resolveCompositeDimensions({ isAndroid: false })` → `{ width: 1080, height: 1920, fps: 30 }`
- `compositeCropRect` with `1280×720` into `1080×1920` → `{ sh: 720, sw: 405, sx: 437.5, sy: 0 }`, centred horizontally
- `compositeCropRect` with `720×1280` into `1080×1920` → `{ sw: 720, sh: 1280, sx: 0, sy: 0 }`
- `compositeCropRect` with `600×1600` into `1080×1920` → `sw: 600`, `sh: 600 / (1080/1920)`, `sy: (1600 - sh) / 2`
- `compositeCropRect` with zero/NaN/non-finite dims → `null`
- `paintCompositeFrame` with a real rect and a spy ctx → returns `true`, spy called with `(video, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight)`
- `paintCompositeFrame` with `rect: null` → returns `false`, spy not called, no throw
- `paintCompositeFrame` with a throwing `drawImage` → returns `false`, no rethrow
- `createLivenessCounter`: fresh `snapshot()` → `{ framesDrawn: 0, sourceAdvances: 0 }`; `recordPaint()` three times → `framesDrawn: 3`; `reset()` → both back to `0`; two counters are independent
- `shouldForceReleaseComposite`: Android + recorded → `true`; Android + never-started → `false`; non-Android + `keepStreamAlive: false` → `true`; non-Android + `keepStreamAlive: true` + recorded → `false`
- `isTakeFrozen`: both unchanged + past threshold → `true`; one millisecond short → `false`; either counter advanced → `false`; `recordingStartedAtMs: null` → `false`
- `createFreezeReporter`: started then ticked past threshold with unchanged counters → first `tick()` returns `true`, all three sinks called exactly once; three more ticks → `false`, no additional calls; counters advancing → no calls; `tick()` before `start()` → `false`; `reset()` then `start()` → reports again for the new take
- `resolveCompositeWatchdog`: every rule in the table (wait before metadata, resume on paused, resume on stall boundary inclusive, resume on lost decoder, idle otherwise)
- importing `portrait-capture-logic.js` references no browser global (`window`, `document`, `navigator` absent from raw source, no comment stripping)

### Task 2 - Composite hardening (Phase 1)

Rewrite `createPortraitCaptureStream` in `src/modules/speech/speech.web.js`. Extend `portrait-capture-guards.test.js` — the existing guards that assert on code this moves must be **rewritten, not deleted**, with at least equivalent coverage:

| existing guard | disposition |
|---|---|
| `gates the composite on a device check that excludes iOS only` | unchanged |
| `asks the camera for a plain 16:9 source` | unchanged |
| `only applies the composite when the device check passes` | unchanged |
| `tears the composite down alongside the camera stream` | unchanged |
| `builds a 9:16 canvas stream, centre-cropping the camera` | **rewritten** — dims become `resolveCompositeDimensions`, crop becomes `compositeCropRect`, draw becomes `paintCompositeFrame`, `canvas.captureStream(captureFps)` becomes `canvas.captureStream(dimensions.fps)`. `rawStream.getAudioTracks()` stays a source guard. |
| `releases the composite on phones when recording stops` | **rewritten** — two literal string matches become a count of exactly **2** `shouldForceReleaseComposite(` call sites plus the index-order check below. |

New/changed guards on `createPortraitCaptureStream` body (sliced with `functionBody`):

- contains `resolveCompositeDimensions(` and `compositeCropRect(` and `paintCompositeFrame(` and `createLivenessCounter(` and `createFreezeReporter(`
- contains `document.body.appendChild(canvas)` (the detached-canvas fix)
- contains `rawStream.getAudioTracks()` (audio passthrough preserved)
- does **not** contain `ctx.drawImage(` (the draw moved into `paintCompositeFrame`)
- `compositeCropRect(` index < `paintCompositeFrame(` index
- `createLivenessCounter(` feeds `createFreezeReporter(` (index order)

On `teardownPortraitCapture` body:

- `cancelAnimationFrame` and `clearInterval` each appear, each guarded by its own null check
- still pauses, nulls `srcObject`, removes `compositeVideoEl`
- still stops every `compositeRawStream` track in `try/catch`
- `reset()` is called

On `stopSpeechCamRecording` body:

- exactly **2** call sites of `shouldForceReleaseComposite(`
- `speechCamRecorder.state !== 'inactive'` appears **before** `speechCamRecorder = null` (index order)

On `startDeferredSpeechCamRecording` body:

- contains `createFreezeReporter(` and `start()`

### Task 3 - Playwright regression guard

- `playwright.config.js` gains `--use-fake-device-for-media-stream` (via `launchOptions.args` or a dedicated project)
- a new spec drives a friend lesson end to end, records a take, and asserts the saved blob contains **more than one distinct video frame** and that no `camera_frozen` event was emitted
- the spec passes on the fixed code and would fail on the pre-fix code (prove by temporarily reverting the swallowing)

### Task 4 - Record the diagnosis

- `docs/learnings.md` gains an entry: the governing rule (Chrome emits a canvas `captureStream` frame only when the canvas changes); the symptom "video frozen, audio perfect" uniquely identifies the composite because the audio track bypasses it; the first `friendClosedResponse` is uniquely exposed because the Whisper-not-ready abort used to destroy the composite on Android (the **timing** difference, not memory pressure); `shouldForceReleaseComposite` keeps the Android release for real takes while exempting the never-started abort; `paintCompositeFrame` is what stops a persistent throw from freezing the loop; the precise trigger was **not** isolated and the telemetry is what makes the next occurrence diagnosable
- `docs/product.md` `## Features` gains one entry describing the self-healing composite, linked to this story

### Phase 2 tasks (conditional on field logs)

- **rAF rewrite**: switch `setInterval` to `requestAnimationFrame`, add the 1 Hz watchdog calling `resolveCompositeWatchdog`, resume ladder and muted retry. Only if telemetry shows source stalls.
- **Aspect ratio**: add `resolveRecapDimensions` to `video-processor-logic.js`, switch the two call sites. Only if the probe log shows off-aspect takes.
- **User-facing banner**: wire `onUserMessage` to `setSystemMessage({ type: 'media-error', text: getMessage() })`. Only after the field rate is known.

## Technical Context

No new dependencies.

- `vitest ^4.1.6` — `environment: 'jsdom'`, `globals: true`. The pure module imports directly; `speech.web.js` cannot be imported in jsdom (reads `navigator.platform` and `HTMLCanvasElement.prototype.captureStream` at module load) — this is why every decision rule lives in the pure module and only wiring is asserted by source guards.
- `@playwright/test ^1.60.0` — the new regression guard needs `--use-fake-device-for-media-stream`. `playwright.config.js` `testIgnore`s `e2e-smoke`, `recording-persistence`, `success-screen` and `whisper-review`; the new spec must not be in that list.

Browser APIs, all already used by this repo:

- `HTMLCanvasElement.captureStream(fps)` — `speech.web.js:147`, `video-processor.web.js:292`
- `requestAnimationFrame` — `video-processor.web.js:922` (Phase 2 only)
- `HTMLMediaElement.currentTime` — read off the hidden `<video>`, not the track

## Notes

- **The diagnosis is right; the mechanism is a guess.** The frozen live preview plus intact audio pins the fault to the composite beyond reasonable doubt, but we cannot distinguish a stalled source, a persistent `drawImage` throw, encoder pressure or Chrome's change-detection from the outside. Phase 1 fixes the two structural defects we can prove (the throw and the mid-flow rebuild) and instruments everything else.
- **The rAF rewrite is Phase 2, not Phase 1.** `setInterval` does not die on a throw (it keeps firing, just never painting), so Phase 1's swallowing is what fixes mechanism (d). Switching schedulers introduces new fragility (a throw kills the rAF chain permanently) and is only justified if telemetry shows source stalls. The no-throw invariant must hold for the **entire** callback body, not just the draw call — this is the guard that matters, and it is stronger than "no `try` block".
- **`getContext('2d')` returning `null`** is handled as a logged no-op rather than a throw. It does not throw, so a null-check suffices; the no-throw invariant covers it.
- **The detached canvas fix is consistency, not a proven cause.** The codebase's own comments (`video-processor.web.js:200-202`, `:1390-1392`) state a detached canvas yields a blank track, but they scope it to iOS Safari, and the composite never runs on iOS. It is a free hardening that removes an asymmetry; it is not the explanation.
- **Do not "fix" this by loosening the Android release rule.** `docs/learnings.md:158` records that a 1080×1920 canvas plus a software encode OOM'd low-memory Android devices while Whisper was resident. `shouldForceReleaseComposite` keeps that release for every take that actually recorded and exempts only the abort where nothing was ever encoded.
- **The `error_camera_frozen` copy is deferred.** Phase 1 ships logging + telemetry only. User-facing copy follows the field data; if it is eventually added, it needs all six locales (`en`/`es`/`pt`/`fr`/`hi`/`bn`) and a native-speaker review.
- **`getTargetDimensions` keeps its current behaviour.** Only the two recap call sites would move in Phase 2, and only if the probe log justifies it.
- **Task 3 (the Playwright guard) is the only test that could have caught the original bug.** The pure-module tests prove the rules; the source guards prove the wiring; only an end-to-end frame count proves the composite actually produces frames. Do not skip it.