# A recap take fills a portrait frame no matter how the phone was held

## Context

Reported symptom, clarified: an entire recorded take (not a still) comes out distorted in the end-of-lesson video, most likely when the learner recorded with the phone held sideways (lying on his side).

Two independent mechanisms produce that, and both are in the recap renderer:

1. **The recap frame inherits the first take's aspect.** `VideoRenderPlanner.getTargetDimensions` (`video-processor-logic.js:517`) returns the first take's own proportions, scaled up (`1280×720` → `1920×1080`). A learner whose *first* answer was recorded sideways therefore makes the **whole recap landscape** — every later portrait take is then a thin vertical band in a wide frame.
2. **Every other take is letterboxed, not fitted.** `calculateLayout` (`video-processor-logic.js:546`) is a *contain* fit, so a landscape take inside a 1080×1920 frame is drawn at `1080×607.5` with `y = 656.25` (`video-processor.web.js:764-770`) — about a third of the frame height, black above and below. To a viewer that reads as the take being squashed/shrunk.

Both are reachable in production: iOS keeps the **raw** camera stream (`shouldUsePortraitCapture()` returns `!isIOS()`, `speech.web.js:28-30`), so a sideways-held iPhone records a landscape take, unlike Android/desktop where `createPortraitCaptureStream` already composites into a 9:16 canvas (a 9:16 source rect into a 9:16 canvas — uniform, so the composite can never distort). Friend UGC takes also arrive from other devices, and the `1080×1920` fallback is used when the first take's metadata misses its 2 s probe (`video-processor.web.js:206-214, 263-266`). Story 015 only *warns* the learner to rotate (`LandscapeWarning.web.jsx`) and explicitly left forcing portraiture out of scope, so the case still reaches production.

The target is unambiguous: lesson/remote clips are portrait — `docs/video-pipeline/video_pipeline.py:20-23` renders `1080×1920` and the web variant `720×1280` — the app frame is `9 / 16` (`.video-frame`), and the Android/desktop capture composite is 9:16. A recap is a portrait video; it must stop inheriting whatever the first take happened to be.

A third, separate defect is in the same code path and is fixed here too: both freeze-frame captures (`video-processor.web.js:528-538` and `890-898`) use the four-argument `drawImage(video, 0, 0, w, h)`, which scales the source **non-uniformly** — a genuinely warped frame, held for the whole 2 s outro card (`TAILING_DURATION_MS`) and during inter-segment buffering.

Already correct and unchanged: the capture composite's crop maths, transcode/publish (`transcode.web.js` applies no resize — mediabunny `Conversion.init` gets no `video` options, and the Cloudinary fallback only inserts `f_mp4`), and thumbnails (`thumbnail.web.js` derives height from the source ratio).

## Out of Scope

- **Un-rotating a physically sideways pose.** If the learner lies down and the camera sees them rotated 90° in the frame, no metadata tells us which way to rotate them back (the container only describes the device, not the subject) and no pose detection is in scope. What is guaranteed here is that the take is never squashed, never shrunk into a band, and never flips the whole recap to landscape.
- Changing camera constraints, the portrait composite, or `shouldUsePortraitCapture()` — including on iOS, whose MediaRecorder path is deliberately untouched (see `docs/learnings.md`).
- Blocking or interrupting recording in landscape; `LandscapeWarning` and its dismissal behaviour stay exactly as they are.
- Re-encoding takes already published on R2 before this change.
- On-screen CSS presentation (`SuccessVideo`, `SuccessVideoCanvas`, `#playback-video`, `.video-frame`): CSS cannot alter the encoded file.
- The React Native renderer (`video-processor.native.jsx`, reference code) and the text-mode avatar-card background (`drawProfileBackground`, already a uniform crop).

## Implementation approach

**1. A canonical 9:16 frame.** Replace the source-preserving maths in `getTargetDimensions` with a ladder of exact 9:16 sizes and pick by the width the take can actually fill:

