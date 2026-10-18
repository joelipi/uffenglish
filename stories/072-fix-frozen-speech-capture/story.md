# Stop the 9:16 camera composite from recording a frozen first frame

## Context

On Android Chrome, the **first** `friendClosedResponse` of a `wouldyourather` lesson a recorded a **single frozen camera frame with a complete, correct audio track**. The learner saw the freeze live: the full-screen recording view (`WebcamPreview` in `pip-container--takeover`) was static from the first frame onward, and the published friend clip and the concatenated recap both carried the same static image.

Every non-iOS device records through a synthetic pipeline in `src/modules/speech/speech.web.js`:

```
getUserMedia → hidden 2px <video> (:106-114) → ctx.drawImage() into a 1080×1920/720×1280 canvas (:116-137)
             → setInterval(draw, ~33ms) (:144) → canvas.captureStream() (:147) → MediaRecorder (:290)
```

**The audio is not part of that pipeline** — it is the untouched raw camera track (`speech.web.js:148`). So "video frozen, audio perfect" is the exact signature of a stalled composite, and the frozen live preview confirms it: `WebcamPreview.jsx:41` binds `getWebcamStream()`, i.e. the very same composite stream the recorder consumes. One artifact, two symptoms.

**Why the canvas stops emitting frames.** `docs/learnings.md:190` already records the governing rule for this repo: *"Chrome emits a canvas frame only when the canvas changes."* Once the source `<video>` stops advancing, `draw()` keeps repainting a pixel-identical image, the canvas never changes, `captureStream` emits no further frames, and the take is one frozen frame. The composite has no defence against this at all — contrast the recap's `executeRenderLoop`, which does (see the table in Notes).

**Why only the first response.** On the first response the Whisper engine is still loading, so `speech-orchestrator.js:220-242` takes the not-ready abort and calls `stopSpeechCamRecording({ keepStreamAlive: true, … })`. The recorder was never started, so `stopSpeechCamRecording` takes its inactive branch (`speech.web.js:369-375`), where `if (!keepStreamAlive || isAndroid)` is **true because of `isAndroid`** — so the composite built by `warmUpSpeechCam()` at step load is destroyed, and the second mic tap rebuilds it mid-flow with a fresh `getUserMedia`, at the exact moment the freshly-resident Whisper model is competing for memory. Every later response has Whisper warm, never enters that branch, and reuses one composite. That is why only the first response is exposed.

**The aspect ratio** is a second, independent defect. The recap canvas is sized from *the first speech-recording blob of the lesson* (`video-processor.web.js:206-214`, `:263-268`), and `getTargetDimensions` (`video-processor-logic.js:517-541`) **preserves whatever aspect that blob has**, only upscaling. One off-aspect take therefore dictates the aspect of the entire recap and of every per-segment published clip (`:1557-1559` uses the same call).

## Out of Scope

- The iOS raw-stream path (`shouldUsePortraitCapture()` returns `!isIOS()`, `speech.web.js:28-30`). It is untouched by this story and its behaviour is unchanged.
- The `isCameraOff` placeholder composite (`speech.web.js:169-229`) — different canvas, different 5 fps rate, not implicated in this report.
- `VideoRenderPlanner.getTargetDimensions`. Its contract and call sites outside the two recap paths stay exactly as they are; the new resolver is additive and the two call sites below switch to it.
- The recap render loop itself (`executeRenderLoop`), its overlay, subtitles, segment ranges, trimming and the R2 upload path. The recap *worked* — it replayed a frozen blob as a static image with correct audio, which is the expected behaviour for such a blob.
- Changing `shouldUsePortraitCapture()`, the composite's resolution or fps, the MIME negotiation chain, or the "release the composite on Android before Whisper" rule for takes that actually recorded (that rule is load-bearing for the OOM in `docs/learnings.md:158`).
- Any new dependency. Everything here is pure JS plus existing modules.

## Implementation approach

### Pure rules move to `src/modules/speech/portrait-capture-logic.js`

Per `AGENTS.md` ("Logic lives in modules, never in components") and so the rules are unit-testable without a browser. `speech.web.js` stays a thin browser adapter. The module has **no React, no DOM and no browser globals**, so `vitest` (jsdom) imports it directly.

**1. `resolveCompositeDimensions({ isAndroid })`** → `{ width, height, fps }`

