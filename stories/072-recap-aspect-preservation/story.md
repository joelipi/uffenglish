# Recap frames keep their recorded aspect ratio

## Context

Reported symptom: the end-of-lesson video a learner records — and especially the concatenated recap — looks stretched, as if the width changed relative to the height compared with the clip that was recorded.

Every stage of the recorded → concatenated path was audited. Most of it is already correct and is not changed here:

- **Capture** (`src/modules/speech/speech.web.js`): non-iOS wraps the camera in a 9:16 canvas that centre-crops (`createPortraitCaptureStream`, cover maths at `speech.web.js:117-136` scales both axes by one factor); iOS keeps the raw camera stream. A crop changes framing, never the ratio.
- **Recap canvas size** (`VideoRenderPlanner.getTargetDimensions`, `video-processor-logic.js:517`): scales the first clip's dimensions proportionally (portrait → height 1080, landscape → width 1920) and only rounds to even pixels, so the encoded file's ratio follows the recorded clip.
- **Live frames** (`executeRenderLoop`'s `draw`, `video-processor.web.js:764-770`): every `<video>` is painted through `calculateLayout`, which letterboxes/pillarboxes with one uniform scale.
- **Transcode/publish** (`transcode.web.js`): `transcodeToMp4` and `transcodeRangeToMp4` call mediabunny `Conversion.init({ input, output })` with no `video` options, so output dimensions default to the input's natural display width/height (`node_modules/mediabunny/dist/modules/src/conversion.d.ts`) and no `fit`/`crop` is applied; the Cloudinary fallback only inserts `f_mp4` into the delivery URL (`toMp4DeliveryUrl`). No server-side resize exists anywhere in `functions/` or `workers/`.
- **Posters/thumbs** (`thumbnail.web.js`): height is derived from the source ratio.

The one real defect is the **freeze frame**, captured twice without the layout:

- `video-processor.web.js:528-538` — the frame captured when the plan reaches the `tailing` step.
- `video-processor.web.js:890-898` — the frame captured on every `shouldAdvance` (inter-segment buffering placeholder).

Both use the four-argument `ctx.drawImage(video, 0, 0, w, h)`, which scales the source **non-uniformly** into the canvas box. The tailing capture is the damaging one: that canvas is the background of the whole outro card (`TAILING_DURATION_MS` = 2000 ms), which is encoded into the concatenated blob and therefore into every trimmed per-segment clip and both R2 uploads derived from it. The advance capture is painted for as long as the next clip takes to load, so a slow segment holds a warped frame for a second or more.

Aspect mismatch is the trigger; the distortion is the bug. A mismatch is reachable: a friend's UGC segment published from another device, an iOS raw-camera clip inside a recap sized from a 9:16 composite, or the `1080×1920` fallback used when the first clip's metadata misses its 2 s probe timeout (`video-processor.web.js:206-214, 263-266`). After this fix a mismatched segment is letterboxed (black bars) instead of warped.

## Out of Scope

- Which clip's aspect the recap canvas follows (the first blob found) and the `1080×1920` fallback when that clip's metadata probe times out. A mismatch letterboxes; it does not distort, and normalizing every recap to a fixed 9:16 is a product change.
- Letterbox (`contain`) versus centre-crop (`cover`) for a mismatched segment — the recap keeps `contain`, so the whole recorded frame stays visible.
- The iOS raw-camera path and `shouldUsePortraitCapture()` (`speech.web.js`), which are load-bearing (see `docs/learnings.md`).
- On-screen CSS presentation of the recap (`SuccessVideo`, `SuccessVideoCanvas`, `#playback-video`, `.video-frame`): CSS cannot alter the encoded file, and the shipped file is what this story is about.
- The React Native renderer `video-processor.native.jsx` (reference code, not shipped).
- `renderFallbackSegment`'s canvas sizing (`video-processor.web.js:1557-1560`) already uses `getTargetDimensions` and is unchanged.

## Implementation approach

**1. One geometry function, exported.** Move the body of `VideoRenderPlanner.calculateLayout` (`video-processor-logic.js:546`) into an exported free function `calculateLayout(srcW, srcH, dstW, dstH)` and keep the class method as a one-line delegate. The free function additionally returns `null` when any of the four dimensions is not a positive finite number (today it returns a rect of `NaN`s, which `drawImage` silently swallows). Its contract, kept explicit:

- source aspect `srcW/srcH`; destination aspect `dstW/dstH`;
- `srcRatio > dstRatio` → `{ x: 0, y: (dstH - drawH) / 2, width: dstW, height: drawH }` with `drawH = dstW / srcRatio` (pillarbox-free letterbox);
- otherwise → `{ x: (dstW - drawW) / 2, y: 0, width: drawW, height: dstH }` with `drawW = dstH * srcRatio` (including the equal-ratio case, which reproduces the full canvas);
- no rounding: sub-pixel rects are fine for canvas and the ratio must stay exact.

**2. One fill constant.** Export `RECAP_FRAME_BACKGROUND = '#000'` from the logic module and use it for the colour painted behind/around a video frame — the live `draw` branch (`video-processor.web.js:768`), the freeze-frame capture, and the after-video controller. `#111318` remains the "no frame at all" idle colour (`video-processor.web.js:431, 536, 759, 774`).

**3. One freeze-frame helper.** Inside `executeRenderLoop`, before `const draw = () => {`, add `captureLastFrame(target)` which:

- fills `target` (already sized to `canvas.width`/`canvas.height`) with `RECAP_FRAME_BACKGROUND`;
- computes `planner.calculateLayout(video.videoWidth, video.videoHeight, target.width, target.height)`;
- draws the video with that rect only when the result is non-null;
- returns `target`.

Both freeze sites call it instead of their inline `drawImage`; the tailing branch keeps its `else` branch (fill `#111318`) for the case where no frame is ready. The advance site keeps its "create the canvas only if absent" sizing.

**4. Null-safe consumers.** The live `draw` branch (`video-processor.web.js:764-770`) and `after-video-player.web.js` `drawLoop` must both treat a `null` layout as "background only". In `drawLoop`, guard the `drawImage` with `if (layout)` while keeping the audio re-lock code that follows (do not early-return, or the buffer would stop re-locking on a wrap).

## Tasks

### Task 1 - Frame placement and recap canvas sizing are pinned by unit tests

In `src/modules/video/video-processor-logic.test.js` (imports the module directly; jsdom is not involved):

- `calculateLayout(1080, 1920, 1080, 1920)` (equal ratios / exact fill)
  - → returns `{ x: 0, y: 0, width: 1080, height: 1920 }` exactly
- `calculateLayout(1280, 720, 1080, 1920)` (landscape source on a portrait canvas)
  - → `width === 1080`, `height === 607.5`, `x === 0`, `y === 656.25`
  - → `Math.abs(width / height - 1280 / 720) < 1e-9` (uniform scale)
- `calculateLayout(720, 1280, 1920, 1080)` (portrait source on a landscape canvas)
  - → `height === 1080`, `width === 607.5`, `y === 0`, `x === 656.25`
  - → `Math.abs(width / height - 720 / 1280) < 1e-9`
- every row of `[[640,480],[480,640],[1920,1080],[1080,1920],[1080,1080],[361,640],[1,1]]` against every destination of `[[1080,1920],[720,1280],[1920,1080]]`
  - → `Math.abs(width / height - srcW / srcH) < 1e-9`
  - → `x >= 0`, `y >= 0`, `x + width <= dstW + 1e-9`, `y + height <= dstH + 1e-9`
- `calculateLayout` called with `0` for any one of the four dimensions, with a negative value, with `undefined`, and with no arguments at all
  - → returns `null` in every case
- `new VideoRenderPlanner().calculateLayout(srcW, srcH, dstW, dstH)`
  - → returns the same value as the free `calculateLayout` for every row of the table above (delegation: the live path is the tested path)

- `new VideoRenderPlanner().getTargetDimensions(...)`:
  - `(720, 1280)` → `{ width: 720, height: 1280 }` (not upscaled)
  - `(1080, 1920)` → `{ width: 1080, height: 1920 }`
  - `(480, 640)` → `{ width: 810, height: 1080 }` (upscaled to 1080 tall)
  - `(640, 480)` → `{ width: 1920, height: 1440 }` (upscaled to 1920 wide)
  - `(1080, 1080)` → `{ width: 1920, height: 1920 }`
  - `(0, 0)` → `{ width: 1080, height: 1920 }` (documented fallback)
  - `(721, 1279)` → both dimensions even, and `Math.abs(width / height - 721 / 1279) < 1 / 720` (even-pixel rounding is the only permitted ratio change)

### Task 2 - Frozen frames use the same placement as live frames

`src/modules/video/video-processor-logic.js`, `src/modules/video/video-processor.web.js`, `src/modules/video/after-video-player.web.js`:

- the tailing branch (`if (step.type === 'tailing') {`) + a frame is ready (`video.readyState >= 2`)
  - → the frozen canvas is painted by `captureLastFrame`, i.e. background fill then `drawImage(video, layout.x, layout.y, layout.width, layout.height)`
  - → the canvas content is never a non-uniform scale of the video (source guard in Task 3)
- the tailing branch + no frame is ready
  - → the frozen canvas is filled with `#111318` (unchanged idle behaviour) and no `drawImage` runs
- the `shouldAdvance` branch + `video.readyState >= 2`
  - → the frame is captured through `captureLastFrame` with the same layout draw
  - → the canvas is created and sized to `canvas.width`/`canvas.height` only when absent (unchanged allocation behaviour)
- the live video branch of `draw` (`} else if (video.readyState >= 2) {`) + `calculateLayout` returns `null`
  - → the frame background is still filled and no `drawImage(video, …)` runs (the branch never passes a `null`/`NaN` rect to `drawImage`)
- the `shouldAdvance` branch + a text-mode step with no `<video>` frame
  - → the rendered canvas is still copied 1:1 (existing `drawImage(canvas, 0, 0, w, h)` path is unchanged)
- `video-processor.web.js` source
  - → `ctx.fillStyle = RECAP_FRAME_BACKGROUND` is used for the colour behind a video frame, and `RECAP_FRAME_BACKGROUND` is imported from `./video-processor-logic.js`
  - → no `drawImage(video, 0, 0, …)` remains in the file
- `after-video-player.web.js` `drawLoop` + `calculateLayout` returns `null`
  - → no `drawImage` call is made and no exception is thrown; the audio re-lock block below still runs (source guard: `if (layout)` appears before the `drawImage(video,` call, and the `loop.lastTime` re-lock code follows it)

### Task 3 - Source guards so a stretched frame cannot come back

In `src/modules/video/video-processor-web-guard.test.js` (raw source, sliced to real markers — never to EOF):

- the whole of `video-processor.web.js`
  - → does not match `/drawImage\(\s*video,\s*0,\s*0,/` (the non-uniform four/six-argument form; this assertion fails on today's code)
  - → matches `/import \{[^}]*RECAP_FRAME_BACKGROUND[^}]*\} from '\.\/video-processor-logic\.js'/`
- the helper region, sliced from `const captureLastFrame =` to `const draw = () => {`
  - → both markers are found and `end > start`
  - → matches `calculateLayout(`
  - → matches `/drawImage\(\s*video,\s*layout\.x,\s*layout\.y,\s*layout\.width,\s*layout\.height\s*\)/`
  - → matches `/RECAP_FRAME_BACKGROUND/`
- the live video region, sliced from `} else if (video.readyState >= 2) {` to `} else if (lastFrameCanvas) {`
  - → both markers are found and `end > start`
  - → matches `/RECAP_FRAME_BACKGROUND/`
  - → `region.indexOf('if (layout)')` is `>= 0` and is less than `region.indexOf('drawImage(video,')` (the null guard wraps the draw)
- the tailing region, sliced from `if (step.type === 'tailing') {` to the first `return;` after it
  - → matches `/captureLastFrame\(/`
  - → still matches `/111318/` (the no-frame-ready fallback)
- the advance region, sliced from `if (shouldAdvance) {` to `if (stepIndex < plan.length || isTailing) {`
  - → matches `/captureLastFrame\(/`

In `src/modules/video/after-video-wiring.test.js`, the `drawLoop` region sliced from `function drawLoop() {` to `function beginPlayback(loop) {`:

- → matches `/calculateLayout\(/`
- → matches `/RECAP_FRAME_BACKGROUND/` (one fill colour for the frame background, not a second magic literal)
- → `region.indexOf('if (layout)')` is `>= 0` and is less than `region.indexOf('drawImage(video,')` (presence is not containment: the guard is null-safe only if the check comes first)
- → still matches `/loop\.lastTime/` after the draw (the re-lock code was not skipped)

Both new guards must be proven able to fail: temporarily restore an inline `drawImage(video, 0, 0, canvas.width, canvas.height)` and confirm the new assertions are the ones that go red.

## Technical Context

- No new dependency and no version bump. `mediabunny` 1.50.8 is already the transcode layer; its `Conversion.init` with no `video` options defaults output `width`/`height` to the input's natural display dimensions, and `fit` only applies when both are set (`node_modules/mediabunny/dist/modules/src/conversion.d.ts`).
- Test runner: Vitest (jsdom project config in `vitest.config.js`). `video-processor-logic.js` is imported directly by its test file; `video-processor.web.js` cannot be imported (module-scope `import.meta.glob`, `document`) and is asserted as source text — the pattern already used by `video-processor-web-guard.test.js`.
- `video-processor-logic.js` carries a platform-agnostic guard (`video-processor-logic.test.js:1103`): no `window`/`document`/`navigator` identifiers (comments stripped) and no `http(s)://` in the raw source. The new exports must respect both.
- `after-video-wiring.test.js` asserts `controllerRaw` contains `calculateLayout(` — keeping that call (and adding the null guard around it) satisfies it.
- Commands: `npx vitest run src/modules/video` then `npm run lint`.

## Notes

- Do not quote the removed call verbatim in a code comment. The guard asserts `not.toMatch(/drawImage\(\s*video,\s*0,\s*0,/)` on the raw source (repo rule: scheme/token guards must not be comment-stripped), so a comment containing `drawImage(video, 0, 0, …)` would keep the guard permanently green.
- The freeze frame stays `contain` (whole frame, bars), not `cover`: it is a frozen copy of the frame the viewer just saw, which was drawn with `calculateLayout`. Any other geometry would reintroduce a visible jump.
- `TAILING_DURATION_MS` is 2000 (`video-processor-logic.js:11`); the outro card is the most visible place a stretched frame appeared, so verify the fix on a lesson whose last segment aspect differs from the recap canvas if one is available locally (a mismatch is data-dependent, not device-dependent).
- The Cloudinary upload preset (`CLOUDINARY_UPLOAD_PRESET = 'default'`, `video-share.web.js:10`) is account configuration and is not inspectable from this repo; the code adds only `f_mp4`. If a stretched *published* complete video is ever traced to the fallback transcode path rather than to the freeze frame, inspect that preset's incoming transformation in the Cloudinary dashboard before changing code.