- `RECAP_FRAME_SIZES = [[540, 960], [720, 1280], [1080, 1920]]` (`video-processor-logic.js`, exported so tests can pin it);
- `croppedWidth = Math.min(srcW, srcH * 9 / 16)` — the width a 9:16 centre crop of the take would have, i.e. the real usable detail; non-finite or ≤ 0 inputs fall back to `1080`;
- return the **first** ladder entry whose width is `>= croppedWidth`, else the last entry (`1080×1920`).

Consequences, deliberate: `1080×1920` stays `1080×1920`; the Android composite `720×1280` stays `720×1280` (no new encode cost on the phones that used to OOM); a sideways `1280×720` first take becomes `720×1280` instead of `1920×1080`; `480×640` becomes `540×960`. Every result is exactly `9 / 16` and even.

**2. Fill, don't letterbox.** `calculateLayout(srcW, srcH, dstW, dstH)` becomes a *cover* placement: one uniform scale, centred, with the overflow cropped by the canvas. Contract:

- `srcRatio = srcW / srcH`, `dstRatio = dstW / dstH`;
- `srcRatio >= dstRatio` → `height = dstH`, `width = dstH * srcRatio`, `x = (dstW - width) / 2`, `y = 0`;
- otherwise → `width = dstW`, `height = dstW / srcRatio`, `x = 0`, `y = (dstH - height) / 2`;
- `null` when any of the four dimensions is not a positive finite number (today it returns `NaN`s, which `drawImage` silently swallows);
- no rounding — sub-pixel rects are fine and the ratio must stay exact. `width`/`height` may exceed the canvas and `x`/`y` may be negative; `drawImage` clips, which is the crop.

The class method stays a one-line delegate so the live path and the tested path cannot diverge. `after-video-player.web.js` uses the same call (its tail clips are 9:16, so the result is unchanged there).

**3. One fill constant.** Export `RECAP_FRAME_BACKGROUND = '#000'` and use it for the colour painted behind a video frame (live `draw` branch, freeze capture, after-video controller). `#111318` stays the "no frame at all" idle colour (`video-processor.web.js:431, 536, 759, 774`).

**4. One freeze-frame helper.** Inside `executeRenderLoop`, before `const draw = () => {`, add `captureLastFrame(target)` that fills `target` (already sized to `canvas.width`/`canvas.height`) with `RECAP_FRAME_BACKGROUND`, computes `planner.calculateLayout(video.videoWidth, video.videoHeight, target.width, target.height)` and draws the video with that rect only when non-null. Both freeze sites call it; the tailing branch keeps its `else` branch (fill `#111318`) for "no frame ready"; the advance site keeps its create-only-if-absent sizing.

**5. Null-safe consumers.** The live `draw` branch and `after-video-player.web.js` `drawLoop` treat a `null` layout as "background only". In `drawLoop`, guard the `drawImage` with `if (layout)` but keep the audio re-lock code after it (an early `return` would stop the buffer re-locking on a loop wrap).

No call-site changes are needed for propagation: `videoCanvas`, `displayCanvas` (`video-processor.web.js:263-273`) and `renderFallbackSegment` (`1557-1560`) all already take their size from the same function, so the per-segment clips and the success-screen canvas inherit the portrait frame automatically.

## Tasks

### Task 1 - The recap frame is always 9:16

In `src/modules/video/video-processor-logic.test.js` (imports the module directly; no jsdom):