Desktop `1080×1920 @ 30fps`; phones `720×1280 @ 24fps`. Extracted from the three `const`s at `speech.web.js:95-97` so the Android sizing decision is asserted behaviourally instead of by matching source text.

**2. `compositeCropRect({ videoWidth, videoHeight, canvasWidth, canvasHeight })`** → `{ sx, sy, sw, sh } | null`

The cover-crop maths currently inline in `draw()` (`:120-135`), verbatim:

```
if videoWidth/videoHeight/canvasWidth/canvasHeight is not a finite number > 0  → null
canvasAspect = canvasWidth / canvasHeight;  videoAspect = videoWidth / videoHeight
if videoAspect > canvasAspect  → { sh: videoHeight, sw: videoHeight * canvasAspect,
                                   sx: (videoWidth - sw) / 2, sy: 0 }          // crop the sides
else                           → { sw: videoWidth,  sh: videoWidth / canvasAspect,
                                   sx: 0, sy: (videoHeight - sh) / 2 }          // crop top/bottom
```

The strict `>` comparison and the crop directions are preserved exactly. `null` replaces the bare `if (!vw || !vh) return;` early-out (`:119`), which today fails silently and forever; the caller treats `null` as "skip this tick", not as "stop".

**3. `resolveCompositeWatchdog(snapshot)`** → `'resume' | 'wait' | 'idle'`

`snapshot = { hasEverHadMetadata, readyState, paused, ended, lastSourceAdvanceAtMs, nowMs }`, first matching rule wins:

| # | condition | result |
|---|---|---|
| 1 | `hasEverHadMetadata === false` | `'wait'` — the camera is still opening; there is nothing to resume yet |
| 2 | `paused && !ended && readyState >= 2` | `'resume'` — the OS paused it (mirrors the proven resume in `video-processor.web.js:856-868`) |
| 3 | `lastSourceAdvanceAtMs !== null && nowMs - lastSourceAdvanceAtMs >= COMPOSITE_STALL_MS` | `'resume'` — decoded but `currentTime` frozen |
| 4 | `hasEverHadMetadata && readyState < 2` | `'resume'` — the source lost its decoder |
| 5 | otherwise | `'idle'` |

`COMPOSITE_STALL_MS = 2000`.

A rejected `play()` leaves `video.paused === true`, so it self-heals through rule 2 without needing its own branch.

**4. `paintCompositeFrame({ ctx, video, rect, canvasWidth, canvasHeight })`** → `boolean`

The one statement that touches a browser object, isolated behind fakes so it is unit-testable without a canvas:

```
rect === null                        → false   (tick skipped; the loop keeps running)
ctx.drawImage throws                 → false   (swallowed; the loop keeps running)
otherwise                            → true, after calling
  ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvasWidth, canvasHeight)
```

`ctx` and `video` are plain objects in the tests, so this runs in jsdom with no canvas. It must never rethrow: an exception escaping a `requestAnimationFrame` callback kills the loop for the rest of the session and reproduces the exact reported symptom with no console trace.

**5. `createLivenessCounter()`** → `{ recordPaint(), recordSourceAdvance(), snapshot(), reset() }`

`snapshot()` returns `{ framesDrawn, sourceAdvances }`, both starting at `0`; `reset()` returns both to `0`. `recordSourceAdvance()` is called only when `video.currentTime` has actually increased, so a paused source does not inflate the count. This is what the recorder snapshots as its baseline and what `isTakeFrozen` compares against.

**6. `shouldForceReleaseComposite({ isAndroid, keepStreamAlive, recordingStarted })`** → `boolean`

```
keepStreamAlive === false                       → true
isAndroid && recordingStarted                   → true
otherwise                                      → false
```

`recordingStarted` is `speechCamRecorder.state === 'inactive'` evaluated **before** the recorder is nulled. This is the "first response only" fix: when the recorder never started there is no encoded blob, no encoder output and no pending transcription, so the OOM window that motivated the Android release (`docs/learnings.md:158`) does not exist and the composite survives for the second mic tap — exactly how every later response already behaves.

**7. `createFreezeReporter(deps)`** → `{ start(), tick(), reset(), didReport() }`

The "warn once, and never silently" policy, with **every side effect injected** so it is testable in jsdom with spies and `speech.web.js` stays a pure adapter:

