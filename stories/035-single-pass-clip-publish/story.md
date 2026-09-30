# Publish per-segment clips by trimming the single render recording

## Context

On Android, a learner who finishes a lesson (the concatenated recap renders successfully) and then backgrounds Chrome (e.g. opens WhatsApp to send the video) or closes the tab finds that only the **first** per-segment R2 clip was uploaded, so a friend opening the share link has no question clips to fetch.

Root cause: the per-segment publish is a **second, post-ready real-time render pass** that is `requestAnimationFrame`/canvas bound:

- `SuccessButtons.runProcessing` sets the success video `ready` (`SuccessButtons.jsx:88`) and only then `await`s `exportSegmentsToR2` (`:102`), so the share/leave UI is available while the export is still running.
- `exportSegmentsToR2` re-renders every publishable webcam step via `renderStepToBlob` → `executeRenderLoop` and records it with `MediaRecorder` (`video-processor.web.js:1298-1345`). `MediaRecorder` records at 1× real time, and the draw loop is scheduled only by `requestAnimationFrame` (`:767`).
- Hidden tabs suspend `requestAnimationFrame` **and** `canvas.captureStream()` yields empty frames for an uncomposited canvas, so the pass strands after the first segment; closing/discarding the tab destroys it. The first segment (already recorded) uploaded; the rest never did.

The recap pass has already rendered every frame of the lesson into a single stitched recording (`result.blob`). That recording already carries the 1080×1920 composite and the burned overlay/subtitles. So the per-segment clips do not need to be re-rendered — they can be **cut out of that recording**.

Fix: during the single recap pass, record each publishable webcam step's time range within the recording; afterwards, derive each segment by **trimming the stitched recording** with `mediabunny` (`WebCodecs`, off the canvas), then upload. No second playback, one encoder, no concurrent encoders. Trim + transcode + upload use `WebCodecs`/`fetch`, which are not `requestAnimationFrame`/canvas bound, so they survive a backgrounded-but-alive tab and the existing `ready` timing can stay as it is today.

## Out of Scope

- Changing the recap render, its overlay, or its timing (`ready` stays where it is today).
- Approach 3 (capturing segments with a concurrent second `MediaRecorder` during the pass) — rejected for device encoder-concurrency risk.
- Any resume/retry queue or persistence; if the OS force-closes, freezes, or discards the tab, in-flight work is lost and there is no cross-browser recovery. Documented as a Known Limitation.
- Uploading raw recordings, or rendering subtitles outside the clip (raw upload loses the mandatory 1080×1920 composite and the burned, often dynamic, cue).
- Changing R2 keys, the 48h TTL, `MAX_R2_UPLOAD_BYTES`, or `functions/api/upload-segment.js`.
- React Native parity beyond keeping `video-processor.native.jsx`'s `exportSegmentsToR2` stub returning the `{ count, succeeded, askPublished }` shape.

## Implementation approach

### 1. Capture each publishable step's time range during the single pass

- `executeRenderLoop`'s options bag gains optional `onStepStart(step)` / `onStepEnd(step)` callbacks. `onStepStart` fires when a step's playback actually begins (`stepStartedPlaying = true`, after `video.play()` resolves); `onStepEnd` fires in the `draw()` `shouldAdvance` branch before `stepIndex++`/`nextStep()`, and in `finish()` if a step is still active. Hooks are optional; when absent the loop is unchanged.
- `process()` records `const recordingStartAt = performance.now()` immediately before `recorder.start(1000)`. It wires the hooks to collect `{ step, startMs: t0 - recordingStartAt, endMs: t1 - recordingStartAt }` for steps where `isPublishableClip(step)` is true, calibrates them, and resolves `{ blob, ext, segments }` with `segments: Array<{ step, startSec, endSec }>`.
- Because the recorder can begin a little after `recorder.start()`, calibrate the raw wall-clock ranges against the recording's real length: after the loop, `probedDurationSec = await probeClipDurationSec(blob)` (already imported from `./transcode.js`), `elapsedMs = performance.now() - recordingStartAt`, and shift every range by `offsetSec = elapsedMs/1000 - probedDurationSec`. Extract this as the pure helper `calibrateSegmentRanges(rawRanges, elapsedMs, probedDurationSec)` in `video-processor-logic.js`, returning `{ step, startSec, endSec }` per surviving range, and unit-test it. If the probe returns `null`/0, the helper returns the raw ranges (ms→s) unchanged.

