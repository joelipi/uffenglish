# Recorder: live 1080p30 background replacement and the overlay rail

## Context

The operator studio (`public/recorder.html`) records the raw camera stream straight into `MediaRecorder`, and the take is uploaded to `raw/` and rendered by the pipeline. Background substitution happens **after** the fact, in Stage 2 (BiRefNet on Modal), so a matte that looks wrong cannot be seen until the render has already run and been published — and by then the only fix is another render.

This story moves background replacement **into the take** at full **1080×1920 @ 30 fps** social-master quality: the camera is centre-cropped into a 9:16 1080×1920 composite canvas, segmented on every frame via a downscaled 256×256 input to MediaPipe `ImageSegmenter`, composited over the replacement background with edge feathering and light-wrap spill suppression in a WebGL2 shader, and the canvas' `captureStream(30)` is what `MediaRecorder` records. The live preview is fed **the same `MediaStream` object** the recorder records, so what the operator sees cannot disagree with the file — the correction loop is "see it, reject the take, re-record", which the studio already supports (`global_pending_record_action`).

The same composite also carries the app's **overlay rail** (Face / Top / Bottom / Emoji props from `OVERLAY_LIBRARY`, plus emoji dragging) — overlays only, not filters, not lens effects, not procedural screen effects — and draws a non-recorded CSS safe-zone guide over the preview pane showing where Stage 3's burned-in `<aside>` text card and the bottom 20% caption band will land.

Target: **Android, one device, one operator.** Unlike the learner app, the operator studio does not hold the Whisper model or `AudioWorklet` in memory, so it can sustain **1080×1920 @ 30 fps** without OOMing — keeping Stage 3's `output/social` video and `Html2Image` text overlays at native 1080p30 so TikTok and Instagram Reels never down-rank the upload as low-definition.

## Out of Scope

- Filters, lens effects and procedural screen overlays in the studio. The rail shows props and emoji only; `paintLooks` is still called with those ids at `none`.
- Face tracking of any kind (090 stays parked).
- Deleting the offline BiRefNet stage or the `video-background-removal` Modal app. Stage 2 keeps its code; it simply copies through for any row that names a background.
- Video backgrounds. A replacement background is a still image.
- iOS-specific tuning.

## Implementation approach

