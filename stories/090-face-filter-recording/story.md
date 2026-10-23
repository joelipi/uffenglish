# Privacy filters baked into recorded takes

## Context

Learners who are self-conscious about their appearance or their background hesitate to record. The ask: at every step where the user records video (including the friend-closed-response step), offer lightweight privacy filters the user sees applied in real time, record the take with the filter baked into the blob, and continue the existing pipeline (trim → concatenate → publish) exactly unchanged.

This must work on Android, iOS, and Windows, and it must not regress the low-memory Android OOM history: a 1080p composite canvas + software MediaRecorder encode while the Whisper model was resident OOM'd low-end phones, which is why phones now record at 720×1280 @ 24fps and the capture is released before transcription runs. There is no server-side fallback of any kind — the only fallback is per-device auto-degrade. A feature that only works on Android is a non-starter.

Feasibility was verified before writing this story: the recording path already composites through a `canvas.captureStream()` canvas on Android/desktop, Jeeliz FaceFilter is Apache-2.0 with a 250KB lightest model and Canvas2D-only usage, and the one open risk (recording a live filtered canvas on iOS Safari, whose live path deliberately stays raw today) is gated as a physical-device spike below.

## Out of Scope

- Blur-background-keep-face-sharp (true portrait segmentation). Jeeliz is face-tracking only and has no segmentation model; that needs a second neural net per frame and directly conflicts with the crash budget.
- A sticker picker. V1 ships one single fixed cover image; the picker comes only after the memory budget is proven.
- Beauty / face-mesh / Three.js 3D effects. V1 is Canvas2D paint ops driven by the face box — no 3D engine in the recording path.
- Any server-side composite or re-render fallback. Not permitted for this feature.
- Changes to camera-off mode or to configs / courses.

## Implementation approach

- Render into the existing portrait-composite canvas (`createPortraitCaptureStream` in `src/modules/speech/speech.web.js`) instead of adding a new capture path. Draw order per frame is fixed: camera frame → effect → the already-running `captureStream` feeds the preview and the `MediaRecorder`, so the blob carries the filter with zero downstream changes.
- Track with the Jeeliz FaceFilter ES module build, bundling `NN_VERYLIGHT_1` as data (`NNC`, never a runtime `NNCPath` fetch at recording start), single face (`maxFacesDetected: 1`). Consume only the face box (`detected`, `x`, `y`, `s`); below the detection threshold the frame is drawn unmodified (fail-open to a natural frame).
- Four effects, all 2D: `natural` (no-op) / `soft-focus` (full-canvas blur filter, needs no tracking at all) / `blur-face` (blur or pixelate the face rect) / `cover-face` (one fixed PNG drawn cover-fill over the face rect).
- Memory budget, all enforced by tests: phone canvas stays 720×1280 @ 24fps (existing `resolveCompositeDimensions` rule is extended, not replaced); tracker inits lazily only after the camera grant; `JeelizResizer` sizing; `toggle_slow` whenever recording is not active; `destroy()` on every stop/release path; the tracker is never alive across the Whisper decode window (release-before-transcribe order is preserved); `GLCONTEXT_LOST` / `GL_INCOMPATIBLE` / `WEBCAM_UNAVAILABLE` all route to the degrade path.
- Degrade rule: any unsupported or failing filter path (low fps floor, lost GL context, no canvas-record support) switches that take to `natural`, shows a one-per-session message, and never fails or blocks the recording.
- Decision rules live in a pure module (`src/modules/filters/recording-filter-logic.js`, no React/DOM/browser globals); components stay render-only per the repo's logic/presentation split.

## Tasks

### Task 1 - Recording filter decision logic (pure module)

- known effect id + settled tracking state + resolve
  - → returns the matching effect descriptor
- unknown effect id + resolve
  - → returns the `natural` descriptor and does not throw
- face `detected` below threshold + frame render decision
  - → draws the camera frame unmodified