### 2. Trim the stitched recording into mp4 segments

- Add `transcodeRangeToMp4(sourceBlob, startSec, endSec)` to `src/modules/video/transcode.web.js`, mirroring `reencodeToMp4` but with `Conversion.init({ input, output, trim: { start: startSec, end: endSec } })` (`mediabunny.d.ts:1042-1057`; `start`/`end` are seconds into the input file). Use `new BlobSource(sourceBlob)` (not `BufferSource(await blob.arrayBuffer())`) so the whole stitched recording is not copied into memory. Keep the H.264/AAC encodability check and throw `webcodecs-unavailable` when it fails. Output `Mp4OutputFormat` → `video/mp4` Blob.
- The stitched recording may be `mp4` or `webm` depending on browser; the trim re-encodes regardless, so the segment output is always mp4.

### 3. Upload in `exportSegmentsToR2(lessonId, segments, stitchedBlob)`

- Keep the login/`shareCode` guards and the `{ count, succeeded, askPublished }` contract on every return path (three early returns).
- Build `const publishable = (segments || []).filter(({ step }) => isPublishableClip(step)).map(({ step, startSec, endSec }) => ({ ...step, rangeStartSec: startSec, rangeEndSec: endSec }))`; keep `assignSegmentTargets(publishable, lessonId)`, `buildUgcSegmentKey({ shareCode, courseId, lessonId: targetLessonId, index: segmentIndex })`, `if (targetLessonId !== lessonId) askPublished = true;`, and `maybeAssignPosterAvatar({ publishable, succeeded, userData })` unchanged.
- Per segment: `transcodeRangeToMp4(stitchedBlob, rangeStartSec, rangeEndSec)` → upload mp4 + `getUgcThumbKey(key)` jpg sibling via `uploadSegmentToR2` in `Promise.allSettled` (thumb failure non-fatal). Drop ranges shorter than a floor (e.g. 0.4s) as failed-load artifacts.
- Fallback when `transcodeRangeToMp4` throws `webcodecs-unavailable` or fails: use the existing `renderStepToBlob` + `transcodeToMp4WithFallback` path for that segment (proven on no-`WebCodecs` browsers). Pass the lesson's `overlayVariant`/`shareCta` to `renderStepToBlob` so the fallback clip carries the same overlay as the trimmed primary (supersedes story 001's clips-stay-CTA-free constraint, per the product decision below).
- No `requestAnimationFrame` and no `MediaRecorder` in the primary path.

### 4. Wiring (`SuccessButtons.jsx`)

Call `await exportSegmentsToR2(lessonId, result.segments, result.blob)` from the existing publish block. Keep `setVideoState('ready')` and the repeat/continue visibility exactly where they are today — the trim path is background-safe, so no gate is introduced. The existing non-fatal `try/catch` and `uploadCompleteVideoToR2(result.blob, lessonId)` fire-and-forget call stay.

### Overlay consequence (product-approved)

Segments trimmed from the recording inherit the recap overlay: the share headline + URL on `shareCta` lessons (`w`/`wf`) and the opening "CALCULATING FLUENCY" card on the first webcam step of `fluency` lessons. This supersedes story 001's CTA-free constraint; the user approved it. Recovery is complete because the 1080×1920 composite and burned (dynamic) cues are preserved.

## Tasks

### Task 1 - Pure helpers in `video-processor-logic.js`

- `isPublishableClip(step)` exported and unit-tested
  - → webcam step with a blob and `isTextMode` falsy → `true`
  - → webcam with `isTextMode: true` → `false`
  - → webcam with null/undefined blob → `false`
  - → `remote` / `tailing` step → `false`
  - → `null` / `undefined` → `false`
- `calibrateSegmentRanges(rawRanges, elapsedMs, probedDurationSec)` exported and unit-tested
  - → `probedDurationSec` null/0 → ranges returned as seconds, unchanged
  - → recording shorter than elapsed wall-clock (`offsetSec > 0`) → every range shifted earlier by `offsetSec`
  - → a range whose shifted start would be negative → clamped to 0
  - → a range whose shifted end exceeds `probedDurationSec` → clamped to `probedDurationSec`
  - → ranges shorter than the floor (0.4s) → dropped
  - → input `null`/`[]` → `[]`

