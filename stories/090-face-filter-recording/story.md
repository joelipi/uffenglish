# Spike: URL-flagged Jeeliz face filter in live lesson recording

## Context

Before building any UI, localization, or product surface for privacy filters, we need to verify on real physical devices (Android, iOS, Windows) whether Jeeliz FaceFilter can run inside the real lesson recording pipeline alongside MediaRecorder and Whisper without crashing, lagging, or breaking iOS recording.

This story adds a minimal, URL-flagged (`?filter=mask` or `?filter=blur`) hook directly into `createPortraitCaptureStream` in `src/modules/speech/speech.web.js` so the operator can open any real lesson on their own devices, record takes, and run the end-of-lesson video concatenation to see how the device handles it. When `?filter` is absent, the app behaves 100% identically to today.

## Out of Scope

- Filter picker UI, buttons, or store state.
- Localization / `strings.js` entries.
- Playwright browser specs.
- Sticky session preferences or user-facing error banners.

## Implementation approach

- **Activated only by URL query parameter:** Read `new URLSearchParams(window.location.search).get('filter')` via a small pure helper in `src/modules/speech/portrait-capture-logic.js` (`resolveFilterModeFromSearch(search)` returning `'none' | 'blur' | 'mask'`).
- **Opt iOS into the portrait composite canvas ONLY when a filter is active:** Update `shouldUsePortraitCapture({ isIOS, filterMode })` so that when `filterMode === 'none'`, iOS still uses the raw camera stream as today, and when `filterMode` is `'blur'` or `'mask'`, iOS also routes through `createPortraitCaptureStream` so the filter can be tested on iPhone.
- **Two-canvas architecture (no WebGL/2D collision, no second camera stream):**
  - Keep `compositeCanvasEl` as a `'2d'` canvas (`720×1280` @ 24fps on phones, `1080×1920` @ 30fps on desktop).
  - When `filterMode !== 'none'`, create a small hidden WebGL canvas (`256×256`) for `JEELIZFACEFILTER.init({ canvas: trackerCanvas, NNC: NN_VERYLIGHT_1, maxFacesDetected: 1, videoSettings: { videoElement: compositeVideoEl } })` after `compositeVideoEl` has started playing (`loadeddata`). Passing `videoElement: compositeVideoEl` reuses the already-opened camera stream so Jeeliz never calls `getUserMedia` a second time.
- **Cross-browser 2D drawing in `tick()`:**
  - First draw the cropped camera frame onto `compositeCanvasEl` as today.
  - If `filterMode === 'blur'`, blur the detected face box (or full frame if no face is detected) using downscale-upscale interpolation through a tiny offscreen 2D canvas (`imageSmoothingEnabled = true`), avoiding `ctx.filter = 'blur()'` which is unsupported on iOS Safari.
  - If `filterMode === 'mask'` and `detectState.detected > 0.5`, draw a simple built-in mask graphic (e.g. a procedural carnival mask / emoji shape drawn with Canvas2D paths so no external image asset is needed) over the face box (`x, y, s` mapped to canvas coordinates).
- **Clean teardown before Whisper runs:** Inside `teardownPortraitCapture()`, call `JEELIZFACEFILTER.destroy()` and remove the hidden WebGL tracker canvas so WebGL memory is freed at the exact same moment the composite canvas is released (before Whisper transcription starts). If Jeeliz fails to init or loses its GL context, log a warning and keep recording the unfiltered canvas frame.

## Tasks

### Task 1 - URL flag helper and Jeeliz composite spike

- `resolveFilterModeFromSearch('')` and unknown values + called in unit test
  - → returns `'none'`
- `resolveFilterModeFromSearch('?filter=blur')` and `resolveFilterModeFromSearch('?filter=mask')` + called in unit test
  - → returns `'blur'` and `'mask'` respectively
- `faceBoxToCanvasRect({ faceBox, videoWidth, videoHeight, crop, canvasWidth, canvasHeight })` + called in unit test
  - → converts normalized Jeeliz coordinates (`x, y` in `[-1, 1]`, `s` in `[0, 1]`, relative to the CAMERA frame) into a pixel `{ rx, ry, rw, rh }` on the composite canvas, mapped through the same `compositeCropRect` the frame is painted with (device testing showed mapping straight onto the 9:16 canvas puts the mask off the face on a landscape camera)
- detector drops the face for less than the hold window + `createFaceBoxTracker().current(now)`
  - → returns the last confident box (no blink)
- detector drops the face for longer than the hold window + `current(now)`
  - → returns `null`

## Notes

- No Playwright tests. The owner will test manually on physical devices by appending `?filter=blur` or `?filter=mask` to a lesson URL.
- Remember to add any modified/created file paths to the `allowlist` in `src/modules/video/recorder-page.test.js` so `npx vitest run` stays green.
