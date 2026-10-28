# Recorder: live background replacement and the overlay rail

## Context

The operator studio (`public/recorder.html`) records the raw camera stream straight into `MediaRecorder`, and the take is uploaded to `raw/` and rendered by the pipeline. Background substitution happens **after** the fact, in Stage 2 (BiRefNet on Modal), so a matte that looks wrong cannot be seen until the render has already run and been published — and by then the only fix is another render. It is also a whole-frame 768×768 model on a moving talking head, so its edges are not meaningfully better than a live segmenter.

This story moves background replacement **into the take**: the camera is painted into a 9:16 composite canvas over a replacement background, segmented per frame, and the canvas' `captureStream` is what `MediaRecorder` records. The live preview is fed **the same `MediaStream` object** the recorder records, so what the operator sees cannot disagree with the file — the correction loop is "see it, reject the take, re-record", which the studio already supports (`global_pending_record_action`).

The same canvas already carries the app's look painters, so this story brings the **overlay rail** (Face / Top / Bottom / Emoji props from `OVERLAY_LIBRARY`, and emoji dragging) to the studio — overlays only, not filters, not lens effects, not screen effects.

Target: **Android, one device, one operator.** iOS is best-effort behind the same capability gate; a device that fails the gate records the raw stream and says so. A drifting or frozen take is never acceptable, so the composite carries the same frame-latency diagnostic and liveness watchdog the app's capture path already has.

## Out of Scope

- Filters, lens effects and procedural screen overlays in the studio. The rail shows props and emoji only; `paintLooks` is still called with those ids at `none`.
- Face tracking of any kind (090 stays parked).
- Deleting the offline BiRefNet stage or the `video-background-removal` Modal app. Stage 2 keeps its code; it simply stops being reached for a step that names a background.
- Video backgrounds. A replacement background is a still image.
- iOS-specific tuning. It works if the capability gate passes, otherwise the raw stream is recorded.

## Implementation approach

- **The page owns no pixel maths.** Every rule lives in `src/modules/looks/background-substitution-logic.js` (pure: no React, no DOM, no browser globals) and the browser adapter beside it. The built module is loaded by the page and exposes one entry point; the page only wires it to `MediaRecorder`, the preview and the rail. This is what makes the studio testable in jsdom (which has no canvas 2D context).
- **The composite is 9:16, at the phone size the app already uses.** `resolveCompositeDimensions({ isAndroid: true })` gives 720×1280 @ 24. This is deliberate and it reverses the "keep the camera's native aspect" instinct: every anchor the overlay system has is a fraction of a 9:16 frame (`SLOT_ANCHORS` face 0.42 / upper 0.22 / lower 0.74, `CLOSE_UP_HOLE`), so a landscape canvas would place props where the app never tested them. 720×1280 is also **less than half** the paint of today's 1920×1080 capture, which is the budget that buys A/V sync. The camera is still requested at 1920×1080 and centre-cropped in with `compositeCropRect`.
- **One stream, two consumers.** `new MediaStream([...canvas.captureStream(24).getVideoTracks(), ...rawStream.getAudioTracks()])` is assigned to the preview's `srcObject` **and** handed to `MediaRecorder`. The audio track is the camera's own (48 kHz mono, echoCancellation off) — untouched.
- **Segmentation** is MediaPipe `ImageSegmenter` (`@mediapipe/tasks-vision`) running `selfie_segmenter_landscape.tflite` on the GPU delegate, CPU as the fallback. The WASM fileset and the model are **vendored under `public/mediapipe/`** by a repeatable script, not fetched from a CDN: a take must never fail because jsdelivr was blocked.
  - Inference runs on a **reduced clock** (`SEGMENT_INTERVAL_MS`, ~15 Hz) and reuses the last mask between inferences, so the paint loop is not gated on the model.
  - The mask is feathered by drawing it into a 1/12 scratch and back (the same downscale/upscale trick as `paintSoftFocus` — never `ctx.filter`, which is a silent no-op in iOS WebKit), and **temporally blended** (`0.6 × new + 0.4 × previous`) so the edge does not crawl.
- **Draw order**: replacement background → camera through the mask → `paintLooks` (grade/lens/screen all `none`) → props → emoji. Segmentation therefore slots in *under* the look painters, which are unchanged.
- **The `background` column is the switch, on both sides.** The studio already parses every master-CSV column into `global_script_phrases`, so the current row's `background` value needs no new fetch. The value names a still image bundled at `public/overlays/backgrounds/<name>.png`; the studio composites it. On the pipeline side a non-empty `background` value now means **already baked at capture**, so Stage 2 copies the clip through instead of calling BiRefNet. `background` is already in the source-bridge's carried column list (`scripts/lib/source-bridge-utils.js`), so authoring it in `sources/<course>.source.txt` reaches the master CSV with no change.
  - Every committed master CSV has an **empty** `background` column today, so this re-interpretation breaks no existing step.
  - Because "value set" now means "baked", the studio must not be able to lie: if the row names a background it cannot resolve to a bundled image, the take refuses to start and says why. That guard lives in the page and is the only thing keeping the pipeline rule honest.