- `VideoRenderPlanner.getTargetDimensions(...)`:
  - `(1080, 1920)` → `{ width: 1080, height: 1920 }`
  - `(720, 1280)` → `{ width: 720, height: 1280 }` (Android composite unchanged)
  - `(1920, 1080)` → `{ width: 720, height: 1280 }` (a sideways first take no longer makes the recap landscape)
  - `(1280, 720)` → `{ width: 540, height: 960 }`
  - `(480, 640)` → `{ width: 540, height: 960 }`
  - `(1080, 2400)` → `{ width: 1080, height: 1920 }`
  - `(3840, 2160)` → `{ width: 1080, height: 1920 }` (capped at the ladder's largest)
  - `(0, 0)`, `(undefined, undefined)` and `()` → `{ width: 1080, height: 1920 }`
- every input in `[[1080,1920],[720,1280],[1920,1080],[1280,720],[480,640],[1080,2400],[3840,2160],[0,0]]`
  - → `width / height === 9 / 16` exactly
  - → `width % 2 === 0` and `height % 2 === 0`
  - → the result is one of `RECAP_FRAME_SIZES`
- `RECAP_FRAME_SIZES` is exported and equal to `[[540, 960], [720, 1280], [1080, 1920]]` (literal, so changing the ladder fails here)

### Task 2 - A take fills the frame instead of being letterboxed

`calculateLayout` unit tests in the same file:

- `calculateLayout(1080, 1920, 1080, 1920)` (equal ratios)
  - → `{ x: 0, y: 0, width: 1080, height: 1920 }` exactly
- `calculateLayout(1280, 720, 1080, 1920)` (landscape take on a portrait frame)
  - → `height === 1920`, `width` ≈ `3413.333…`, `y === 0`, `x` ≈ `-1166.666…` (each within `1e-6`)
  - → `Math.abs(width / height - 1280 / 720) < 1e-9` (uniform scale — the take is cropped, not squashed)
- `calculateLayout(720, 1280, 1920, 1080)` (portrait take on a landscape frame)
  - → `width === 1920`, `height` ≈ `3413.333…`, `x === 0`, `y` ≈ `-1166.666…`
- every source in `[[640,480],[480,640],[1920,1080],[1080,1920],[1080,1080],[361,640],[1,1]]` against every destination in `[[1080,1920],[720,1280],[1920,1080]]`
  - → `Math.abs(width / height - srcW / srcH) < 1e-9`
  - → `x <= 0`, `y <= 0`, `x + width >= dstW - 1e-9`, `y + height >= dstH - 1e-9` (the frame is fully covered — no bars)
  - → `x + width / 2` ≈ `dstW / 2` and `y + height / 2` ≈ `dstH / 2` (centred crop)
- `calculateLayout` with `0` for any one dimension, with a negative value, with `undefined`, and with no arguments
  - → `null` in every case
- `new VideoRenderPlanner().calculateLayout(...)`
  - → returns the same value as the free `calculateLayout` for every row above (delegation)

### Task 3 - Frozen frames and the tail use the same placement

`src/modules/video/video-processor.web.js`, `src/modules/video/after-video-player.web.js`:

- the tailing branch (`if (step.type === 'tailing') {`) + `video.readyState >= 2`
  - → the frozen canvas is painted by `captureLastFrame` (background fill, then `drawImage(video, layout.x, layout.y, layout.width, layout.height)`)
  - → the frozen content is a uniform-scale/cropped copy, never a stretched one
- the tailing branch + no frame ready
  - → the frozen canvas is filled with `#111318` and no `drawImage` runs
- the `shouldAdvance` branch + `video.readyState >= 2`
  - → the frame is captured through `captureLastFrame`
  - → the canvas is created and sized to `canvas.width`/`canvas.height` only when absent
- the `shouldAdvance` branch + a text-mode step with no `<video>` frame
  - → the rendered canvas is still copied 1:1 (existing `drawImage(canvas, 0, 0, w, h)` path unchanged)
- the live video branch of `draw` (`} else if (video.readyState >= 2) {`) + `calculateLayout` returns `null`
  - → the background is filled and no `drawImage(video, …)` runs
- `video-processor.web.js` source
  - → `RECAP_FRAME_BACKGROUND` is imported from `./video-processor-logic.js` and used as the colour behind a video frame
  - → no `drawImage(video, 0, 0, …)` remains
- `after-video-player.web.js` `drawLoop` + `calculateLayout` returns `null`
  - → no `drawImage` call is made, no exception is thrown, and the `loop.lastTime` audio re-lock still runs

### Task 4 - Guards so the stretch and the landscape recap cannot come back

In `src/modules/video/video-processor-web-guard.test.js` (raw source, sliced to real markers — never to EOF):

- the whole of `video-processor.web.js`
  - → does not match `/drawImage\(\s*video,\s*0,\s*0,/` (this assertion fails on today's code)
  - → matches `/import \{[^}]*RECAP_FRAME_BACKGROUND[^}]*\} from '\.\/video-processor-logic\.js'`
- the helper region, sliced from `const captureLastFrame =` to `const draw = () => {`
  - → both markers found and `end > start`
  - → matches `calculateLayout(`
  - → matches `/drawImage\(\s*video,\s*layout\.x,\s*layout\.y,\s*layout\.width,\s*layout\.height\s*\)/`
  - → matches `/RECAP_FRAME_BACKGROUND/`
- the live video region, sliced from `} else if (video.readyState >= 2) {` to `} else if (lastFrameCanvas) {`
  - → matches `/RECAP_FRAME_BACKGROUND/`
  - → `region.indexOf('if (layout)')` is `>= 0` and less than `region.indexOf('drawImage(video,')`
- the tailing region, sliced from `if (step.type === 'tailing') {` to the first `return;` after it
  - → matches `/captureLastFrame\(/`
  - → still matches `/111318/`
- the advance region, sliced from `if (shouldAdvance) {` to `if (stepIndex < plan.length || isTailing) {`
  - → matches `/captureLastFrame\(/`

In `src/modules/video/after-video-wiring.test.js`, the `drawLoop` region sliced from `function drawLoop() {` to `function beginPlayback(loop) {`:

- → matches `/calculateLayout\(/`
- → matches `/RECAP_FRAME_BACKGROUND/`
- → `region.indexOf('if (layout)')` is `>= 0` and less than `region.indexOf('drawImage(video,')`
- → still matches `/loop\.lastTime/` after the draw

Every new guard must be proven able to fail: temporarily restore an inline `drawImage(video, 0, 0, canvas.width, canvas.height)` (and, for the frame test, temporarily return the old source-preserving dimensions) and confirm the new assertions — not a neighbouring one — are what goes red.

## Technical Context

- No new dependency and no version bump. `mediabunny` 1.50.8 is already the transcode layer; `Conversion.init` with no `video` options defaults output dimensions to the input's natural display size, and `fit` only applies when both `width` and `height` are set (`node_modules/mediabunny/dist/modules/src/conversion.d.ts`).
- Test runner: Vitest (jsdom project in `vitest.config.js`). `video-processor-logic.js` is imported directly by its test file; `video-processor.web.js` cannot be imported (`import.meta.glob`, `document` at module scope) and is asserted as source text — the existing `video-processor-web-guard.test.js` pattern.
- `video-processor-logic.js` carries a platform-agnostic guard (`video-processor-logic.test.js:1103`): no `window`/`document`/`navigator` identifiers (comments stripped) and no `http(s)://` in the raw source. The new exports must respect both.
- `after-video-wiring.test.js` asserts `controllerRaw` contains `calculateLayout(`; keeping the call and adding a null guard around it satisfies it.
- Commands: `npx vitest run src/modules/video` then `npm run lint`.

## Notes

- Do not quote the removed call verbatim in a code comment. The guard asserts `not.toMatch(/drawImage\(\s*video,\s*0,\s*0,/)` on the raw source (repo rule: token guards must not be comment-stripped), so a comment containing `drawImage(video, 0, 0, …)` would keep the guard green.
- `cover` is the right fit, not `contain`: the recap is a 9:16 deliverable and every other clip in it (teacher prompts, the Android/desktop composite, previously published UGC) is already 9:16, so filling changes nothing for them and removes the band for a landscape take.
- The composite at capture already crops a landscape camera to 9:16 (`speech.web.js:117-136`); this story gives the recap the same guarantee for takes the composite never saw (iOS raw takes, friend UGC), without touching the fragile iOS capture path.
- `TAILING_DURATION_MS` is 2000 (`video-processor-logic.js:11`) — the outro card is where a distorted frame was most visible.
- The Cloudinary upload preset (`CLOUDINARY_UPLOAD_PRESET = 'default'`, `video-share.web.js:10`) is account configuration and is not inspectable from this repo; the code adds only `f_mp4`. If a squashed *published* complete video is ever traced to the fallback transcode path rather than to the recap render, inspect that preset's incoming transformation before changing code.