```
deps = {
  snapshotCounter,  // () => ({ framesDrawn, sourceAdvances })   — from createLivenessCounter
  nowMs,            // () => number
  getMeta,          // () => ({ lessonId, stepIndex, responseType })
  getMessage,       // () => string   (already localized by the caller)
  onConsoleError,   // (message, detail) => void
  onTrackEvent,     // (name, props) => void
  onUserMessage,    // (text) => void
}
```

- `start()` arms it, snapshots the counters as the baseline, stamps `startedAtMs = nowMs()`, and clears `didReport`.
- `tick()` returns `false` without doing anything when not armed or already reported; otherwise evaluates `isTakeFrozen` and, on the first `true`, sets `didReport` and calls `onConsoleError` / `onTrackEvent('camera_frozen', …)` / `onUserMessage` **exactly once each**, then returns `true`.
- `reset()` disarms and clears `didReport` — called from `stopSpeechCamRecording` on both the active and inactive path.

**8. `isTakeFrozen({ framesDrawn, sourceAdvances, baselineFramesDrawn, baselineSourceAdvances, nowMs, recordingStartedAtMs })`** → `boolean`

`true` only when `framesDrawn === baselineFramesDrawn && sourceAdvances === baselineSourceAdvances && nowMs - recordingStartedAtMs >= COMPOSITE_FROZEN_MS`. `COMPOSITE_FROZEN_MS = 3000`. Both counters must be stuck, so a live repaint loop over a momentarily-still camera is not reported.

`COMPOSITE_WATCHDOG_MS = 1000` for the watchdog tick.

### `createPortraitCaptureStream` becomes self-healing

- **`setInterval` → `requestAnimationFrame`.** `speech.web.js:144` becomes a self-scheduling rAF loop holding `compositeRafId` (replacing `compositeDrawTimer`), cancelled in `teardownPortraitCapture`. This is the same scheduler `executeRenderLoop` uses successfully (`video-processor.web.js:922`).
- **A 1 Hz `setInterval` watchdog** (`compositeWatchdogTimer`, new module-level handle, cancelled in the same teardown) calls `resolveCompositeWatchdog`; on `'resume'` it re-issues `video.play()` and logs `[Speech] composite source stalled; resuming`. If that `play()` rejects it retries once with `video.muted = true` before logging `[Speech] composite resume failed` — the exact fallback `executeRenderLoop:861-867` uses. Every log string in this story is specified verbatim so the guards can assert on it.
- **Two counters**, from `createLivenessCounter()`. `framesDrawn` increments per successful `paintCompositeFrame`; `sourceAdvances` increments only when `video.currentTime` has actually increased.
- **`draw()` is exception-safe.** The single `ctx.drawImage(video, …)` call moves into `paintCompositeFrame`, which returns `false` instead of throwing when the source has no current data; the rAF loop keeps running regardless. Likewise `getContext('2d')` returning `null` degrades to a logged no-op instead of throwing inside the rAF callback.
- `draw()` derives its source rect from `compositeCropRect(...)`; a `null` rect skips the tick but leaves both the rAF loop and the watchdog running.
- The existing `[Speech] portrait-capture playback failed:` warning (`:114`) is kept verbatim.

### Frozen-take detection at record time

`startDeferredSpeechCamRecording()` creates a reporter whose sinks are the real ones — `console.error`, `trackEvent`, and `setSystemMessage({ type: 'media-error', text: Strings.get('error_camera_frozen', getAppLanguage()) })` — calls `start()`, and ticks it from a 1 Hz `setInterval`. `stopSpeechCamRecording` calls `reset()` on **both** the active and the inactive path. On the first freeze in a take, in this order:

1. `console.error('[Recording] take produced no camera frames — the clip will be frozen', { framesDrawn, sourceAdvances, elapsedMs })`
2. `trackEvent('camera_frozen', { lessonId, stepIndex, responseType, elapsedMs })`
3. `appStore.getState().setSystemMessage({ type: 'media-error', text: Strings.get('error_camera_frozen', getAppLanguage()) })`

`type: 'media-error'` is the existing non-blocking banner already used by `onMediaError` (`step-executor-webonly.js:287-299`); it does not interrupt the take, so a learner mid-answer can still finish and simply re-record. All three fire **once per take**, never repeatedly.

The new string, specified verbatim so the implementer does not invent copy (`src/data/strings.js`, all six locales required by `strings.test.js`):

