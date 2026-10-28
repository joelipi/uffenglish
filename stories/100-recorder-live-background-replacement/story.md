# Recorder: live 1080p30 background/foreground replacement and the overlay rail

## Context

The operator studio (`public/recorder.html`) records the raw camera stream straight into `MediaRecorder`, and the take is uploaded to `raw/` and rendered by the pipeline. Background substitution happens **after** the fact, in Stage 2 (BiRefNet on Modal), so a matte that looks wrong cannot be seen until the render has already run and been published — and by then the only fix is another render.

This story moves background and foreground composition **into the take** at full **1080×1920 @ 30 fps** social-master quality: the camera is centre-cropped into a 9:16 1080×1920 composite canvas, segmented on every frame via a downscaled 256×256 input to MediaPipe `ImageSegmenter`, sandwiched between the replacement **background** (behind the person) and optional **foreground** (in front of the person) with edge feathering and light-wrap spill suppression in a WebGL2 shader, and the canvas' `captureStream(30)` is what `MediaRecorder` records. The live preview is fed **the same `MediaStream` object** the recorder records, so what the operator sees cannot disagree with the file — the correction loop is "see it, reject the take, re-record", which the studio already supports (`global_pending_record_action`).

Both `background` and `foreground` accept either a **full `https://` image URL** (e.g. from R2 or any web host) or a **short filename** bundled under `/overlays/backgrounds/` or `/overlays/foregrounds/`.

The same composite also carries the app's **overlay rail** (Face / Top / Bottom / Emoji props from `OVERLAY_LIBRARY`, plus emoji dragging) — overlays only, not filters, not lens effects, not procedural screen effects — and draws a non-recorded CSS safe-zone guide over the preview pane showing where Stage 3's burned-in `<aside>` text card and the bottom 20% caption band will land.

Target: **Android, one device, one operator.** Unlike the learner app, the operator studio does not hold the Whisper model or `AudioWorklet` in memory, so it can sustain **1080×1920 @ 30 fps** without OOMing — keeping Stage 3's `output/social` video and `Html2Image` text overlays at native 1080p30 so TikTok and Instagram Reels never down-rank the upload as low-definition, while Stage 3's `write_web_from_master` continues to transcode the lightweight 720p-long-edge web copy for the app.

## Out of Scope

- Filters, lens effects and procedural screen overlays in the studio. The rail shows props and emoji only; `paintLooks` is still called with those ids at `none`.
- Face tracking of any kind (090 stays parked).
- Deleting the offline BiRefNet stage or the `video-background-removal` Modal app. Stage 2 keeps its code; it simply copies through for any row that names a background.
- Video backgrounds. Replacement backgrounds and foregrounds are still images.
- iOS-specific tuning.

## Implementation approach