### Task 2 - Capture ranges during the single pass

- `src/modules/video/video-processor.web.js` source inspected
  - → `executeRenderLoop`'s options bag contains `onStepStart` and `onStepEnd`
  - → `onStepStart` is invoked after playback starts (near `stepStartedPlaying = true` / `video.play`), `onStepEnd` in the `shouldAdvance`/`finish` paths
  - → `process()` sets `recordingStartAt` before `recorder.start(` and returns `{ blob, ext, segments }` with `{ step, startSec, endSec }` entries
  - → the capture path gates on `isPublishableClip(step)` and calls `calibrateSegmentRanges(`
  - → contains exactly one `await executeRenderLoop(` (the recap pass); the fallback `renderStepToBlob` remains
- `video-processor-web-guard.test.js` source inspected
  - → existing guards for `isDroppedStep`/`markFirstRenderable`/`URL.revokeObjectURL`, `metadataLoaded`/`step.playFatal`, `detectSafari`, `forceVideoDuration`/`probeClipDurationSec`/`resolveSegmentBounds`, `stalledTimeout`, overlay/no-italic remain
  - → the `resolveConfigLanguage` guard expects one use (in `process()`), not two

### Task 3 - Range transcode in `transcode.web.js`

- `src/modules/video/transcode.web.js` source inspected
  - → exports `transcodeRangeToMp4(sourceBlob, startSec, endSec)`
  - → it calls `Conversion.init(` with a `trim: {` option and a `BlobSource`
  - → it throws `webcodecs-unavailable` when WebCodecs is absent and returns a `video/mp4` Blob otherwise

### Task 4 - Trim-based export with fallback

- `src/modules/video/video-processor.web.js` source inspected
  - → `exportSegmentsToR2` accepts the captured segments and the stitched source blob
  - → the primary path contains `transcodeRangeToMp4(` and does not contain `requestAnimationFrame`
  - → the fallback path contains `renderStepToBlob(` and `transcodeToMp4WithFallback(`
  - → `assignSegmentTargets(publishable, lessonId)`, `buildUgcSegmentKey({ shareCode, courseId, lessonId: targetLessonId, index: segmentIndex })`, `getUgcThumbKey(key)`, `step.thumbBlob`, `contentType: 'image/jpeg'`, and `if (targetLessonId !== lessonId) askPublished = true;` all remain
  - → every early return is `{ count: 0, succeeded: 0, askPublished: false }` and the final return is `{ count: publishable.length, succeeded, askPublished }`
- `src/modules/user/friend-lesson-link-wiring.test.js` (updated)
  - → the SuccessButtons assertion matches `await exportSegmentsToR2(lessonId, result.segments, result.blob)`
  - → the target/key/`askPublished`/native-stub guards all still pass
- `video-processor-web-guard.test.js`
  - → the old "renderStepToBlob is overlay-free" assertion is replaced by one asserting the fallback is invoked with the lesson's overlay options

### Task 5 - Wiring + regression guards

- `src/components/widgets/SuccessButtons.jsx` source inspected
  - → `runProcessing` calls `exportSegmentsToR2(lessonId, result.segments, result.blob)`
  - → `setVideoState('ready')` appears before `await exportSegmentsToR2(` (unchanged ordering; no gate is added)
  - → `uploadCompleteVideoToR2(result.blob, lessonId).catch(` remains inside the `if (publishSegments)` block, not awaited
- `complete-video-wiring.test.js`, `poster-avatar-wiring.test.js`, `poster-runtime-wiring.test.js`, `notification-wiring.test.js`
  - → still pass (adjusted only where a referenced identifier moved)

### Task 6 - Verification

- `npm test -- --run` (vitest)
  - → the whole suite passes, including the new `isPublishableClip` and `calibrateSegmentRanges` cases and the updated guards
- `npx playwright test tests/success-concat-button.spec.js tests/success-screen.spec.js` with real Chrome (`channel: 'chrome'`, `agents.md` §5)
  - → passes; the stubbed-processor flows are unaffected

## Technical Context

