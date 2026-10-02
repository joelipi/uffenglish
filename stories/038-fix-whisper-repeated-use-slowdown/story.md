# Stop the voice-answer (Whisper) pipeline from accumulating resources across steps

## Context

This is a voice-first lesson app. Every response step records the webcam/mic, trims the audio, sends it to a single long-lived Whisper Web Worker, and stores the video recording. The reporter says the app gets slower with repeated use and suspects that past Whisper uses keep consuming memory after each step finishes.

Investigation of the actual code found that the **Whisper engine itself does not accumulate**:

- `src/workers/whisper/whisper-worker-web.js` creates one `recognizer`/`vad` and calls `stream.free()` per transcription (`:189`).
- `src/workers/whisper/whisper-worker-demo.js` builds one `transcriber` pipeline and reuses it.
- `src/workers/whisper/app-vad-asr-web.js` uses a single-slot `transcriptionResolve` that is cleared on every result (`:50-55`) and in `terminate()` (`:157-160`); its `vadResolvers` map is only used by the VAD path, which the orchestrator does not call (`speech-orchestrator.js:376` uses `trimSilenceWithPadding` instead).
- `src/modules/speech/speech.web.js` closes the previous `AudioContext` and clears `localRawAudioChunks` each cycle (`:257`, `:276-284`, `:372-403`).

The accumulation is in the **per-step state that runs on every voice step**, which is why it looks like "Whisper keeps absorbing resources":

1. `src/modules/store/store.js:420` stores `playbackSpeechCamChunks` — the raw `MediaRecorder` chunk array, a second copy of the just-recorded video — from `speech.web.js:212`. Nothing ever reads `playbackSpeechCamChunks` (grep: only the store writes/clears it), so it is retained memory on every step.
2. `src/modules/speech/speech-orchestrator.js:223` creates a `readyInterval` (1 s) every time the mic is tapped while the engine is not ready. It is a local `const`, not stored on `listeningState`, so `loadStep`'s reset (`step-executor-webonly.js:76-83`) cannot clear it and repeated taps pile up intervals that poll the store and call stale `onEngineReady` callbacks.

This story bounds those two, so a long lesson no longer grows its retained footprint with each voice answer.

## Out of Scope

- **Recording retention in `recordingsMap` is deliberate and is not changed here.** Each recording is intentionally kept for the current session so the end-of-lesson recap has every step's recording, and the timestamp+seq key that lets a retry add an additional entry is known and accepted. Do not key recordings by step.
- **Whisper engine / WASM changes.** No worker recycling, no WASM heap cap, and no `@huggingface/transformers` / `onnxruntime-web` upgrade. The prod worker already posts `WASM grow` diagnostics; if slowdown persists after this story, measure that first (see Notes) before adding recycling.
- **Recap/export media retention** in `src/modules/video/video-processor.web.js`: `step.decodedAudio` / `step.remoteBlob` retained on render-plan segments (`:562`, `:1223`, `:1226`), and the probe object URL at `:158` that is never revoked. Separate recap-path cleanup.
- **`PlaybackVideo`'s `IntersectionObserver`** (`src/components/PlaybackVideo.jsx:50`) not being disconnected on unmount, and the object URL created in `handleVideoError` (`:31`).
- **Lesson-scoped metric arrays** (`interactionLog`, `recognizedIdioms`, `pragmaticFlags`, `responsesGiven`, `repeatPointsHistory`, `rolePlayPointsHistory`) and the zustand `persist` middleware's localStorage serialization on every `set()`.
- Changing which steps use Whisper, transcription quality, or the review UI.

## Implementation approach