```js
'error_camera_frozen': {
    en: "Your video stopped updating. If this looks frozen, record your answer again.",
    es: "Tu vídeo dejó de actualizarse. Si aparece congelado, graba tu respuesta de nuevo.",
    pt: "Seu vídeo parou de atualizar. Se aparecer congelado, grave sua resposta novamente.",
    fr: "Votre vidéo ne se met plus à jour. Si elle semble figée, enregistrez à nouveau votre réponse.",
    hi: "आपका वीडियो अब अपडेट नहीं हो रहा है। अगर यह फ्रीज़ दिखे, तो अपना जवाब दोबारा रिकॉर्ड करें।",
    bn: "আপনার ভিডিও আর আপডেট হচ্ছে না। এটি ফ্রিজ দেখালে আপনার উত্তর আবার রেকর্ড করুন।"
},
```

### The recap is 9:16 by construction, not by inheritance

New `resolveRecapDimensions({ videoWidth, videoHeight })` in `video-processor-logic.js`:

```
h0 = (Number.isFinite(videoHeight) && videoHeight > 0) ? videoHeight : 1920
h  = max(1080, round(h0 / 2) * 2)          // even, never below the 1080 floor
w  = round(h * 9 / 16 / 2) * 2             // even, exact 9:16
→ { width: w, height: h }
```

Both call sites switch to it: the recap canvas (`:263-268`) and the per-segment fallback clip canvas (`:1557-1559`). Worked cases:

| probed | today | after |
|---|---|---|
| `1080×1920` (desktop composite) | `1080×1920` | `1080×1920` |
| `720×1280` (Android composite) | `720×1280` | `720×1280` |
| `0×0` (metadata never arrived) | `1080×1920` | `1080×1920` |
| `1280×720` (landscape source) | `1920×1080` **landscape** | `608×1080` **portrait** |

The `max(h, 1080)` floor is unchanged, so the Android recap stays at `720×1280` and **no new encoder load is introduced on the device that OOM'd before** (`docs/learnings.md:158`). A `console.log('[VideoProcessor] recap dimensions:', { videoWidth, videoHeight, width, height })` records the probe so the reported aspect ratio can be confirmed or dismissed from a log.

## Tasks

### Task 1 - Extract the composite rules into a pure, tested module

Create `src/modules/speech/portrait-capture-logic.js` exporting `COMPOSITE_STALL_MS`, `COMPOSITE_FROZEN_MS`, `COMPOSITE_WATCHDOG_MS`, `resolveCompositeDimensions`, `compositeCropRect`, `paintCompositeFrame`, `createLivenessCounter`, `resolveCompositeWatchdog`, `shouldForceReleaseComposite`, `isTakeFrozen` and `createFreezeReporter` exactly as specified above, and `src/modules/speech/portrait-capture-logic.test.js` covering every rule.

- `resolveCompositeDimensions({ isAndroid: true })`
  - → `{ width: 720, height: 1280, fps: 24 }`
  - → `{ width: 720, height: 1280, fps: 24 }` twice (deterministic, no shared mutable default)
- `resolveCompositeDimensions({ isAndroid: false })`
  - → `{ width: 1080, height: 1920, fps: 30 }`
- `compositeCropRect` with a landscape `1280×720` source into a `1080×1920` canvas
  - → `{ sx, sy, sw, sh }` where `sh === 720`, `sw === 405`, `sx === 437.5`, `sy === 0`
  - → the source rect is centred horizontally (`sx + sw / 2 === 640`)
- `compositeCropRect` with a portrait `720×1280` source into a `1080×1920` canvas
  - → `{ sw: 720, sh: 1280, sx: 0, sy: 0 }` (already 9:16, no crop)
- `compositeCropRect` with a taller-than-9:16 `600×1600` source into a `1080×1920` canvas
  - → `sw === 600`, `sh === 600 / (1080 / 1920)` and `sy === (1600 - sh) / 2`, `sx === 0`
- `compositeCropRect` with `videoWidth: 0` / `videoHeight: 0` / `NaN` / `canvasWidth: 0`
  - → `null`
- `paintCompositeFrame` with a `ctx` whose `drawImage` is a spy and a real rect
  - → returns `true` and the spy is called with `(video, sx, sy, sw, sh, 0, 0, 1080, 1920)`
- `paintCompositeFrame` with `rect: null`
  - → returns `false`, the spy is not called, and nothing is thrown