- **The preview and the take must both be enlargeable**, because a half-width pane on a phone hides exactly the soft edge this feature is for. In review (≤768 px) the page already hides the preview and gives the take the full row, but the 9:16 shield then overflows the viewport and the live pane has no enlargement at all. One toggle expands the active pane (live while recording, take while reviewing) into a fitted box with `object-fit: contain`.

## Tasks

### Task 1 - Substitution rules (pure module)

- `resolveSubstitutionDimensions({ isAndroid: true })` + called in unit test
  - → `{ width: 720, height: 1280, fps: 24 }`, and never larger than the camera's own frame
- `shouldRunInference({ lastInferenceAtMs, nowMs, intervalMs })` + called in unit test
  - → `false` before the interval elapses, `true` at and after it, `true` when no inference has run yet
- `blendMaskAlpha({ next, previous, weight })` + called in unit test
  - → a weighted blend per pixel, `previous` used verbatim when `weight` is 1 and ignored when 0, and clamped to 0…1
- `invertAlpha` / `clampAlpha` + called in unit test
  - → `1 - a` per pixel and clamping of out-of-range input, never throwing on an empty array
- `resolveBackgroundSource('studio.png')`, `('')`, `('none')`, `('skip')`, `('../x.png')` + called in unit test
  - → `/overlays/backgrounds/studio.png` for a plain name; `null` for empty, `none` and `skip`; `null` for a name with a path separator or `..` (the value comes from a sheet and is never trusted as a path)
- `resolveBackgroundState({ sheetValue, imageLoaded })` + called in unit test
  - → `'none'` when the row names nothing, `'ready'` when it names a resolved loaded image, and `'missing'` when it names one that did not load
- `shouldStartTake({ backgroundState })` + called in unit test
  - → `false` for `'missing'` (the pipeline will skip BiRefNet for that row, so a take without the background would silently lose it), `true` for `'none'` and `'ready'`
- `resolveExpandablePane({ isReviewing })` + called in unit test
  - → `'playback'` while reviewing, `'preview'` otherwise
- `overlaySelectionFor({ face, upper, lower, emoji })` + called in unit test
  - → a selection with every non-overlay id at `none`, so `paintLooks` paints no grade, lens or screen
  - → unknown slugs are dropped by the existing `sanitizeSelection`

### Task 2 - The segmentation adapter (browser)

- `loadSegmenter({ filesetPath, modelPath, delegate })` + called in unit test with an injected `ImageSegmenter` factory
  - → returns a segmenter handle; a factory that throws returns `null` (never a rejected promise the caller can forget)
  - → a GPU delegate that throws is retried once on `'CPU'`, and a CPU failure returns `null`
- `segmentAlpha(handle, video)` + called in unit test with an injected fake handle
  - → returns a `Float32Array`/`Uint8ClampedArray` alpha mask of the model's output size and forces `outputCategoryMask` off (`confidenceMasks` on)
  - → a throwing handle returns `null` and the caller keeps the previous mask
- `src/modules/looks/segmentation.web.js` source + called in unit test (source guard)
  - → imports `@mediapipe/tasks-vision` and never references `ctx.filter`
  - → contains no reference to `/recorder` or `recorder.html` (the hidden-page guard scans `src/**`)

### Task 3 - The capture composite (browser adapter)

- `createSubstitutedCaptureStream({ rawStream, canvas, options })` + called in unit test with an injected 2D context and fake canvas
  - → returns a `MediaStream` whose video track comes from `canvas.captureStream(fps)` and whose audio track is the raw stream's own track object
  - → paints the background **before** the camera and the camera **before** any look painter (asserted via a recorded call order on the injected context)
  - → with no segmenter (capability gate failed) the camera is painted unmasked and the returned stream is still the canvas stream, so the take's shape does not change
- `createSubstitutedCaptureStream` frame scheduling + called in unit test
  - → paints once per camera frame when `requestVideoFrameCallback` exists, and once per `requestAnimationFrame` when it does not
- `substitutionStats()` / the `composite lag` diagnostic + called in unit test
  - → records the painted-frame and source-advance counts, and a frozen take (no paint and no source advance for `COMPOSITE_FROZEN_MS`) reports once, reusing `isTakeFrozen`
