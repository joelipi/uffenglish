# Stop the voice-answer (Whisper) pipeline from accumulating resources across steps

## Context

This is a voice-first lesson app. Every response step records the webcam/mic, trims the audio, sends it to a single long-lived Whisper Web Worker, and stores the video recording. The reporter says the app gets slower with repeated use and suspects that past Whisper uses keep consuming memory after each step finishes.

Investigation of the actual code found that the **Whisper engine itself does not accumulate**:

- `src/workers/whisper/whisper-worker-web.js` creates one `recognizer`/`vad` and calls `stream.free()` per transcription (`:189`).
- `src/workers/whisper/whisper-worker-demo.js` builds one `transcriber` pipeline and reuses it.
- `src/workers/whisper/app-vad-asr-web.js` uses a single-slot `transcriptionResolve` that is cleared on every result (`:50-55`) and in `terminate()` (`:157-160`); its `vadResolvers` map is only used by the VAD path, which the orchestrator does not call (`speech-orchestrator.js:376` uses `trimSilenceWithPadding` instead).
- `src/modules/speech/speech.web.js` closes the previous `AudioContext` and clears `localRawAudioChunks` each cycle (`:257`, `:276-284`, `:372-403`).

The accumulation is in the **per-step state that runs on every voice step**, which is why it looks like "Whisper keeps absorbing resources":

1. `src/modules/storage/storage.web.js:50` keys each recording by `uffvideo_${lessonId}_${stepIndex}_${timestamp}_${seq}`. Re-recording the same step (a retry, or repeated speaking on one question) inserts a **new** Map entry carrying a full video Blob instead of replacing the old one. `recordingDb.js` is already keyed per `(lessonId, stepIndex)`, and `getAllSpeechRecordingsForLesson` dedupes by step at read time (`:104-124`), so the extra in-memory entries are pure waste that grows with every attempt. A TODO at `storage.web.js:37-39` confirms this is known.
2. `src/modules/store/store.js:420` stores `playbackSpeechCamChunks` — the raw `MediaRecorder` chunk array, a second copy of the just-recorded video — from `speech.web.js:212`. Nothing ever reads `playbackSpeechCamChunks` (grep: only the store writes/clears it), so it is retained memory on every step.
3. `src/modules/speech/speech-orchestrator.js:223` creates a `readyInterval` (1 s) every time the mic is tapped while the engine is not ready. It is a local `const`, not stored on `listeningState`, so `loadStep`'s reset (`step-executor-webonly.js:76-83`) cannot clear it and repeated taps pile up intervals that poll the store and call stale `onEngineReady` callbacks.

This story bounds those three, so a long lesson no longer grows its retained footprint with each voice answer.

## Out of Scope

- **Whisper engine / WASM changes.** No worker recycling, no WASM heap cap, and no `@huggingface/transformers` / `onnxruntime-web` upgrade. The prod worker already posts `WASM grow` diagnostics; if slowdown persists after this story, measure that first (see Notes) before adding recycling.
- **Recap/export media retention** in `src/modules/video/video-processor.web.js`: `step.decodedAudio` / `step.remoteBlob` retained on render-plan segments (`:562`, `:1223`, `:1226`), and the probe object URL at `:158` that is never revoked. Separate recap-path cleanup.
- **`PlaybackVideo`'s `IntersectionObserver`** (`src/components/PlaybackVideo.jsx:50`) not being disconnected on unmount, and the object URL created in `handleVideoError` (`:31`).
- **Lesson-scoped metric arrays** (`interactionLog`, `recognizedIdioms`, `pragmaticFlags`, `responsesGiven`, `repeatPointsHistory`, `rolePlayPointsHistory`) and the zustand `persist` middleware's localStorage serialization on every `set()`.
- Changing which steps use Whisper, transcription quality, or the review UI.

## Implementation approach