- `paintCompositeFrame` with a `ctx` whose `drawImage` throws
  - → returns `false` and does **not** rethrow (a `throw` escaping the rAF callback kills the repaint loop and reproduces the reported symptom silently)
- `createLivenessCounter()`
  - → `snapshot()` returns `{ framesDrawn: 0, sourceAdvances: 0 }` on a fresh counter
  - → `recordPaint()` three times then `snapshot()` → `framesDrawn === 3`
  - → `reset()` then `snapshot()` → both counts back to `0`
  - → two independent counters do not share state
- `resolveCompositeWatchdog` before any metadata has arrived (`hasEverHadMetadata: false`)
  - → `'wait'`, even when `paused: true`
- `resolveCompositeWatchdog` with `hasEverHadMetadata: true, paused: true, ended: false, readyState: 4`
  - → `'resume'`
- `resolveCompositeWatchdog` with `paused: true, ended: true`
  - → `'idle'` (the clip genuinely finished; never resume an ended source)
- `resolveCompositeWatchdog` with `paused: false` and `lastSourceAdvanceAtMs` exactly `COMPOSITE_STALL_MS` old
  - → `'resume'` (the boundary is inclusive)
- `resolveCompositeWatchdog` with `lastSourceAdvanceAtMs` one millisecond short of the threshold
  - → `'idle'`
- `resolveCompositeWatchdog` with `lastSourceAdvanceAtMs: null` (never advanced) and `hasEverHadMetadata: true, readyState: 4, paused: false`
  - → `'idle'`
- `resolveCompositeWatchdog` with `hasEverHadMetadata: true, readyState: 1`
  - → `'resume'` (the source lost its decoder)
- `resolveCompositeWatchdog` with a live source (`paused: false, readyState: 4, lastSourceAdvanceAtMs: nowMs`)
  - → `'idle'`
- `shouldForceReleaseComposite({ isAndroid: true, keepStreamAlive: true, recordingStarted: true })`
  - → `true` (the OOM case from `docs/learnings.md:158` is preserved)
- `shouldForceReleaseComposite({ isAndroid: true, keepStreamAlive: true, recordingStarted: false })`
  - → `false` (the Whisper-not-ready abort keeps the composite — the first-response fix)
- `shouldForceReleaseComposite({ isAndroid: true, keepStreamAlive: false, recordingStarted: false })`
  - → `true`
- `shouldForceReleaseComposite({ isAndroid: false, keepStreamAlive: true, recordingStarted: true })`
  - → `false`
- `shouldForceReleaseComposite({ isAndroid: false, keepStreamAlive: false, recordingStarted: false })`
  - → `true`
- `isTakeFrozen` with both counters unchanged and `nowMs - recordingStartedAtMs >= COMPOSITE_FROZEN_MS`
  - → `true`
- `isTakeFrozen` with both counters unchanged one millisecond short of the threshold
  - → `false`
- `isTakeFrozen` with `framesDrawn` advanced but `sourceAdvances` unchanged past the threshold
  - → `false` (the repaint loop is alive; a still camera is not a dead pipeline)
- `isTakeFrozen` with `sourceAdvances` advanced but `framesDrawn` unchanged past the threshold
  - → `false`
- `isTakeFrozen` with `framesDrawn: 0` and `sourceAdvances: 0` and `recordingStartedAtMs: null`
  - → `false` (no take in progress)
- importing `portrait-capture-logic.js` touches no browser global
  - → `window`, `document` and `navigator` are not referenced anywhere in its source (guard reads raw source, no comment stripping)

### Task 2 - Make the composite self-healing instead of silently static

Rewrite `createPortraitCaptureStream` in `src/modules/speech/speech.web.js` to drive an rAF loop with a 1 Hz watchdog, using the Task 1 rules, and extend `portrait-capture-guards.test.js`.

Two of the six existing guards in that file assert on source this story moves, so they must be **rewritten, not deleted** — their replacement has to be at least as strong:

