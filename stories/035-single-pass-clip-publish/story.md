# Publish per-segment clips from the single render pass (background-safe)

## Context

On Android, a learner who finishes a lesson — the concatenated recap renders successfully — and then backgrounds Chrome (e.g. opens WhatsApp to send the video) or closes the tab finds that only the **first** per-segment R2 clip was uploaded. A friend opening the share link then has no question clips to fetch.

Root cause: the per-segment publish is a **second, post-ready render pass** driven by `requestAnimationFrame`.

- `SuccessButtons.runProcessing` marks the success video `ready` (`setVideoState('ready')`, `SuccessButtons.jsx:88`) and only afterwards `await`s `exportSegmentsToR2(lessonId)` (`SuccessButtons.jsx:102`). So the share/download UI is available while the export is still running.
- `exportSegmentsToR2` re-renders every publishable webcam step via `renderStepToBlob` → `executeRenderLoop` (`video-processor.web.js:1298-1345`). That loop's only scheduler is `requestAnimationFrame` (`video-processor.web.js:767`).
- Hidden tabs suspend `requestAnimationFrame`, so the pass strands on the second segment; closing or OS-discarding the tab destroys it. The first segment (already recorded) uploaded; the rest never did.

Fix: capture each publishable clip **during the existing single `processVideo` pass** (the pass the learner watches to completion), then transcode + upload the captured blobs and reveal the share UI only once uploads finish. The upload phase uses `transcodeToMp4WithFallback` + `fetch`, neither of which is `requestAnimationFrame`-gated, so it keeps running while the tab is backgrounded and alive.

## Out of Scope

- The friend-link / friend-response notification silently not being created when the export never completes — separate story.
- Any resume or retry-on-next-open mechanism. The requirement is completion while the page stays alive, not recovery on a later visit.
- Completing uploads after the OS force-closes, freezes, or discards the tab. In-page JavaScript cannot survive that in all browsers; documented as a Known Limitation.
- Overlapping transcode/upload with the render pass, or parallelising the per-segment uploads.
- React Native parity beyond keeping `video-processor.native.jsx`'s `exportSegmentsToR2` stub returning the `{ count, succeeded, askPublished }` shape.
- Changing R2 keys, the 48h TTL, `MAX_R2_UPLOAD_BYTES`, or `functions/api/upload-segment.js`.
- Uploading the raw per-step recordings instead of the rendered clips (would drop the burned-in subtitles).
- Note: if the learner backgrounds the tab during the **render pass itself**, the pass still stalls (pre-existing `requestAnimationFrame` behavior) and no clips are captured. Not addressed here.

## Implementation approach

### 1. Capture publishable clips during the single pass

- `processVideo(fluencyData, lessonId, displayCanvas, options = {})` gains an options bag and forwards it to `processor.process(...)`. `SuccessButtons` passes `{ captureSegments: publishSegments }`, so guests (who never publish) pay no capture cost.
- `process()` passes capture hooks through the existing `executeRenderLoop` options bag: `onStepStart(step)` and `onStepEnd(step)` (in addition to `overlayVariant`/`shareCta`).
- `executeRenderLoop` invokes `onStepStart(step)` when it begins a step in `nextStep()`, and `onStepEnd(step)` in the `draw()` `shouldAdvance` branch before `stepIndex++`/`nextStep()`, plus in `finish()` if a step is still active. Hooks are optional; when absent the loop is unchanged.
- `process()` implements the hooks against the **same `combinedStream` and `mimeType` already used for the stitched recap**:
  - `onStepStart`: if `captureSegments && isPublishableClip(step)`, create a `MediaRecorder` on `combinedStream` (same `mimeType` handling as the recap recorder), collect `dataavailable` chunks, and `start()`.
  - `onStepEnd`: `stop()` that recorder, resolve its blob on `onstop`, and push a promise into a `segmentPromises` list. Do **not** make the synchronous `draw` loop await it.
  - After `executeRenderLoop` resolves and the stitched recorder stops, `await Promise.all(segmentPromises)` before resolving `process()`. Drop empty blobs.