- **Drop the dead chunk copy.** Remove `playbackSpeechCamChunks` everywhere it appears: initial state (`store.js:205`), `setPlaybackBlob` (`:420`), `clearPlaybackBlob` (`:421`), `resetForNextStep` (`:544`), `resetForNewLesson` (`:564`). Change `setPlaybackBlob` to `(blob, autoplay = false)` and update the single caller `speech.web.js:212` to `setPlaybackBlob(blob, autoplay)`. Keep `playbackBlob` and `playbackAutoplay`. Do not touch `recordingsMap` or `saveSpeechRecording`'s recording key.
- **Track the readiness poll.** Add `readyPoll: null` to `listeningState` (`speech-orchestrator.js:35`). Replace the inline `setInterval` at `:223-231` with a `startReadyPoll(button, uiHooks)` that first calls `clearReadyPoll()` then stores the new interval in `listeningState.readyPoll`; `clearReadyPoll()` does `clearInterval(listeningState.readyPoll)` and nulls it. Call `clearReadyPoll()` at the top of `toggleSpeechRecognition` (next to the existing `hesitationTimer` cleanup at `:172-176`) and have the step reset in `step-executor-webonly.js:76-83` also clear `listeningState.readyPoll`. The poll still clears itself on `isWhisperReady` / `isWhisperEngineFailed`, and must null `listeningState.readyPoll` when it does.
- **No new dependencies.** All tests are Vitest (jsdom); the orchestrator is a factory with injected deps, so no module mocking is needed.

## Tasks

### Task 1 - The raw recording-chunk copy is no longer retained

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
- (source guard) `playbackSpeechCamChunks` appears in no non-test file under `src/` (only `store.test.js` may reference it), and `src/modules/speech/speech.web.js` calls `setPlaybackBlob(blob, autoplay)` with exactly two arguments

### Task 2 - At most one Whisper readiness poll is live

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

### Task 3 - Repeated-use resource regression guard

Cover in a new `src/modules/speech/repeated-use-resource.test.js` using `vi.useFakeTimers()` and `createSpeechOrchestrator` with the same fake deps as Task 2.

- simulate a long lesson: 5 sequential `toggleSpeechRecognition` calls while `isWhisperReady` is false, advancing 1000 ms between each
  - → each call schedules at most one pending 1000 ms timer (never more than one live at a time, independent of the number of taps)
  - → `onEngineReady` is not called while `isWhisperReady` stays false
- flip `isWhisperReady` to `true` and advance 1000 ms
  - → `onEngineReady` is called exactly once, and no pending 1000 ms timer remains
- after the sequence, no pending timers remain (`vi.getTimerCount()` is 0 for the 1000 ms poll)

## Technical Context

No new packages. Existing pinned versions: Vitest `^4.1.6` (jsdom `^29.1.1`) for unit tests, Playwright `^1.60.0` for the `tests/` specs, Zustand `^5.0.13`, React `^19.2.0`, `@huggingface/transformers` `^3.8.1`, `onnxruntime-web`(dev) `^1.17.3`. Test conventions: `vitest.config.js` uses `environment: 'jsdom'` and excludes `tests/**` and `*.spec.js`; unit tests live beside source as `*.test.js`. `appStore` is a singleton (`src/modules/store/store.js`), so tests mutate it with `appStore.setState`, matching `store.test.js`. `createSpeechOrchestrator` is a factory taking all side-effect deps, so no module mocking is needed for the orchestrator tests. `speech.web.js` is web-only and imports browser globals at module load (`navigator`), so do not import it in unit tests — assert its call-site shape with a source guard instead.

## Notes

- The remaining, unproven suspect for persistent slowdown is the Whisper worker's WASM heap. The prod worker `memory.grow` wrapper (`whisper-worker-web.js:91-104`) already posts `WASM grow: X MB -> Y MB` diags that the adapter logs (`app-vad-asr-web.js:34-36`). Before adding worker recycling, capture those diags across a long lesson and confirm monotonic growth; recycling can reuse the existing `terminate()` + `rebindWorker()` + `preloadWhisperEngine()` path from `src/modules/speech/speech.js`.
- The orchestrator's `transcriptionResolve` is a single slot, so overlapping transcriptions would drop the first promise. The orchestrator serializes voice toggles via `listeningState.transitioning`, so this is not reachable today; it is documented here so a future caller does not introduce the bug.
- Recording cannot be exercised headlessly (no microphone), so Playwright cannot validate these fixes; the acceptance criteria are Vitest tests plus source guards.