- **Stable recording identity.** In `saveSpeechRecording` (`storage.web.js:41`), compute `videoKey = `uffvideo_${lessonId}_${stepIndex}`` (no timestamp/seq) and delete the module counter `_nextRecordingSeq` (`:11`, `:49`). `recordingsMap.set(videoKey, record)` then replaces the prior attempt's entry, releasing its Blob. `createdAt` stays so `updateSpeechRecording`'s "latest" sort and `getAllSpeechRecordingsForLesson`'s ordering are unchanged. This matches the IDB key (`recordingDb.putRecord(lessonId, stepIndex, …)`) and the restored-record id (`restored_${lessonId}_${stepIndex}`). No read-path logic changes: `getAllSpeechRecordingsForLesson` still dedupes by step, and its "fresh (non-restored) beats restored" branch is unaffected because in-memory fresh ids no longer start with `restored_`.
- **Drop the dead chunk copy.** Remove `playbackSpeechCamChunks` everywhere it appears: initial state (`store.js:205`), `setPlaybackBlob` (`:420`), `clearPlaybackBlob` (`:421`), `resetForNextStep` (`:544`), `resetForNewLesson` (`:564`). Change `setPlaybackBlob` to `(blob, autoplay = false)` and update the single caller `speech.web.js:212` to `setPlaybackBlob(blob, autoplay)`. Keep `playbackBlob` and `playbackAutoplay`.
- **Track the readiness poll.** Add `readyPoll: null` to `listeningState` (`speech-orchestrator.js:35`). Replace the inline `setInterval` at `:223-231` with a `startReadyPoll(button, uiHooks)` that first calls `clearReadyPoll()` then stores the new interval in `listeningState.readyPoll`; `clearReadyPoll()` does `clearInterval(listeningState.readyPoll)` and nulls it. Call `clearReadyPoll()` at the top of `toggleSpeechRecognition` (next to the existing `hesitationTimer` cleanup at `:172-176`) and have the step reset in `step-executor-webonly.js:76-83` also clear `listeningState.readyPoll`. The poll still clears itself on `isWhisperReady` / `isWhisperEngineFailed`, and must null `listeningState.readyPoll` when it does.
- **No new dependencies.** All tests are Vitest (jsdom); the orchestrator and adapter are factories with injected deps, and the storage module's IDB layer is mocked.

## Tasks

### Task 1 - Re-recording a step replaces its recording instead of adding a blob

Cover in a new `src/modules/storage/storage.web.test.js`, mocking `./recordingDb.js` (`vi.mock`) and setting `appStore` state (`lessonId`, `currentStepIndex`) with `appStore.setState`.

- two `saveSpeechRecording(blobA, { lessonId: 'L', stepIndex: 0 })` calls with different blobs
  - → `getAllSpeechRecordingsForLesson('L')` returns 1 record
  - → that record's `blob` is the second blob, not the first
  - → `recordingsMap` no longer exposes the first blob anywhere returned by `getAllSpeechRecordingsForLesson`
- `saveSpeechRecording(blob, { lessonId: 'L', stepIndex: 0 })` then `saveSpeechRecording(blob, { lessonId: 'L', stepIndex: 1 })`
  - → `getAllSpeechRecordingsForLesson('L')` returns 2 records with distinct `originalStepIndex` values
- re-record after `updateSpeechRecording('L', 0, { userResponse: 'hi' })`
  - → `getAllSpeechRecordingsForLesson('L')` still returns 1 record for step 0
  - → the returned record carries `userResponse: 'hi'` and the new blob
- `clearInMemoryRecordingsForLesson('L')` after two recordings
  - → `getAllSpeechRecordingsForLesson('L')` returns an empty array
- (source guard) `src/modules/storage/storage.web.js` contains no `_nextRecordingSeq`, and its in-memory key is `uffvideo_${lessonId}_${stepIndex}` (no `timestamp`/`seq`)

### Task 2 - The raw recording-chunk copy is no longer retained

Cover in `src/modules/store/store.test.js` (extend the existing file).

- initial store state read
  - → has no own property `playbackSpeechCamChunks`
- `setPlaybackBlob(blob, true)`
  - → `playbackBlob` is `blob` and `playbackAutoplay` is `true`
  - → store has no own property `playbackSpeechCamChunks`
- `clearPlaybackBlob()` after `setPlaybackBlob(blob)`
  - → `playbackBlob` is `null`, `playbackAutoplay` is `false`
- `resetForNextStep()` and `resetForNewLesson()` after `setPlaybackBlob(blob)`
  - → `playbackBlob` is `null`
- (source guard) `grep -r "playbackSpeechCamChunks" src/` returns 0 matches, and `src/modules/speech/speech.web.js` calls `setPlaybackBlob(blob, autoplay)` with exactly two arguments

### Task 3 - At most one Whisper readiness poll is live

Cover in a new `src/modules/speech/speech-orchestrator.test.js` using `vi.useFakeTimers()` and `createSpeechOrchestrator` with fake deps (`startSpeechCamRecording` resolving, `stopSpeechCamRecording` resolving, `getSpeechCamStream: () => null`, `preloadWhisperEngine`, `transcribeAudioBuffer`, `updateSpeechRecording`, and spy `startLocalAudioTap`/`stopLocalAudioTap`). Seed `appStore.setState({ isWhisperReady: false, isWhisperEngineFailed: false })`.