- `process()` resolves `{ blob, ext, segments }` where `segments` is `Array<{ step, blob }>` in plan order, publishable only (empty array when `captureSegments` is false).
- Error/teardown: if the render throws (the `process()` catch at `:266`), stop any active segment recorder before `cleanup()`/`reject` so no recorder dangles. `finish()` must likewise stop an active segment recorder (using the current `plan[stepIndex]`) before resolving.
- Extract the publishable predicate to the pure logic module as `isPublishableClip(step)` = `!!step && step.type === 'webcam' && !!step.blob && !step.isTextMode`. Use it for the capture gate and defensively in the upload. Unit-test it.

### 2. Upload the captured clips without re-deriving the plan

- `exportSegmentsToR2(lessonId, segments)` keeps its login/`shareCode` guards and its `{ count, succeeded, askPublished }` contract on every return path.
- Build `const publishable = (segments || []).filter(({ step }) => isPublishableClip(step)).map(({ step, blob }) => ({ ...step, segmentBlob: blob }));`. Keep `assignSegmentTargets(publishable, lessonId)` and `buildUgcSegmentKey({ shareCode, courseId, lessonId: targetLessonId, index: segmentIndex })` unchanged, and keep `if (targetLessonId !== lessonId) askPublished = true;`.
- For each item: `transcodeToMp4WithFallback(item.segmentBlob)`, then upload the mp4 and its `getUgcThumbKey(key)` jpg sibling via `uploadSegmentToR2` in a `Promise.allSettled` (thumb failure non-fatal), exactly as today.
- Keep `maybeAssignPosterAvatar({ publishable, succeeded, userData })`.
- Remove all re-derivation: no `getAllSpeechRecordingsForLesson`, no `new VideoRenderPlanner`, no `resolveConfigLanguage`, no `loadProfileImage`, no export canvas/video/audio singletons. The upload phase must contain no `requestAnimationFrame` (it runs after the pass, so it survives a backgrounded-but-alive tab).

### 3. Delete the now-dead second-pass machinery

Delete from `video-processor.web.js`: `renderStepToBlob`, `getOrCreateExportAudioContext`, `getOrCreateExportVideoCanvas`, `getOrCreateExportVideoElement`, and the module vars `exportAudioContext`, `exportVideoCanvas`, `exportVideoElement`, `exportAudioSource`. Verify no remaining references (the main pass keeps its own `initAudio` path). Update the stale comments that mention `renderStepToBlob` (notably the `draw()` advance note at `:757-761` and the export pipeline header at `:1216-1224`).

### 4. Gate the share UI on export completion

In `SuccessButtons.runProcessing`, keep `setSuccessVideoBlob(result.blob)` and the share handler setup where they are, but move `setCanvasVisible(false)`, `setVideoState('ready')`, `setRepeatVisible(true)`, `setContinueVisible(true)` to **after** the `publishSegments` block, so the recap stays in the processing state until the awaited `exportSegmentsToR2(lessonId, result.segments)` resolves. The export stays wrapped in the existing non-fatal `try/catch`, so a thrown export still reveals the video (ready is set unconditionally afterwards). `uploadCompleteVideoToR2(result.blob, lessonId)` stays fire-and-forget inside the publish block; the friend-link/notification calls are left untouched.

### Overlay consequence (product-approved)

Because clips are captured from the same canvas as the recap, the per-segment files now include the recap overlay: the share headline + URL on every frame of `shareCta` lessons (`w`/`wf`), and the opening "CALCULATING FLUENCY" card on the first webcam step of `fluency` lessons. This deliberately supersedes story 001's "friend-facing R2 clips stay CTA-free" constraint; the user approved it. No second canvas is introduced.

## Tasks

### Task 1 - Extract and unit-test the publishable-clip predicate

- `src/modules/video/video-processor-logic.js` source inspected
  - → exports `isPublishableClip(step)`
- `isPublishableClip` unit test (`video-processor-logic.test.js`)
  - → webcam step with a blob and `isTextMode` falsy → `true`
  - → webcam step with `isTextMode: true` → `false`
  - → webcam step with a null/undefined blob → `false`
  - → `type: 'remote'` step → `false`
  - → `type: 'tailing'` step → `false`
  - → `null` / `undefined` → `false`

### Task 2 - Capture publishable clips during the single render pass