| existing guard | disposition |
|---|---|
| `gates the composite on a device check that excludes iOS only` | unchanged, must still pass |
| `asks the camera for a plain 16:9 source (the composite does the cropping)` | unchanged, must still pass |
| `only applies the composite when the device check passes` | unchanged, must still pass |
| `tears the composite down alongside the camera stream` | unchanged, must still pass |
| `builds a 9:16 canvas stream, centre-cropping the camera` | **rewritten** — its three `canvasW`/`canvasH`/`captureFps` assertions become Task 1's behavioural test of `resolveCompositeDimensions`, and its `ctx.drawImage(video,` assertion becomes Task 1's `paintCompositeFrame` test. `canvas.captureStream(captureFps)` becomes `canvas.captureStream(dimensions.fps)`, and the `rawStream.getAudioTracks()` assertion stays a source guard here. |
| `releases the composite on phones when recording stops (free it before transcription)` | **rewritten** — its two literal `if (!keepStreamAlive \|\| isAndroid) { … }` string matches become a count of exactly **2** `shouldForceReleaseComposite(` call sites plus the index-order check below. Same coverage intent (both stop paths), new rule. |

- `speech.web.js` source inspected → `createPortraitCaptureStream` body, sliced with the file's existing `functionBody` helper
  - → contains `resolveCompositeDimensions(` and `compositeCropRect(`
  - → contains `canvas.captureStream(dimensions.fps)`
  - → contains `requestAnimationFrame(` and does **not** contain `setInterval(draw`
  - → contains `resolveCompositeWatchdog(` and `video.play()` inside the watchdog branch
  - → contains `createLivenessCounter(` and `recordSourceAdvance(`, and `compositeCropRect(` is called **before** the `paintCompositeFrame(` that uses its result (assert index order, not presence)
  - → contains `rawStream.getAudioTracks()` (the audio passthrough that made the audio survive must not be lost)
- `teardownPortraitCapture` body, sliced at the next top-level declaration
  - → cancels **both** the rAF handle and the watchdog handle (`cancelAnimationFrame` and `clearInterval`), each guarded by its own null check
  - → still pauses, nulls `srcObject` and removes `compositeVideoEl`
  - → still stops every `compositeRawStream` track in a `try/catch`
- `stopSpeechCamRecording` body, sliced with `functionBody`
  - → both release sites call `safelyStopStream()` through `shouldForceReleaseComposite(` instead of the literal `if (!keepStreamAlive || isAndroid)`, and the count of those call sites is exactly **2** (presence is not containment — assert the count, per the existing `release.length` test it replaces)
  - → the `recordingStarted` argument is `speechCamRecorder.state === 'inactive'` evaluated before `speechCamRecorder = null`, asserted by index order against the assignment
- the watchdog resume ladder
  - → the `createPortraitCaptureStream` slice contains `video.play().catch(` at least **twice** (the initial start and the watchdog resume)
  - → inside that slice `video.play()` appears **before** `video.muted = true`, and both appear **before** `console.warn('[Speech] composite resume failed'`, asserted by index order — three bare `toContain` calls would pass on a ladder that never runs
  - → the watchdog branch calls `resolveCompositeWatchdog(` before any `video.play()`, asserted by index order
- the repaint tick cannot be killed by a throw
  - → the `createPortraitCaptureStream` slice contains **no** `try` block at all (`expect(body).not.toMatch(/try\s*\{/)`), so nothing can prevent the final `requestAnimationFrame(` from re-scheduling; the swallowing lives in `paintCompositeFrame`, proven behaviourally in Task 1
  - → `paintCompositeFrame(` is called and its index is **before** the last `requestAnimationFrame(`
  - → `resolveCompositeWatchdog(` and `COMPOSITE_WATCHDOG_MS` are both present
- the liveness counters
  - → `createLivenessCounter(` is called in `createPortraitCaptureStream`, and its `snapshot()` is passed to `createFreezeReporter(`
  - → `reset()` is called in `teardownPortraitCapture`

### Task 3 - Warn once when a take really is frozen

Add `createFreezeReporter` to `portrait-capture-logic.js` and unit-test it with injected spies; wire it into `startDeferredSpeechCamRecording` / `stopSpeechCamRecording` in `speech.web.js`; add the `error_camera_frozen` string.

- a reporter started, then ticked after `COMPOSITE_FROZEN_MS` with the counters unchanged
  - → the first `tick()` returns `true`
  - → `onConsoleError` is called exactly once with a message starting `[Recording] take produced no camera frames` and a detail object carrying `framesDrawn`, `sourceAdvances` and `elapsedMs`
  - → `onTrackEvent` is called exactly once with `'camera_frozen'` and properties carrying `lessonId`, `stepIndex`, `responseType` and `elapsedMs` (the values `getMeta()` returns)
  - → `onUserMessage` is called exactly once with `getMessage()`'s value