- `dispose()` + called in unit test
  - → cancels the paint loop, stops the canvas tracks, releases the segmenter, and detaches the hidden `<video>` — every step idempotent

### Task 4 - The page records the composited stream

- `public/recorder.html` source + called in unit test (source guard)
  - → `MediaRecorder` receives the stream returned by the capture entry point, not `global_stream_handle`
  - → `node_video_preview.srcObject` is assigned **that same object** (the WYSIWYG invariant: one stream, two consumers)
  - → every path that cannot build the composite falls back to `global_stream_handle` and logs `[Composite]` rather than throwing
- Booted page with an injected capture entry point + called in unit test (jsdom, faked media stack)
  - → the fake's stream is what `MediaRecorder` was constructed with, and the preview's `srcObject` is that stream
  - → with no capture entry point on `window`, `MediaRecorder` is constructed with the raw camera stream (dev and jsdom keep working)
- Booted page with a row whose `background` names a missing image + called in unit test
  - → `startPreRollSequence()` does not reach `new MediaRecorder`, and the status bar names the unresolved background
- Booted page, recording through the composite + called in unit test
  - → a `stop()` still produces a blob, and accept/reject still route through `global_pending_record_action` unchanged

### Task 5 - The overlay rail

- `public/recorder.html` source + called in unit test (source guard)
  - → the rail is built from `OVERLAY_LIBRARY` / `overlaySlugsForSlot` and never from a hardcoded slug list
  - → it renders no filter, lens or screen control
- Booted page, tapping a prop in the Face slot then a second prop + called in unit test
  - → the entry point receives `{ slot: 'face', slug }` for the first tap and the second slug replaces it (one per slot)
- Booted page, tapping the applied prop again + called in unit test
  - → the entry point receives `null` for that slot
- Emoji drag on the preview + called in unit test
  - → `computeDragOffset` is used for the delta (no hand-rolled arithmetic in the page), and the result goes through `sanitizeTuning` before it is sent
- Overlay artwork + called in unit test
  - → every slug the rail offers resolves to a file that exists under `public/overlays/` (walked from the library, so a new slug cannot ship a broken image)

### Task 6 - Enlarging the pane

- Booted page, no take yet + called in unit test
  - → the expand control expands the **preview** box; after a take it expands the **playback** box (`resolveExpandablePane`)
- Expanded pane stylesheet + called in unit test (scoped source guard)
  - → the expanded box is `position: fixed` with `inset: 0` and its video is `object-fit: contain`, so a 9:16 pane never overflows the viewport
  - → the expand control is not inside the video box in a way that the expanded `object-fit: contain` letterboxes away

### Task 7 - Stage 2 stops re-processing a baked take

- `run_background_removal` with `background = 'studio.png'` + called in Python test
  - → copies the silence-removed clip to `_no_silence_bg_removed.mp4` and never calls `process_video_background`
- `run_background_removal` with `background = ''`, `'none'`, `'skip'` + called in Python test
  - → still copies through, exactly as today
- `background_removal_remote()` / `background_removal_app.py` + called in Python test (source guard)
  - → both still exist and are unreferenced by this rule (deleting the offline stage is out of scope, and a re-enable must not need a rewrite)
- `scripts/lib/source-bridge-utils.js` + called in unit test
  - → `background` is in the carried master-header columns, so a value authored in `sources/<course>.source.txt` survives `generate-master-csv`

### Task 8 - Build: one module, two consumers

- `vite.config.js` + called in unit test (source guard)
  - → declares a second rollup input for the standalone looks entry and emits it at the **stable** path `recorder-looks.js` (no content hash — the static page cannot know one)
  - → the main entry's `assets/main-[hash].js` naming is unchanged (the deploy-time CDN grep depends on it)
- `scripts/verify-build-artifact.mjs` + called in unit test
  - → fails the build when `dist/recorder-looks.js` is missing, and still fails when `dist/assets/main-*.js` lacks the absolute CDN base
- `src/modules/video/recorder-page.test.js` + called in unit test
  - → the studio page stays unlinked from `src/**` and `index.html`, and every path this story touches is in the story allowlist

### Task 9 - Vendored model assets

- `scripts/sync-mediapipe-assets.mjs` + called in unit test
  - → copies the WASM fileset and the segmenter model from `node_modules/@mediapipe/tasks-vision/wasm` and the model URL into `public/mediapipe/`, and is a no-op (exit 0, no write) when they are already current
- `public/mediapipe/` + inspected in the built/served tree
  - → contains the wasm loader and the `.tflite` model, and the page loads them from `/mediapipe/` (never from a CDN)