- `src/modules/video/video-processor.web.js` source inspected
  - → does not contain `renderStepToBlob`
  - → contains exactly one `await executeRenderLoop(` call site (the recap pass)
  - → `processVideo` accepts a fourth options argument and forwards `captureSegments`
  - → `executeRenderLoop`'s options bag contains `onStepStart` and `onStepEnd`
  - → the capture path calls `isPublishableClip(step)` and constructs a `MediaRecorder` on the shared `combinedStream`
  - → `process()` returns `{ blob, ext, segments }` and awaits the per-step blob promises before resolving
- `src/modules/video/video-processor-web-guard.test.js` source inspected
  - → still contains the existing `overlayVariant`/`resolveOverlayElements`, `isDroppedStep`/`markFirstRenderable`/`URL.revokeObjectURL`, `metadataLoaded`/`step.playFatal`, `detectSafari`, `forceVideoDuration`/`probeClipDurationSec`/`resolveSegmentBounds`, `stalledTimeout`, and no-italic guards (regression: the pass is otherwise unchanged)

### Task 3 - Upload captured clips without re-deriving the plan

- `src/modules/video/video-processor.web.js` source inspected
  - → `exportSegmentsToR2` does not contain `getAllSpeechRecordingsForLesson`
  - → `exportSegmentsToR2` does not contain `new VideoRenderPlanner`
  - → `exportSegmentsToR2` does not contain `requestAnimationFrame`
  - → `exportSegmentsToR2` contains `assignSegmentTargets(publishable, lessonId)` and `buildUgcSegmentKey({ shareCode, courseId, lessonId: targetLessonId, index: segmentIndex })`
  - → `exportSegmentsToR2` contains `transcodeToMp4WithFallback`, `uploadSegmentToR2`, and `getUgcThumbKey(key)`
  - → every early return is `{ count: 0, succeeded: 0, askPublished: false }` and the final return is `{ count: publishable.length, succeeded, askPublished }`
- `src/modules/user/friend-lesson-link-wiring.test.js` (updated)
  - → the SuccessButtons assertion matches `await exportSegmentsToR2(lessonId, result.segments)`
  - → the target/key/`askPublished`/native-stub guards all still pass

### Task 4 - Delete the dead second-pass machinery

- `src/modules/video/video-processor.web.js` source inspected
  - → does not contain `getOrCreateExportAudioContext`
  - → does not contain `getOrCreateExportVideoCanvas`
  - → does not contain `getOrCreateExportVideoElement`
  - → does not contain `exportAudioContext`, `exportVideoCanvas`, `exportVideoElement`, or `exportAudioSource`
  - → `uploadCompleteVideoToR2` is still defined after `exportSegmentsToR2` and still exports `MAX_R2_UPLOAD_BYTES`
- `src/modules/video/video-processor-web-guard.test.js` (updated)
  - → the `renderStepToBlob` overlay-free test is removed
  - → the `resolveConfigLanguage` guard expects exactly one use (in `process()`), not two

### Task 5 - Gate the success/share UI on export completion

- `src/components/widgets/SuccessButtons.jsx` source inspected
  - → within `runProcessing`, `setVideoState('ready')` appears after `await exportSegmentsToR2(`
  - → the export call receives `result.segments`
  - → `uploadCompleteVideoToR2(result.blob, lessonId).catch(` remains inside the `if (publishSegments)` block, not awaited
- `src/modules/video/complete-video-wiring.test.js`, `poster-avatar-wiring.test.js`, `poster-runtime-wiring.test.js`, and `notification-wiring.test.js`
  - → still pass unchanged (or adjusted only where a referenced identifier moved)

### Task 6 - Verification

- `npm test -- --run` (vitest)
  - → the whole suite passes, including the updated guards and the new `isPublishableClip` cases
- `npx playwright test tests/success-concat-button.spec.js tests/success-screen.spec.js` with real Chrome (`channel: 'chrome'`, `agents.md` §5)
  - → passes; the stubbed-processor flows are unaffected

## Technical Context