- the same reporter ticked **three more times** after reporting
  - → every later `tick()` returns `false` and none of the three sinks is called again
  - → `didReport()` is `true`
- a reporter whose counters advance each tick
  - → no sink is ever called and `didReport()` stays `false`
- a reporter whose counters advance for long enough and then stop
  - → it still reports exactly once, at the point the stall passes `COMPOSITE_FROZEN_MS`
- `tick()` **before** `start()`
  - → returns `false`, no sink is called
- `reset()` then more ticks
  - → nothing fires again, and `didReport()` is `false`
- `start()` after a `reset()`
  - → reports again for the new take (a second answer in the same lesson is a separate take)
- `error_camera_frozen` exists in `src/data/strings.js`
  - → carries a non-empty value for `en`, `es`, `pt`, `fr` and `bn`
  - → the `hi` value matches Devanagari and the `bn` value matches Bengali script — asserted on the **raw `strings` table**, never via `Strings.get()`, which falls back to English and would pass with the key deleted (the trap recorded in `AGENTS.md`)
  - → the whole `strings.js` `strings.test.js` suite stays green (every key needs all six locales)
- `speech.web.js` source inspected
  - → `startDeferredSpeechCamRecording` body, sliced, contains `createFreezeReporter(` and `start()`
  - → `stopSpeechCamRecording` body, sliced, calls the reporter's `reset()` on **both** the recorder-active and the inactive path, and the count of those `reset()` call sites is exactly **2**
  - → the reporter's sinks reference `trackEvent`, `setSystemMessage` and `'error_camera_frozen'`, so the wiring is pinned and not just the policy

### Task 4 - Size the recap and the published clips from 9:16, not from the first take

Add `resolveRecapDimensions` to `src/modules/video/video-processor-logic.js`, switch both `getTargetDimensions` call sites in `video-processor.web.js` to it, and log the probe.

- `resolveRecapDimensions({ videoWidth: 1080, videoHeight: 1920 })`
  - → `{ width: 1080, height: 1920 }`
- `resolveRecapDimensions({ videoWidth: 720, videoHeight: 1280 })` (the Android composite — must not change)
  - → `{ width: 720, height: 1280 }`
- `resolveRecapDimensions({ videoWidth: 1280, videoHeight: 720 })` (a landscape source)
  - → `{ width: 608, height: 1080 }` — portrait, not `1920×1080`
- `resolveRecapDimensions({ videoWidth: 640, videoHeight: 480 })` (4:3)
  - → `{ width: 608, height: 1080 }`
- `resolveRecapDimensions({ videoWidth: 0, videoHeight: 0 })` and `{ videoWidth: NaN, videoHeight: undefined }`
  - → `{ width: 1080, height: 1920 }`
- `resolveRecapDimensions` for any probe
  - → `width` and `height` are both even integers
  - → `Math.abs(width / height - 9 / 16) < 0.01`
- `resolveRecapDimensions` never returns a height below 1080
  - → a `320×240` probe yields `height === 1080`
- `video-processor.web.js` source inspected → the recap-dimensions region
  - → calls `resolveRecapDimensions(` and no longer calls `getTargetDimensions(` inside the `planner.getTargetDimensions(` expression at the recap canvas
  - → the per-segment fallback path calls `resolveRecapDimensions(` too
  - → contains a `[VideoProcessor] recap dimensions:` log
- `VideoRenderPlanner.getTargetDimensions` itself
  - → unchanged — its existing contract and any behaviour outside the two recap call sites is not touched

### Task 5 - Record the diagnosis

- `docs/learnings.md`
  - → gains an entry stating the governing rule (Chrome emits a canvas `captureStream` frame only when the canvas changes), that the symptom "video frozen, audio perfect" uniquely identifies the composite because the audio track bypasses it, and that the first `friendClosedResponse` is uniquely exposed because the Whisper-not-ready abort used to destroy the composite on Android
  - → names `shouldForceReleaseComposite` as the rule that keeps the Android release for real takes while exempting the never-started abort, so the OOM fix in the same file is not undone
  - → points at `resolveCompositeWatchdog` for the resume logic and `isTakeFrozen` for the field diagnosis, and warns that the precise browser-internal trigger (stalled source `<video>` vs. encoder/canvas memory pressure under a resident Whisper model) was **not** isolated — the fix covers both and the instrumentation is what makes the next occurrence diagnosable