- Browser-only; the file is `src/modules/video/video-processor.web.js` (via `video-processor.js` → `export * from './video-processor.web.js'`; Vite resolves `.web.js`, `vite.config.js:57`).
- `process()` (`:115-272`) owns `combinedStream` (`:234-237`), `mimeType` (`:239`), and the stitched `MediaRecorder` (`:240`). The recorder starts at `:254` and stops at `:264` after `executeRenderLoop` resolves.
- `executeRenderLoop` (`:333-774`): playback start is `stepStartedPlaying = true` (`:575-598`); the advance branch is `:733-764`; `finish()` is `:350-358`; the terminal `requestAnimationFrame(draw)` is `:766-768`.
- `probeClipDurationSec` already exists in `transcode.web.js:75-97` and is imported by `video-processor.web.js` (`:73-76`); `reencodeToMp4` (`:101-134`) is the template for the trim function. `Conversion.init({ input, output })` is already used at `:131`.
- `mediabunny.d.ts` declares `ConversionOptions.trim?: { start?: number; end?: number }` (seconds) at `:1042-1057`; mediabunny uses an unthrottled-timer Web Worker for `MediaStream` sources (so timer throttling does not stall it) and drives `BufferSource`/`BlobSource` conversions through `WebCodecs`, not `requestAnimationFrame`.
- Plan steps come from `VideoRenderPlanner.generatePlan` (`video-processor-logic.js:258-333`); webcam steps carry `blob`, `thumbBlob`, `trim`, `isTextMode`, `isFirst`, `publishLessonId`.
- Existing upload primitives unchanged: `uploadSegmentToR2` (`r2-upload.web.js:25-52`), `buildUgcSegmentKey` (`video-processor-logic.js:219-221`), `getUgcThumbKey` (`video-url.js:40-43`), `maybeAssignPosterAvatar` (`../avatar/poster-avatar.js`), `MAX_R2_UPLOAD_BYTES` (`r2-upload-limits.js`).
- Tests that constrain this refactor: `video-processor-web-guard.test.js`, `friend-lesson-link-wiring.test.js`, `poster-avatar-wiring.test.js` (slices `exportSegmentsToR2` → `export { MAX_R2_UPLOAD_BYTES };`), `poster-runtime-wiring.test.js`, `complete-video-wiring.test.js`, `notification-wiring.test.js`.
- No new dependencies. `mediabunny` (`^1.50.8`) provides trim/transcode; `WebCodecs` is already required by the existing transcode chain.
- Verification commands: `npm test -- --run` (vitest 4.1.6); `npx playwright test <spec>` with `channel: 'chrome'` (Playwright ^1.60.0).

## Notes

- **This is faster than today, not slower.** Today each segment is a 1× real-time `MediaRecorder` replay, and on webm browsers it is then re-encoded by `transcodeToMp4`. Trim removes the replay and does a single `WebCodecs` decode+encode of the range, and skips the per-frame canvas text drawing. On devices that already record mp4 (fast-path transcode) it is a swap of a 1× hardware encode for a faster-than-real-time one; comparable, but no longer visibility-bound.
- **Background guarantee boundary:** trim + transcode + upload are `WebCodecs`/`fetch` (not rAF/canvas), so they complete while the tab is backgrounded but alive. They cannot survive an OS force-close, freeze, or tab discard, and resume-on-next-open is not a mechanism. Record this in `docs/product.md`.
- **Calibration is the accuracy risk.** Step ranges are wall-clock offsets from `recorder.start()` calibrated against the probed recording duration. Validate on real devices that trimmed clips do not clip the first/last words and do not include the preceding model clip. If calibration proves too coarse, tighten with a small safety margin rather than padding (padding pulls in adjacent content).
- **Non-automatable verification:** the full `MediaRecorder`/`WebCodecs`/R2 path cannot run headlessly. After implementation, on real Android and iOS: finish a lesson, immediately switch to WhatsApp during/after the recap, return, and confirm every `response-NN.mp4` plus its `.jpg` sibling exists in R2 and no clip is truncated. The regression that motivated this story — only the first clip present after backgrounding — must not reproduce.
- Keep the `console.warn`/`console.log` success/failure logging convention (`agents.md` §2); the existing `[ExportSegments]` logs are expected by reviewers.
- `docs/product.md` must be updated: the segment-publish mechanism is now "trim the single render recording"; the earlier "single render pass" wording and the CTA-free clip constraint are superseded, and the background boundary becomes a Known Limitation.