- Solution is browser-only; the file is `src/modules/video/video-processor.web.js` (resolved via `video-processor.js` → `export * from './video-processor.web.js'`; Vite resolves `.web.js`, `vite.config.js:57`).
- `process()` (`:115-272`) owns `combinedStream` (`:234-237`), `mimeType` (`:239`, via `getSupportedMimeType` `:1192-1213`), and the stitched `MediaRecorder` (`:240`). The per-step recorders reuse `combinedStream`/`mimeType`.
- `executeRenderLoop` (`:333-774`): step advance is the `shouldAdvance` branch (`:733-764`); `finish()` is `:350-358`; the terminal `requestAnimationFrame(draw)` schedule is `:766-768`.
- Plan steps are produced by `VideoRenderPlanner.generatePlan` (`video-processor-logic.js:258-333`): webcam steps carry `blob`, `thumbBlob`, `trim`, `isTextMode`, `isFirst`, and `publishLessonId`; remote/tailing steps do not.
- Existing upload primitives, unchanged: `transcodeToMp4WithFallback` (`:1278-1296`), `uploadSegmentToR2` (`r2-upload.web.js:25-52`), `buildUgcSegmentKey` (`video-processor-logic.js:219-221`), `getUgcThumbKey` (`video-url.js:40-43`), `maybeAssignPosterAvatar` (`../avatar/poster-avatar.js`).
- Tests that constrain this refactor: `video-processor-web-guard.test.js`, `friend-lesson-link-wiring.test.js`, `poster-avatar-wiring.test.js` (slices `exportSegmentsToR2` → `export { MAX_R2_UPLOAD_BYTES };`), `poster-runtime-wiring.test.js` (`getUgcThumbKey(key)`, `step.thumbBlob`, `contentType: 'image/jpeg'`), `complete-video-wiring.test.js` (order + fire-and-forget), `notification-wiring.test.js`.
- No new dependencies. `mediabunny` (`^1.50.8`) already provides the transcode; `getSupportedMimeType`, `transcodeToMp4WithFallback`, and the R2 client are already in the repo.
- Metrics: `publish_clips_batch_start` / `publish_clips_batch_done` / `publish_clips_segment_success` / `publish_clips_segment_failed` are unchanged; the added `requestAnimationFrame`-free upload phase is what makes batch completion survive backgrounding.
- Verification commands: `npm test -- --run` (vitest 4.1.6); `npx playwright test <spec> --project=...` with `channel: 'chrome'` (Playwright ^1.60.0).

## Notes

- **Product change (approved):** per-segment clips now inherit the recap overlay instead of being CTA-free / card-free. This is the intended cost of using one render pass, and it overrides story 001's clips-stay-CTA-free acceptance. `docs/product.md` must be updated to reflect it.
- **Background guarantee boundary:** uploads complete while the page remains alive, including when backgrounded or unfocused. They cannot survive an OS force-close, freeze, or tab discard in all browsers, and resume-on-next-open is explicitly not a mechanism. Record this as a Known Limitation in `docs/product.md`.
- **Non-automatable verification:** the full MediaRecorder/R2 path cannot run headlessly. After implementation, manually verify on a real Android device: finish a lesson, immediately switch to WhatsApp during the "Generating/uploading" state, return, and confirm all `response-NN.mp4` clips plus their `.jpg` siblings exist in R2 and the share UI is revealed only after they do. The regression that motivated this story — only the first clip present — must not reproduce.
- Keep the `console.warn`/`console.log` success/failure logging convention (`agents.md` §2) in the refactored capture and upload paths; the existing `[ExportSegments]` logs are expected by reviewers.
- **Concurrent `MediaRecorder` risk:** recording the recap (`combinedStream`) and a per-step segment recorder from the same stream is spec-allowed, but if any target browser rejects a second simultaneous recorder, fall back to a fresh segment stream built from `videoCanvas.captureStream(30)` plus `audioDestination.stream.getAudioTracks()`. Isolate the stream choice behind one helper so the fallback is a one-line change. The segment recorder must still be stopped and its blob collected on `onstop`.
- `exportSegmentsToR2` must keep **three** early-return paths returning `{ count: 0, succeeded: 0, askPublished: false }` (not logged in, no `shareCode`, no publishable clips) so `friend-lesson-link-wiring.test.js` keeps passing.
- Do not add a second render canvas or a `visibilitychange`/wake-lock mechanism — the single-pass capture plus the gate is the agreed design.