- `docs/product.md` `## Features`
  - → gains one entry describing the self-healing composite and the 9:16 recap sizing, linked to `stories/072-fix-frozen-speech-capture/story.md`

## Technical Context

No new dependencies. Versions in use, unchanged by this story:

- `vitest ^4.1.6` — `environment: 'jsdom'`, `globals: true`; `vitest.config.js` excludes `tests/**/*.spec.js`, so Playwright specs and vitest unit tests never collide.
- `@playwright/test ^1.60.0` — not used by this story. `playwright.config.js` `testIgnore`s `e2e-smoke`, `recording-persistence`, `success-screen` and `whisper-review`, and none of the remaining specs drive the speech composite, so there is no E2E gap to fill here. `speech.web.js` reads `navigator.platform` and `HTMLCanvasElement.prototype.captureStream` at module load and cannot be imported in jsdom, which is why every rule that decides behaviour lives in the injectable pure module and only the wiring is asserted by source guards — the established pattern for this file (see the header of the existing `portrait-capture-guards.test.js`).

Browser APIs relied on, all already used by this repo:

- `HTMLCanvasElement.captureStream(fps)` — `speech.web.js:147`, `video-processor.web.js:292`
- `MediaStreamTrack` `currentTime` is a read-only `HTMLMediaElement` property; the composite tracks it off the hidden `<video>`, not the track.
- `requestAnimationFrame` — `video-processor.web.js:922`

## Notes

- **The composite is the confirmed cause; the browser-internal trigger is not isolated.** The frozen live preview plus intact audio pins the fault to the composite stream beyond reasonable doubt, but we cannot tell from the outside whether the source `<video>` stalled (autoplay/OS/compositor) or the canvas encoder stopped under memory pressure from the freshly-resident Whisper model. The watchdog, the resume ladder, `paintCompositeFrame`'s swallowing and the counters cover both, and `createFreezeReporter` is what turns the next occurrence from a silent bad upload into a log line and an in-app banner.

  The gap this story closes, side by side with the pipeline that demonstrably works:

  | | speech composite (`speech.web.js`) | recap loop (`video-processor.web.js`) |
  |---|---|---|
  | repaint scheduler | `setInterval` (`:144`) | `requestAnimationFrame` (`:922`) |
  | source paused by the OS | never checked | `video.paused` → `play()`, muted retry (`:856-868`) |
  | `play()` rejected | swallowed as one `console.warn` (`:114`) | retried |
  | metadata missing | `draw()` silently no-ops forever (`:119`) | `lastFrameCanvas` freeze-frame fallback (`:884-903`) |
  | stall detection | none | wall-clock stall cap (`:873-883`) |
- **Do not "fix" this by loosening the Android release rule.** `docs/learnings.md:158` records that a 1080×1920 canvas plus a software encode OOM'd low-memory Android devices while Whisper was resident. `shouldForceReleaseComposite` keeps that release for every take that actually recorded and exempts only the abort where nothing was ever encoded.
- **`setInterval` → `requestAnimationFrame` is a behaviour change under backgrounding.** rAF suspends in a hidden tab, so a take started and then backgrounded produces no frames. That is the same trade-off `executeRenderLoop` already makes (`stories/035-single-pass-clip-publish/story.md:11`), it cannot be avoided by any canvas-capture approach, and the 1 Hz watchdog re-establishes the loop when the tab is visible again. Keeping a plain timer as the repaint scheduler does not fix the bug — `setInterval` is clamped harder than rAF when a tab is backgrounded, not less.
- **`getContext('2d')` returning `null`** is handled as a logged no-op rather than a throw. Throwing from inside the rAF callback kills the loop for the rest of the session and reproduces the exact reported symptom with no console trace, so it must be guarded.
- The `error_camera_frozen` copy in all six locales was drafted for this story and should be reviewed by a native speaker before a public release; the Devanagari/Bengali script assertions only prove the right script is present, not that the wording is idiomatic.
- `resolveRecapDimensions` deliberately does **not** force 1080×1920. A fixed 1080×1920 recap would upscale the Android `720×1280` composite and reintroduce encoder pressure on the exact device class that OOM'd before.
- `getTargetDimensions` keeps its current behaviour and existing callers; only the two recap call sites move. It has no direct unit test today, which is why Task 4 asserts the new resolver's behaviour rather than the old method's.