- **The page owns no pixel maths.** Every rule lives in `src/modules/looks/background-substitution-logic.js` (pure: no React, no DOM, no browser globals) and the browser adapter `src/modules/looks/background-substitution.web.js` beside it. The built bundle `/recorder-looks.js` is loaded by `public/recorder.html` via dynamic `import('/recorder-looks.js')` inside its inline script (preserving the self-contained HTML guard that forbids `<script src=...>` tags) and exposes `window.UFFLooks`.
- **Full 1080×1920 @ 30 fps geometry on every take.** `resolveSubstitutionDimensions()` returns `{ width: 1080, height: 1920, fps: 30, maskWidth: 256, maskHeight: 256 }`. Even when a row has no replacement background/foreground and no overlay is active, the studio still records through the 1080×1920 @ 30 fps composite canvas (unmasked) so every take in a step group shares identical 1080×1920 portrait dimensions for Stage 3's concatenation, and every `output/social` render stays 1080p30 for TikTok / Instagram Reels.
- **256×256 segmenter input at 30 Hz — never a 1080p CPU readback.** Passing the 1920×1080 `<video>` directly to MediaPipe `segmentForVideo` would produce a 2,073,600-float (8 MB) mask whose GPU→CPU readback stalls the main thread and causes A/V drift. Instead, the centre-cropped camera frame is drawn into a **256×256 scratch canvas** (`maskWidth: 256, maskHeight: 256` — 65,536 floats, matching the model's native tensor size) and passed to `segmentForVideo` on every painted camera frame (30 Hz). Temporal stabilization applies a light exponential blend (`0.85 × current + 0.15 × previous`) at 256×256 so standing-still hair/shoulder shimmer is suppressed without trailing lag when nodding or gesturing.
- **4-Layer Sandwich in a WebGL2 shader compositor with light-wrap spill suppression.** On the 1080×1920 output canvas, a WebGL2 fragment shader composites four layers in `< 0.5 ms` per frame:
  1. **Layer 1 (`u_bg`)**: the replacement background image (cover-cropped to 9:16), behind the person.
  2. **Layer 2 (`u_video` + `u_mask`)**: the centre-cropped 9:16 camera frame masked by the 256×256 single-channel texture (`GL_LINEAR` hardware bilinear upscaling), with `smoothstep(0.35, 0.65, mask)` edge feathering plus **light-wrap spill suppression** (`resolveEdgeSpillMix`: along the semi-transparent rim `0.15 < alpha < 0.85`, 15% of `u_bg` colour is mixed into the person pixel so a bright room wall never leaves a white halo around dark hair or shoulders).
  3. **Layer 3 + 4 (`u_overlays`)**: a 1080×1920 2D overlay canvas painted in front of the person — first the optional `foreground` image (cover-fitted to 1080×1920 so the person sits behind a desk, frame, or foreground prop), then `paintLooks` for the interactive rail's Face / Top / Bottom / Emoji props.
  When WebGL2 is unavailable (e.g. unit-test fakes), the adapter falls back to an offscreen `personCanvas` (`destination-in` mask on `personCanvas`, then `drawImage` over `u_bg` on the main canvas, then `foreground`, then `paintLooks` — never `destination-in` directly on the main canvas, which would erase the background).
- **URL and filename loading without canvas tainting (`crossOrigin = 'anonymous'` + operator proxy fallback).**
  - `resolveBackgroundSource(value)` and `resolveForegroundSource(value)` accept either a valid `https://` URL or a bare filename (`studio.png` / `studio` → `/overlays/backgrounds/studio.png` or `/overlays/foregrounds/studio.png`), and return `null` for empty/`none`/`skip`, non-HTTPS schemes (`http:`, `javascript:`, `data:`), or path traversal (`..`).
  - Cross-origin `https://` images are loaded with `img.crossOrigin = 'anonymous'` so the canvas is never tainted (`canvas.captureStream(30)` throws `SecurityError` on a tainted canvas).
  - If direct CORS loading of an `https://` URL fails (because the remote host omits `Access-Control-Allow-Origin`), the loader retries through `GET /api/pipeline/proxy-image?url=<encoded>` with the `x-operator-key` header, converts the response to a `Blob`, and loads its same-origin `URL.createObjectURL(blob)`. The Pages Function `functions/api/pipeline/proxy-image.js` requires `requireOperatorKey`, allows only public `https:` hosts (blocking loopback, RFC1918 private ranges, link-local `169.254.*`, IPv6 local/unique-local, and `.local`/`.internal` suffixes to prevent SSRF), requires an `image/*` content type, and enforces a 15 MB size cap.
- **One stream, two consumers.** `new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...rawStream.getAudioTracks()])` is assigned to `node_video_preview.srcObject` **and** handed to `MediaRecorder` at `15 Mbps` (`videoBitsPerSecond: 15000000`). The audio track is the camera's own (48 kHz mono, echoCancellation off) — untouched.
- **Stage 3 safe-zone guide on the live preview.** Because Stage 3 (`video_pipeline.py`) burns an HTML `<aside>` card (`top: 15%–74%, left: 2%–62%`) and the app player's captions occupy the bottom 20% (`80%–100%`), the studio renders a faint dashed CSS overlay over `.video-box:first-of-type` (outside the recorded canvas so it never enters the video) marking those two bands.
- **Both `background` and `foreground` flow from `sources/<course>.source.txt` → `<course>.master.csv` → studio + pipeline.**
  - `sourceToRows()` in `scripts/lib/source-bridge-utils.js` reads `topic.background ?? pair.background ?? source.background ?? ''` and `topic.foreground ?? pair.foreground ?? source.foreground ?? ''` (plus `source.intros?.background` / `source.intros?.foreground` for intro rows) and emits them into every recordable take row (`filename` non-empty).
  - If a row specifies a `background` or `foreground` that is still loading or failed to load, `shouldStartTake({ backgroundState, foregroundState })` returns `false`, and the studio refuses to start the take and names the failing layer in the status bar.
  - In `docs/video-pipeline/video_pipeline.py`, Stage 2 (`run_background_removal`) copies the clip through without calling BiRefNet, and Stage 3 (`process_single_video`) only composites a local `OVERLAYS_DIRECTORY` foreground file if one exists locally on disk (ignoring URLs or studio-baked foreground names instead of failing).
- **Workbox precache isolation.** `vite.config.js` adds `'recorder-looks.js'` and `'**/mediapipe/**'` to `WORKBOX_IGNORES` so learners visiting the main app never precache operator-only segmentation or bundle files.
- **Enlargeable active pane.** One toggle expands the active pane (`resolveExpandablePane`: live preview while idle/recording, playback take while reviewing) into a fixed full-viewport overlay (`position: fixed; inset: 0; object-fit: contain`) so the operator can inspect 1080p matte edges at full screen width on the phone before accepting.

## Tasks

### Task 1 - Substitution and asset-URL rules (pure module)

- `resolveSubstitutionDimensions()` in `src/modules/looks/background-substitution-logic.js` + called in unit test
  - → returns `{ width: 1080, height: 1920, fps: 30, maskWidth: 256, maskHeight: 256 }` (social-grade 1080p30 output with a 256×256 segmentation input)
- `blendMaskAlpha({ next, previous, weight })` + called in unit test
  - → defaults `weight` to `0.85` (`0.85 × next + 0.15 × previous`), converts float confidence `[0..1]` into `Uint8Array` `[0..255]` in a single pass over the 256×256 buffer, uses `next` verbatim when `previous` is null or mismatched in length, and clamps out-of-range values
- `resolveEdgeSpillMix(alpha, spillStrength = 0.15)` + called in unit test
  - → returns `0` outside the rim (`alpha <= 0.15` or `alpha >= 0.85`), peaks at `spillStrength` at `alpha = 0.5`, so light-wrap colour spill only affects the semi-transparent border pixels
- `resolveBackgroundSource(value)` and `resolveForegroundSource(value)` + called in unit test
  - → for `'https://r2.ultrafastfluency.com/bg/studio.png'`, returns that exact HTTPS URL
  - → for `'studio.png'` or `'studio'`, returns `'/overlays/backgrounds/studio.png'` (and `'/overlays/foregrounds/studio.png'` for foreground)
  - → returns `null` for `''`, `'none'`, `'skip'`, `'http://...'` (non-HTTPS), `'javascript:...'`, `'data:...'`, `'../x.png'`, or relative paths containing `/` or `\`
- `isAllowedRemoteImageUrl(urlString)` + called in unit test
  - → returns `true` only for `https:` URLs with a public hostname; returns `false` for `http:`, `localhost`, `127.*`, `10.*`, `172.16.*`–`172.31.*`, `192.168.*`, `169.254.*`, `[::1]`, `[fc00::]`/`[fd00::]`, `[fe80::]`, and `.local`/`.internal` hosts
- `resolveAssetLayerState({ sheetValue, resolver, imageLoaded, imageError })` + called in unit test
  - → `'none'` when `sheetValue` is blank/`'none'`/`'skip'`, `'error'` when `sheetValue` is non-empty but `resolver(sheetValue)` is `null` or `imageError` is `true`, `'ready'` when resolved and `imageLoaded` is `true`, and `'loading'` while decoding
- `shouldStartTake({ backgroundState, foregroundState })` + called in unit test
  - → `true` only when **both** `backgroundState` and `foregroundState` are in `('none', 'ready')`; `false` if either is `'loading'` or `'error'`
- `resolveExpandablePane({ isReviewing })` + called in unit test
  - → `'playback'` while reviewing, `'preview'` otherwise
- `overlaySelectionFor({ face, upper, lower, emoji })` + called in unit test
  - → returns a sanitized selection with `filterId: 'none'`, `lensId: 'none'`, `screenId: 'none'` and only valid overlay/twemoji slugs

### Task 2 - Source bridge carries `background` and `foreground` into `<course>.master.csv`

- `sourceToRows` in `scripts/lib/source-bridge-utils.js` with `background` and `foreground` set at course, pair, topic, or `intros` level (as filenames or `https://` URLs) + called in unit test
  - → emits the resolved `background` (`topic.background ?? pair.background ?? source.background ?? ''`) and `foreground` (`topic.foreground ?? pair.foreground ?? source.foreground ?? ''`) on every recordable take row (`filename` non-empty) and leaves non-take rows (`branching`, reuse rows with empty `filename`) with `''`
  - → when neither key is present in `source`, emits `''` on every row (preserving byte-for-byte output on all existing `sources/*.source.txt` files)

### Task 3 - CORS-safe image loader and `/api/pipeline/proxy-image` fallback

- `functions/api/pipeline/proxy-image.js` + called in unit test (`// @vitest-environment node`)
  - → rejects requests without a valid `x-operator-key` (`401`)
  - → rejects missing, non-HTTPS, or private/loopback `url` query parameters (`400`) via `isAllowedRemoteImageUrl`
  - → rejects upstream responses whose `Content-Type` does not start with `image/` (`415`) or whose body exceeds `15 MB` (`413`)
  - → returns `200` with the upstream image bytes and `Content-Type` on a valid public image URL
- `loadLayerImage({ url, operatorKey, ImageCtor, fetchImpl })` in `src/modules/looks/background-substitution.web.js` + called in unit test
  - → sets `img.crossOrigin = 'anonymous'` before setting `img.src` whenever `url` is `https://...`
  - → when direct `img.onerror` fires on an `https://` URL and `operatorKey` is present, fetches `/api/pipeline/proxy-image?url=<encoded>` with `x-operator-key`, creates a blob object URL, and resolves the loaded `Image`

### Task 4 - The segmentation adapter (browser)

- `loadSegmenter({ filesetPath, modelPath, createSegmenter })` in `src/modules/looks/segmentation.web.js` + called in unit test with an injected factory
  - → requests `delegate: 'GPU'`, `runningMode: 'VIDEO'`, `outputCategoryMask: false`, `outputConfidenceMasks: true`
  - → retries once with `delegate: 'CPU'` if GPU initialization throws, and returns `null` if both fail (never throwing an unhandled rejection)
- `segmentFrameToMask({ segmenter, maskInputCtx, video, cropRect, maskWidth, maskHeight, timestampMs, previousMask })` + called in unit test
  - → draws the cropped camera rect into `maskInputCtx` at `256×256` **before** calling `segmenter.segmentForVideo`, so the model never reads back a 1920×1080 buffer
  - → returns the temporally blended `Uint8Array(256 * 256)` alpha mask, or `previousMask` if the segmenter throws or returns no mask
- `src/modules/looks/segmentation.web.js` source + called in unit test (source guard)
  - → imports `@mediapipe/tasks-vision`, never references `ctx.filter`, and contains no reference to `/recorder` or `recorder.html`

### Task 5 - The 1080p30 4-layer WebGL2 / offscreen capture composite

- `createSubstitutedCaptureStream` in `src/modules/looks/background-substitution.web.js` + called in unit test with injected canvas/context fakes
  - → sizes the output canvas to `1080×1920` and calls `canvas.captureStream(30)`
  - → returns a `MediaStream` combining the canvas video track with `rawStream.getAudioTracks()`
  - → composites the 4-layer sandwich in order: (1) `background` behind, (2) segmented camera via offscreen `personCanvas` (`destination-in` on `personCanvas`, never `destination-in` on the main canvas), (3) `foreground` image in front of the person, and (4) `paintLooks` interactive rail props/emoji on top
  - → when WebGL2 is available, compiles the fragment shader containing `smoothstep` feathering and edge spill suppression (`u_bg`, `u_video`, `u_mask`, `u_overlays`)
  - → schedules paints via `requestVideoFrameCallback` when available and `requestAnimationFrame` otherwise, and `dispose()` stops the loop, closes the segmenter, revokes any proxy object URLs, and detaches the hidden `<video>`

### Task 6 - Studio wiring, safe-zone guide, overlay rail, and pane expansion

- `public/recorder.html` source + called in unit test (source guard)
  - → keeps zero `<script src=...>` and `<link href=...>` tags (loads `/recorder-looks.js` via dynamic `import('/recorder-looks.js')`)
  - → constructs `MediaRecorder` with the active capture stream (not hardcoded `global_stream_handle`) and assigns `node_video_preview.srcObject` to that same stream
  - → passes both `row.background` and `row.foreground` from the current CSV row into `UFFLooks`
  - → renders the Stage 3 safe-zone guide overlay (`id="dom-safe-zone-guide"`) outside the recorded canvas, and renders the 4-slot overlay rail (`upper`, `face`, `lower`, `emoji`) plus expand button (`id="dom-btn-expand-pane"`)
- Booted `public/recorder.html` in jsdom with injected `window.UFFLooks` + called in unit test
  - → `node_video_preview.srcObject` and the stream passed to `new MediaRecorder(...)` are identical (`===`) to the stream returned by `UFFLooks.createLiveLooks`
  - → selecting a step whose `background` or `foreground` state resolves to `'error'` or `'loading'` blocks `startPreRollSequence()` from starting a countdown or `MediaRecorder`, and writes the layer status into `node_status_bar`
  - → tapping a rail prop updates `UFFLooks.setOverlay(slot, slug)`, tapping the same prop again clears it (`null`), and dragging on the preview routes through `computeDragOffset` + `sanitizeTuning`
  - → clicking `#dom-btn-expand-pane` toggles `body.is-pane-expanded` and sets `data-expanded-pane` to `'preview'` when idle/recording and `'playback'` when reviewing (`body.is-reviewing-now`)
- Expanded pane CSS in `public/recorder.html` + called in unit test (scoped source guard)
  - → scopes the rule to `body.is-pane-expanded` and declares `position: fixed`, `inset: 0`, and `object-fit: contain`

### Task 7 - Stage 2 skips BiRefNet and Stage 3 skips baked foregrounds

- `run_background_removal` in `docs/video-pipeline/video_pipeline.py` with `background = 'studio.png'` or `'https://...'` + called in Python test
  - → copies the silence-removed clip to `_no_silence_bg_removed.mp4` and never calls `process_video_background`
- `run_background_removal` with `background = ''`, `'none'`, `'skip'` + called in Python test
  - → still copies through, and `process_video_background` / `background_removal_remote` remain intact for unit tests and manual callers
- `process_single_video` in `docs/video-pipeline/video_pipeline.py` with `foreground` set + called in Python test / source guard
  - → skips re-compositing `foreground` in Stage 3 (since `foreground` is now baked into the take in front of the person at capture time, just like `background` is baked behind the person)

### Task 8 - Build entry, Workbox precache exclusions, and vendored assets

- `vite.config.js` + called in unit test
  - → emits the standalone entry as `recorder-looks.js` at the dist root while keeping `assets/main-[hash].js` for the main entry
  - → `WORKBOX_IGNORES` includes `'recorder-looks.js'` and `'**/mediapipe/**'` so the learner PWA precache never downloads operator studio assets
- `scripts/verify-build-artifact.mjs` + called in unit test
  - → verifies `dist/recorder-looks.js` exists alongside the `dist/assets/main-*.js` CDN assertion
- `scripts/sync-mediapipe-assets.mjs` + called in unit test
  - → syncs the WASM loader files and `selfie_segmenter_landscape.tflite` into `public/mediapipe/` idempotently
- `src/modules/video/recorder-page.test.js` + called in unit test
  - → all touched paths are registered in the story allowlist and the suite passes