- **The page owns no pixel maths.** Every rule lives in `src/modules/looks/background-substitution-logic.js` (pure: no React, no DOM, no browser globals) and the browser adapter `src/modules/looks/background-substitution.web.js` beside it. The built bundle `/recorder-looks.js` is loaded by `public/recorder.html` via dynamic `import('/recorder-looks.js')` inside its inline script (preserving the self-contained HTML guard that forbids `<script src=...>` tags) and exposes `window.UFFLooks`.
- **Full 1080×1920 @ 30 fps geometry on every take.** `resolveSubstitutionDimensions()` returns `{ width: 1080, height: 1920, fps: 30, maskWidth: 256, maskHeight: 256 }`. Even when a row has no replacement background and no overlay is active, the studio still records through the 1080×1920 @ 30 fps composite canvas (unmasked) so every take in a step group shares identical 1080×1920 portrait dimensions for Stage 3's concatenation, and every `output/social` render stays 1080p30 for TikTok / Instagram Reels.
- **256×256 segmenter input at 30 Hz — never a 1080p CPU readback.** Passing the 1920×1080 `<video>` directly to MediaPipe `segmentForVideo` would produce a 2,073,600-float (8 MB) mask whose GPU→CPU readback stalls the main thread and causes A/V drift. Instead, the centre-cropped camera frame is drawn into a **256×256 scratch canvas** (`maskWidth: 256, maskHeight: 256` — 65,536 floats, matching the model's native tensor size) and passed to `segmentForVideo` on every painted camera frame (30 Hz). Temporal stabilization applies a light exponential blend (`0.85 × current + 0.15 × previous`) at 256×256 so standing-still hair/shoulder shimmer is suppressed without trailing lag when nodding or gesturing.
- **WebGL2 shader compositor with light-wrap spill suppression.** On the 1080×1920 output canvas, a WebGL2 fragment shader composites four textures in `< 0.5 ms` per frame:
  1. `u_bg`: the replacement background image (cover-cropped to 9:16).
  2. `u_video`: the centre-cropped 9:16 camera frame.
  3. `u_mask`: the 256×256 single-channel mask uploaded with `GL_LINEAR` hardware bilinear upscaling.
  4. `u_overlays`: a 1080×1920 2D canvas where `paintLooks` renders the selected Face / Top / Bottom / Emoji props (reupdated only when overlays or drag tuning change).
  The shader applies `smoothstep(0.35, 0.65, mask)` edge feathering plus **light-wrap spill suppression** (`resolveEdgeSpillMix`: along the semi-transparent rim `0.15 < alpha < 0.85`, 15% of `u_bg` colour is mixed into the person pixel so a bright room wall never leaves a white halo around dark hair or shoulders). When WebGL2 is unavailable (e.g. unit-test fakes), the adapter falls back to an offscreen `personCanvas` (`destination-in` mask on `personCanvas`, then `drawImage` over `u_bg` on the main canvas — never `destination-in` directly on the main canvas, which would erase the background).
- **One stream, two consumers.** `new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...rawStream.getAudioTracks()])` is assigned to `node_video_preview.srcObject` **and** handed to `MediaRecorder` at `15 Mbps` (`videoBitsPerSecond: 15000000`). The audio track is the camera's own (48 kHz mono, echoCancellation off) — untouched.
- **Stage 3 safe-zone guide on the live preview.** Because Stage 3 (`video_pipeline.py`) burns an HTML `<aside>` card (`top: 15%–74%, left: 2%–62%`) and the app player's captions occupy the bottom 20% (`80%–100%`), the studio renders a faint dashed CSS overlay over `.video-box:first-of-type` (outside the recorded canvas so it never enters the video) marking those two bands. The operator can immediately see if a dragged emoji or prop would be covered by Stage 3's text card.
- **The `background` column flows from `sources/<course>.source.txt` → `<course>.master.csv` → studio + Stage 2.**
  - `sourceToRows()` in `scripts/lib/source-bridge-utils.js` reads `topic.background ?? pair.background ?? source.background ?? ''` (and `source.intros?.background ?? source.background ?? ''` for intro rows) and emits it into the `background` column of every recordable take row (`filename` non-empty).
  - The studio already parses every master-CSV column into `global_script_phrases`. A non-empty `background` value names a bundled PNG at `public/overlays/backgrounds/<name>.png`. If the row names a background that fails to load or fails path validation, **the take refuses to start and says why** in the status bar.
  - In `docs/video-pipeline/video_pipeline.py`, `run_background_removal` treats any row in `background_mapping` as already baked at capture and copies the silence-removed clip through to `_no_silence_bg_removed.mp4` without calling `process_video_background`.
- **Workbox precache isolation.** `vite.config.js` adds `'recorder-looks.js'` and `'**/mediapipe/**'` to `WORKBOX_IGNORES` (alongside the existing `'**/overlays/**'` and `'recorder.html'`) so learners visiting the main app never precache operator-only segmentation or bundle files.
- **Enlargeable active pane.** One toggle expands the active pane (`resolveExpandablePane`: live preview while idle/recording, playback take while reviewing) into a fixed full-viewport overlay (`position: fixed; inset: 0; object-fit: contain`) so the operator can inspect 1080p matte edges at full screen width on the phone before accepting.

## Tasks

### Task 1 - Substitution rules (pure module)

- `resolveSubstitutionDimensions()` in `src/modules/looks/background-substitution-logic.js` + called in unit test
  - → returns `{ width: 1080, height: 1920, fps: 30, maskWidth: 256, maskHeight: 256 }` (social-grade 1080p30 output with a 256×256 segmentation input)
- `blendMaskAlpha({ next, previous, weight })` + called in unit test
  - → defaults `weight` to `0.85` (`0.85 × next + 0.15 × previous`), converts float confidence `[0..1]` into `Uint8Array` `[0..255]` in a single pass over the 256×256 buffer, uses `next` verbatim when `previous` is null or mismatched in length, and clamps out-of-range values
- `resolveEdgeSpillMix(alpha, spillStrength = 0.15)` + called in unit test
  - → returns `0` outside the rim (`alpha <= 0.15` or `alpha >= 0.85`), peaks at `spillStrength` at `alpha = 0.5`, so light-wrap colour spill only affects the semi-transparent border pixels
- `resolveBackgroundSource('studio.png')`, `('studio')`, `('')`, `('none')`, `('skip')`, `('../x.png')`, `('a/b.png')` + called in unit test
  - → `/overlays/backgrounds/studio.png` for `'studio.png'` or `'studio'` (appends `.png` when no extension is given); `null` for empty, `'none'` and `'skip'`; `null` for any value containing `/`, `\`, `..`, or non-filename characters
- `resolveBackgroundState({ sheetValue, imageLoaded, imageError })` + called in unit test
  - → `'none'` when `resolveBackgroundSource(sheetValue)` is `null`, `'ready'` when resolved and `imageLoaded` is `true`, `'error'` when `imageError` is `true` or `sheetValue` is invalid/rejected, and `'loading'` while the image is still decoding
- `shouldStartTake({ backgroundState })` + called in unit test
  - → `true` for `'none'` and `'ready'`, `false` for `'loading'` and `'error'` (preventing an uncomposited take on a row where Stage 2 will skip BiRefNet)
- `resolveExpandablePane({ isReviewing })` + called in unit test
  - → `'playback'` while reviewing, `'preview'` otherwise
- `overlaySelectionFor({ face, upper, lower, emoji })` + called in unit test
  - → returns a sanitized selection with `filterId: 'none'`, `lensId: 'none'`, `screenId: 'none'` and only valid overlay/twemoji slugs

### Task 2 - Source bridge carries `background` into `<course>.master.csv`

- `sourceToRows` in `scripts/lib/source-bridge-utils.js` with `background` set at course, pair, topic, or `intros` level + called in unit test
  - → emits the resolved `background` (`topic.background ?? pair.background ?? source.background ?? ''`) on every recordable take row (`filename` non-empty) and leaves non-take rows (`branching`, reuse rows with empty `filename`) with `background: ''`
  - → when no `background` key is present in `source`, emits `''` on every row (preserving byte-for-byte output on all existing `sources/*.source.txt` files)

### Task 3 - The segmentation adapter (browser)

- `loadSegmenter({ filesetPath, modelPath, createSegmenter })` in `src/modules/looks/segmentation.web.js` + called in unit test with an injected factory
  - → requests `delegate: 'GPU'`, `runningMode: 'VIDEO'`, `outputCategoryMask: false`, `outputConfidenceMasks: true`
  - → retries once with `delegate: 'CPU'` if GPU initialization throws, and returns `null` if both fail (never throwing an unhandled rejection)
- `segmentFrameToMask({ segmenter, maskInputCtx, video, cropRect, maskWidth, maskHeight, timestampMs, previousMask })` + called in unit test
  - → draws the cropped camera rect into `maskInputCtx` at `256×256` **before** calling `segmenter.segmentForVideo`, so the model never reads back a 1920×1080 buffer
  - → returns the temporally blended `Uint8Array(256 * 256)` alpha mask, or `previousMask` if the segmenter throws or returns no mask
- `src/modules/looks/segmentation.web.js` source + called in unit test (source guard)
  - → imports `@mediapipe/tasks-vision`, never references `ctx.filter`, and contains no reference to `/recorder` or `recorder.html`

### Task 4 - The 1080p30 WebGL2 / offscreen capture composite

- `createSubstitutedCaptureStream` in `src/modules/looks/background-substitution.web.js` + called in unit test with injected canvas/context fakes
  - → sizes the output canvas to `1080×1920` and calls `canvas.captureStream(30)`
  - → returns a `MediaStream` combining the canvas video track with `rawStream.getAudioTracks()`
  - → when a background image and mask are present on the 2D fallback path, composites the camera through an offscreen `personCanvas` (`destination-in` on `personCanvas`, then draws `personCanvas` over the background on the main canvas — never `destination-in` on the main canvas), and paints `paintLooks` overlays on top
  - → when WebGL2 is available, compiles the fragment shader containing `smoothstep` feathering and edge spill suppression (`u_bg`, `u_video`, `u_mask`, `u_overlays`)
  - → schedules paints via `requestVideoFrameCallback` when available and `requestAnimationFrame` otherwise, and `dispose()` stops the loop, closes the segmenter, and detaches the hidden `<video>`

### Task 5 - Studio wiring, safe-zone guide, overlay rail, and pane expansion

- `public/recorder.html` source + called in unit test (source guard)
  - → keeps zero `<script src=...>` and `<link href=...>` tags (loads `/recorder-looks.js` via dynamic `import('/recorder-looks.js')`)
  - → constructs `MediaRecorder` with the active capture stream (not hardcoded `global_stream_handle`) and assigns `node_video_preview.srcObject` to that same stream
  - → renders the Stage 3 safe-zone guide overlay (`id="dom-safe-zone-guide"`) outside the recorded canvas, and renders the 4-slot overlay rail (`upper`, `face`, `lower`, `emoji`) plus expand button (`id="dom-btn-expand-pane"`)
- Booted `public/recorder.html` in jsdom with injected `window.UFFLooks` + called in unit test
  - → `node_video_preview.srcObject` and the stream passed to `new MediaRecorder(...)` are identical (`===`) to the stream returned by `UFFLooks.createLiveLooks`
  - → selecting a step whose `background` column resolves to `'error'` blocks `startPreRollSequence()` from starting a countdown or `MediaRecorder`, and writes the background error into `node_status_bar`
  - → tapping a rail prop updates `UFFLooks.setOverlay(slot, slug)`, tapping the same prop again clears it (`null`), and dragging on the preview routes through `computeDragOffset` + `sanitizeTuning`
  - → clicking `#dom-btn-expand-pane` toggles `body.is-pane-expanded` and sets `data-expanded-pane` to `'preview'` when idle/recording and `'playback'` when reviewing (`body.is-reviewing-now`)
- Expanded pane CSS in `public/recorder.html` + called in unit test (scoped source guard)
  - → scopes the rule to `body.is-pane-expanded` and declares `position: fixed`, `inset: 0`, and `object-fit: contain`

### Task 6 - Stage 2 skips BiRefNet when a background is named

- `run_background_removal` in `docs/video-pipeline/video_pipeline.py` with `background = 'studio.png'` + called in Python test
  - → copies the silence-removed clip to `_no_silence_bg_removed.mp4` and never calls `process_video_background`
- `run_background_removal` with `background = ''`, `'none'`, `'skip'` + called in Python test
  - → still copies through, and `process_video_background` / `background_removal_remote` remain intact for unit tests and manual callers

### Task 7 - Build entry, Workbox precache exclusions, and vendored assets

- `vite.config.js` + called in unit test
  - → emits the standalone entry as `recorder-looks.js` at the dist root while keeping `assets/main-[hash].js` for the main entry
  - → `WORKBOX_IGNORES` includes `'recorder-looks.js'` and `'**/mediapipe/**'` so the learner PWA precache never downloads operator studio assets
- `scripts/verify-build-artifact.mjs` + called in unit test
  - → verifies `dist/recorder-looks.js` exists alongside the `dist/assets/main-*.js` CDN assertion
- `scripts/sync-mediapipe-assets.mjs` + called in unit test
  - → syncs the WASM loader files and `selfie_segmenter_landscape.tflite` into `public/mediapipe/` idempotently
- `src/modules/video/recorder-page.test.js` + called in unit test
  - → all touched paths are registered in the story allowlist and the suite passes