- `toggleSpeechRecognition({ ...params, uiHooks: { onEngineNotReady } })` while the engine is not ready
  - → `onEngineNotReady` is called once
  - → exactly one interval is scheduled (one pending timer at 1000 ms)
- a second `toggleSpeechRecognition` call while still not ready
  - → the first poll is cleared before the second is created (only one pending 1000 ms timer remains)
  - → after `vi.advanceTimersByTime(1000)`, `onEngineReady` is not called while `isWhisperReady` is false
- `appStore.setState({ isWhisperReady: true })` then `vi.advanceTimersByTime(1000)`
  - → `onEngineReady` is called once with the `button` passed to the last toggle
  - → no pending 1000 ms timer remains (poll cleared)
- `appStore.setState({ isWhisperReady: false, isWhisperEngineFailed: true })` then `vi.advanceTimersByTime(1000)`
  - → `onEngineReady` is not called and no pending 1000 ms timer remains
- (source guard) `src/modules/speech/speech-orchestrator.js` stores the poll on `listeningState.readyPoll` and `src/modules/lesson/step-executor-webonly.js` clears `listeningState.readyPoll` in its step reset

### Task 4 - Repeated-use resource regression guard

Cover in a new `src/modules/storage/repeated-use-resource.test.js` (Vitest, mocking `./recordingDb.js`), exercising the sequence a long lesson produces.

- simulate 3 distinct steps, re-recording step 0 three times and step 1 twice, with `updateSpeechRecording` after each
  - → `getAllSpeechRecordingsForLesson('L')` returns exactly 3 records (one per step)
  - → no returned record's `originalStepIndex` appears twice
- reset the store, then `setPlaybackBlob(blobA)` and later `setPlaybackBlob(blobB)` across two steps
  - → only `blobB` is reachable from `playbackBlob` and no chunk array is retained
- (source guard) `grep -rn "recordingsMap.set" src/modules/storage/storage.web.js` shows the only inserts are keyed by the stable `uffvideo_${lessonId}_${stepIndex}` key

## Technical Context

No new packages. Existing pinned versions: Vitest `^4.1.6` (jsdom `^29.1.1`) for unit tests, Playwright `^1.60.0` for the `tests/` specs, Zustand `^5.0.13`, React `^19.2.0`, `@huggingface/transformers` `^3.8.1`, `onnxruntime-web`(dev) `^1.17.3`. Test conventions: `vitest.config.js` uses `environment: 'jsdom'` and excludes `tests/**` and `*.spec.js`; unit tests live beside source as `*.test.js`. `appStore` is a singleton (`src/modules/store/store.js`), so tests mutate it with `appStore.setState`, matching `store.test.js`. `createSpeechOrchestrator` is a factory taking all side-effect deps, so no module mocking is needed for the orchestrator test. The storage module imports `appStore` and `./recordingDb.js`; mock `recordingDb.js` so `idb-keyval` is never touched. `speech.web.js` is web-only and imports browser globals at module load (`navigator`), so do not import it in unit tests — assert its call-site shape with a source guard instead.

## Notes

- `recordingsMap` keeping one recording per step until the lesson ends is intentional: the end-of-lesson recap consumes every step's recording (`video-processor.web.js` → `getAllSpeechRecordingsForLesson`). This story removes the extra copies created by **re-recording**, not the one-per-step retention.
- The remaining, unproven suspect for persistent slowdown is the Whisper worker's WASM heap. The prod worker `memory.grow` wrapper (`whisper-worker-web.js:91-104`) already posts `WASM grow: X MB -> Y MB` diags that the adapter logs (`app-vad-asr-web.js:34-36`). Before adding worker recycling, capture those diags across a long lesson and confirm monotonic growth; recycling can reuse the existing `terminate()` + `rebindWorker()` + `preloadWhisperEngine()` path from `src/modules/speech/speech.js`.
- The orchestrator's `transcriptionResolve` is a single slot, so overlapping transcriptions would drop the first promise. The orchestrator serializes voice toggles via `listeningState.transitioning`, so this is not reachable today; it is documented here so a future caller does not introduce the bug.
- Recording cannot be exercised headlessly (no microphone), so Playwright cannot validate these fixes; the acceptance criteria are Vitest tests plus source guards.