- fps below floor or GL context lost or canvas-record unsupported + recording active
  - → effect resolves to `natural` with the degrade flag set
- degrade flag already messaged this session + second degrade event
  - → no repeat message is emitted
- phone budget + resolve capture dimensions
  - → width is at most 720 and fps is at most 24

### Task 2 - Recording-path wiring guards

- composite canvas module source + inspect draw section
  - → the effect paint call sits between the camera-frame paint and the capture point (index-ordered assertion), and the recording path imports no `three` module
- tracker init source + inspect
  - → the NN model is provided as bundled data (`NNC`) with no `NNCPath` fetch at recording start, and init runs only after the `getUserMedia` grant (index-ordered assertion)
- stop and release paths + inspect
  - → every path calls the tracker `destroy`, and no tracker instance is alive across the Whisper decode window (index-ordered assertion on the release-before-transcribe sequence)
- GL context-lost handler + inspect
  - → routes to the degrade path, never to a throw or a stuck state

### Task 3 - Picker UI and desktop record spec

- filter chooser + opened on a recordable step
  - → lists exactly `natural`, `soft-focus`, `blur-face`, `cover-face`, and the cover uses the single fixed sticker asset
- desktop Chrome Playwright spec + record 5s with `blur-face`
  - → resulting blob is non-empty with playable duration and differs from the unfiltered frame pixels
- desktop Chrome Playwright spec + record 5s with `cover-face`
  - → resulting blob is non-empty with playable duration and the sticker pixels are present over the face rect
- desktop Chrome Playwright spec + WebGL blocked + record attempted
  - → recording still completes as a valid unfiltered blob and the degrade message appears exactly once
- effect names and degrade message + raw strings table
  - → every key carries all six locales (assert on the raw table, never on the fallback getter)

## Technical Context

- Jeeliz FaceFilter core: `dist/jeelizFaceFilter.module.js` (~111KB) + `neuralNets/NN_VERYLIGHT_1.json` (~250KB, gzip well); Apache-2.0, commercial use allowed with license copy retained. No Three.js/Babylon in v1 — Canvas2D `callbackTrack` demos (`faceTrack`) are the usage pattern. Documented scaling knobs: lighter NN, `JeelizResizer`, `scanSettings`, `toggle_slow`, `destroy()`. Error codes consumed: `GL_INCOMPATIBLE`, `WEBCAM_UNAVAILABLE`, `GLCONTEXT_LOST`. Requires HTTPS and a camera grant; NN fetch happens after the grant by default (we bundle it instead). Single-face tracking only.
- Current code: `src/modules/speech/speech.web.js` composites non-iOS cameras through a canvas (720×1280@24 on phones) and keeps iOS on the raw stream; `src/modules/video/video-processor.web.js` already records a canvas via `captureStream(30)` on iOS provided the canvas is in-DOM. iOS Safari records MediaRecorder output as mp4, Android/Windows as webm — the pipeline ingests both.
- Known platform caveats: WebKit bug 181663 (canvas stream piped to a `<video>` element), iOS 14.3+ camera requirement (full web env, which this app is), max ~16 GL contexts per page.

## Notes

- GO/NO-GO DEVICE GATE (manual, before any task above): on a physical iPhone, a low-end Android, and Windows Chrome, record a 5s clip per effect. Each must yield a non-empty playable blob with the effect visibly baked in; then force-degrade (e.g. block WebGL) and confirm the take still records unfiltered with the message shown once. If the iPhone cannot record a filtered canvas, stop — this story returns to planning, because no server fallback is permitted and iOS parity is required.
- The tracker, the MediaRecorder encode, and the Whisper decode must never be alive simultaneously; the existing release-before-transcribe order (`capture-release-logic.js`) wins every conflict.
- The sticker is one low-resolution PNG with mipmapping per Jeeliz guidance; when implemented it must be `git add`ed and added to the recorder-page allowlist like any new `public/` asset (prefer PNG, never committed mp4).
- Effect names and the degrade message need all six locales before the story is done.
