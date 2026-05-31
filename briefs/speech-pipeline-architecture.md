# Speech Pipeline Architecture & Refactoring Plan

## Origin Notes

**"Demo" mode** (`?demo` URL param, `whisper-worker-demo.js`): This was not the first step toward a Transformers.js migration. It was a separate optimization path for a web-only demo version — a trimmed-down experience users could try before downloading the full app. The Transformers.js `whisper-tiny.en` model is ~40MB vs the Sherpa-ONNX production model's ~110MB. The `?demo` gate was left in place but never activated in production; the codebase always used the full Sherpa-ONNX path. Transformers.js v3 runtime improvements made this viable — see Phase 2 of the execution plan.

**AudioWorklet** (`audio-processor.js`): This pipeline uses `AudioWorklet` (not `ScriptProcessorNode`) for raw PCM capture, running on a dedicated audio rendering thread. It is loaded dynamically via `audioWorklet.addModule()` in `speech.web.js:startLocalAudioTap()`, not through the ES module import system.

## Execution Plan (step by step)

### Phase 1 — Factory Foundation

| Step | Action | Files | Combo? |
|------|--------|-------|--------|
| 1 | Create `speech-orchestrator.js` — deps-injection factory from `speech.shared.js` logic | `js/modules/speech-orchestrator.js` (new), `js/modules/speech.shared.js` (delete) | 5 |
| 2 | Create `createWhisperAdapter({ workerUrl, workerOptions })` factory in `app-vad-asr-web.js` — decouples worker selection from the adapter | `js/workers/whisper/app-vad-asr-web.js` | 5, 6c.1 |
| 3 | Update `speech.js` — wire both factories, choose worker at entry point based on feature flag, call `preloadWhisperEngine()` (replaces import-time side effect) | `js/modules/speech.js` | 5, 6c.2 |
| 4 | Remove `preloadWhisperEngine()` call at `app-vad-asr-web.js:118` (import-time side effect) | `js/workers/whisper/app-vad-asr-web.js` | 5 |
| 5 | Remove `document.getElementById('appLoadingImageDiv')` DOM call from `app-vad-asr-web.js`; add React Preloader component that watches `isWhisperReady` from Zustand | `js/workers/whisper/app-vad-asr-web.js`, Preloader component (new or existing) | resolved |
| 6 | Remove `window.whisperEngineReady` fallback from `app-vad-asr-web.js` | `js/workers/whisper/app-vad-asr-web.js` | §4d |
| 7 | Inject `updateSpeechRecording` as factory dep in `createSpeechOrchestrator()` | `js/modules/speech-orchestrator.js`, `js/modules/speech.js` | §5 |
| — | Run vitest suite (140 tests), fix any regressions | — | — |

### Phase 2 — Demo Mode

| Step | Action | Files | Combo? |
|------|--------|-------|--------|
| 8 | Mirror `onnx-community/whisper-tiny.en` ONNX models to `r2.ultrafastfluency.com/whisper-demo/` | CDN (no code change) | 6f.2 |
| 9 | Add `loadAndCacheFile()` equivalent to `whisper-worker-demo.js` — fetches from your R2 CDN path, writes to Cache Storage API | `js/workers/whisper/whisper-worker-demo.js` (~20 lines) | 6f.2 |
| 10 | Run manual smoke test with `?demo` URL param — validate both demo and production paths still work | manual | 6c.2, 6d |
| — | Run vitest suite again | — | — |

### Phase 3 — Remove Store Callbacks (in dependency order)

| Step | Action | Files | Combo? |
|------|--------|-------|--------|
| 11 | Remove `tutorChatSubmitCallback` — pass `onSubmit` prop to `TutorChatInput.jsx` via `LessonContainer` | `TutorChatInput.jsx`, `LessonContainer.jsx`, `app-infra.js`, `store.js` | §7c #6 |
| 12 | Remove `introContinueCallback` — `answer-pipeline.js` factory returns `onContinue`, passed as prop to `IntroChoices.jsx` | `answer-pipeline.js`, `app-infra.js`, `IntroChoices.jsx`, `LessonContainer.jsx`, `store.js` | §7c #1 |
| 13 | Remove `loadLessonContentCallback` — `app-infra.js` already has it locally, pass directly | `LessonContainer.jsx`, `lesson-progression.js`, `app-infra.js`, `store.js`, `regression-guard.spec.js` | §7c #3 |
| 14 | Batch: remove `textInputSubmitCallback` + `speechInputToggleCallback` + `onMicClickCallback` — intertwined through `step-loader-execute.js` / `AnswerInput.jsx` / `MicrophoneToggle.web.jsx` | `step-loader-execute.js`, `AnswerInput.jsx`, `MicrophoneToggle.web.jsx`, `store.js` | §7c #2, #4, #5 |
| — | Run vitest suite, then Playwright smoke test (`tests/answer-flow.spec.js`) | — | — |

### Phase 4 — Deferred

| Step | Action | Trigger |
|------|--------|--------|
| 15 | Add demo→full conversion analytics events | When demo mode is activated in production and you need to measure conversion (deferred per section 6f.3) |
| 16 | Clean up `currentVideoPlayer` and `answerPipelineDeps` from store | After all Phase 3 callbacks are removed — these two are the same anti-pattern (separate work item per section 8 bottom) |
| 17 | Investigate removing the unused `transcribeAudioBuffer`/`analyzeAudioBufferWithVAD` import from `speech.web.js`, or keep for future desktop PWA | When desktop PWA usage on PC/Mac/Chromebook is being investigated |

## 1. File Map

```
js/
├── modules/
│   ├── speech.core.js           Pure logic — zero imports, platform-agnostic
│   ├── speech.web.js            Web media adapter (getUserMedia, MediaRecorder, AudioWorklet)
│   ├── speech.shared.js         Orchestrator — currently hard-codes web imports ← PROBLEM
│   ├── speech.js                Web bridge — re-exports shared + web adapter
│   ├── store.js                 Zustand store (whisperReady, micStatus, etc.)
│   ├── answers.js               validateAnswerPrecheck()
│   ├── storage.js               saveSpeechRecording() / updateSpeechRecording()
│   ├── step-loader-execute.js   Wires mic toggle callback, resets listeningState
│   ├── lesson-progression.js    Manages lesson flow
│   └── answer-pipeline.js       Handles answer submission
│
├── workers/whisper/
│   ├── app-vad-asr-web.js           Whisper worker interface — creates Web Worker,
│   │                                 communicates via postMessage.
│   │                                 Exports: preloadWhisperEngine(), transcribeAudioBuffer(),
│   │                                 analyzeAudioBufferWithVAD()
│   │                                 ⚠️ import-time side effect (line 118): auto-starts worker
│   │
│   ├── whisper-worker-web.js        Production ONNX Whisper worker — runs in Web Worker
│   │                                 thread, loaded via new Worker(...) by app-vad-asr-web.js.
│   │                                 Boots Sherpa-ONNX C++ WASM runtime from R2 CDN,
│   │                                 caches ONNX models in Cache Storage API,
│   │                                 handles 'transcribe' and 'vad_analyze' postMessage types.
│   │                                 Uses: WebAssembly, importScripts, Cache API, navigator
│   │
│   ├── whisper-worker-demo.js       Demo mode worker — alternate loaded via
│   │                                 `?demo` URL param (app-vad-asr-web.js:38).
│   │                                 Uses Transformers.js pipeline (HuggingFace) instead of
│   │                                 Sherpa-ONNX. Also runs in Web Worker thread.
│   │                                 Uses: navigator, env (transformers.js)
│   │
│   └── audio-processor.js           AudioWorkletProcessor — runs on audio rendering thread,
│                                    NOT a Web Worker. Registered via audioWorklet.addModule()
│                                    by speech.web.js:startLocalAudioTap().
│                                    Captures raw PCM Float32Array chunks per process() call
│                                    and posts them to main thread.
│                                    Uses: AudioWorkletProcessor API (web-only)
│
├── components/
│   ├── step-loader.web.js       Injects speech deps into createLoadStep
│   ├── widgets/
│   │   ├── MicrophoneToggle.web.jsx  Mic button — calls onMicClickCallback
│   │   ├── WhisperReview.jsx         Review UI (pure React, reads Zustand)
│   │   └── MicStatusText.jsx         Status display (speak-now, engine-error, etc.)
│   └── chat/
│       └── chat-interface.js         Thin Zustand wrapper for chat messages
│
└── hooks/
    ├── app-infra.js             Wires speech/web deps into factories
    └── useAppBootstrap.js       Calls setupAppInfra after auth/config loaded
```

## 2. Data Flow (end-to-end)

```
User taps mic button
  └─ MicrophoneToggle.web.jsx
       └─ onMicClickCallback (stored in Zustand by step-loader-execute.js)
            └─ toggleSpeechRecognition(params)
                 │
                 ├── START BRANCH ──────────────────────────────────────────┐
                 │  listeningState.active = true                            │
                 │  WebAdapter.startSpeechCamRecording()                    │
                 │      → getUserMedia → MediaRecorder starts               │
                 │  WebAdapter.startLocalAudioTap(stream, onSpeech)         │
                 │      → AudioWorklet captures raw PCM chunks              │
                 │  hesitation timer starts (setInterval 100ms)             │
                 │      → deducts flowScore during silence                  │
                 │      → onSpeechDetected callback clears timer            │
                 │                                                          │
                 ├── STOP BRANCH ───────────────────────────────────────────┤
                 │  listeningState.active = false                           │
                 │  WebAdapter.stopLocalAudioTap()                          │
                 │      → returns merged Float32Array (raw PCM)             │
                 │  WebAdapter.stopSpeechCamRecording()                     │
                 │      → stops MediaRecorder → returns video Blob          │
                 │  Core.trimSilenceWithPadding(rawAudio)                   │
                 │      → { trimmed, pauseCount, hesitation, netDuration }  │
                 │  transcribeAudioBuffer(trimmed)                          │
                 │      → postMessage to Whisper Worker → {text, logprob}   │
                 │  processTranscript({ transcript, timingMeta, ... })      │
                 │      → cleanTranscript() → validateAnswerPrecheck()      │
                 │      → show review UI (WhisperReview.jsx, 7s timer)      │
                 │      → acceptTranscript() → handleAnswer()              │
                 │      → answer-pipeline.js → scoring → next step         │
                 └──────────────────────────────────────────────────────────┘
```

## 3. Detailed Module Roles

### `speech.core.js` — Platform-Agnostic Logic
- `isGibberish(logprob)` — compares logprob against threshold
- `cleanTranscript(text)` — strips trailing articles/conjunctions
- `trimSilenceWithPadding(data, opts)` — VAD-like silence trimming, pause counting, hesitation calculation
- **Zero imports. Safe for RN as-is.**

### `speech.web.js` — Web Media Adapter
- `warmUpSpeechCamStream()` — pre-calls getUserMedia to request permissions
- `startSpeechCamRecording()` — ensures stream, creates MediaRecorder, starts recording
- `stopSpeechCamRecording({ download, persist, keepStreamAlive, playback })` — stops recorder, optionally saves to IndexedDB or triggers download
- `startLocalAudioTap(stream, onSpeechDetected)` — connects AudioWorklet, captures raw PCM, detects voice onset
- `stopLocalAudioTap()` — disconnects worklet, returns merged Float32Array
- `safelyStopStream()` / `speechCamStream` / `speechCamRecorder` — module-level mutable state
- Also imports `transcribeAudioBuffer` from `app-vad-asr-web.js` — but this import is **unused** in this file (it was likely leftover or future-use).
- **Pure browser APIs. For RN: replace with native camera/audio recording APIs.**

### `app-vad-asr-web.js` — Whisper Worker Interface
- Module-level state: `isEngineReady`, `whisperWorker`, `activeTranscriptionResolve`
- `preloadWhisperEngine()` — creates `new Worker(...)`, loads ONNX models from R2/CDN, signals readiness via Zustand
- `transcribeAudioBuffer(float32Array)` — posts audio to worker, resolves with `{text, avg_logprob}`
- `analyzeAudioBufferWithVAD(float32Array, options)` — posts audio for VAD analysis
- **⚠️ Line 118: `preloadWhisperEngine();` — import-time side effect.** Auto-starts the worker the moment this module is imported. Currently imported by both `speech.web.js` (unused) and `speech.shared.js` (used).
- Also contains DOM calls: `document.getElementById('appLoadingImageDiv')`, `window.location.search`, `window.whisperEngineReady`
- **Web Worker + ONNX runtime. For RN: replace with native ONNX binding or CoreML.**

### Worker Hierarchy (3 threads)

The speech pipeline spans **3 execution threads**:

```
┌─────────────────────────────────────────────────────────────────┐
│  MAIN THREAD                                                    │
│                                                                 │
│  speech.web.js       speech.shared.js       app-vad-asr-web.js  │
│       │                   │                       │             │
│       │                   │                  new Worker(...)    │
│       │                   │                       │             │
│       │              transcribeAudioBuffer() ──────┤             │
│       │                   │                  postMessage(audio) │
│       │                   │                       │             │
│       │            onmessage({text, logprob}) ──────             │
│       │                   │                                     │
│  startLocalAudioTap()     │                                     │
│       │                   │                                     │
│  audioWorklet.addModule() │                                     │
│       │                   │                                     │
├───────┼───────────────────┼─────────────────────────────────────┤
│  AUDIOWORKLET THREAD     │                                     │
│  audio-processor.js      │                                     │
│       │                  │                                     │
│  process() → port.postMessage(chunk) ─→ main thread            │
│       │                                                         │
├───────┼─────────────────────────────────────────────────────────┤
│  WEB WORKER THREAD                                              │
│  whisper-worker-web.js (or whisper-worker-demo.js)              │
│       │                                                         │
│  importScripts(sherpa-onnx-vad.js, asr.js, wasm-main.js)       │
│  WebAssembly.instantiateStreaming(wasmResponse, ...)            │
│  loadAndCacheFile() → Cache Storage API (R2 CDN)                │
│       │                                                         │
│  onmessage('transcribe'):                                       │
│    → OfflineRecognizer.createStream()                           │
│    → stream.acceptWaveform(16000, float32Array)                 │
│    → recognizer.decode(stream)                                  │
│    → postMessage({text, avg_logprob})                           │
│       │                                                         │
│  onmessage('vad_analyze'):                                      │
│    → createVad() → vad.acceptWaveform() → vad.flush()          │
│    → postMessage({segments, stats})                             │
└─────────────────────────────────────────────────────────────────┘
```

- **`whisper-worker-web.js`** (231 lines) — production worker. Uses Sherpa-ONNX C++ compiled to WASM. Boots `OfflineRecognizer`, handles `transcribe` and `vad_analyze` messages. Downloads and caches `.wasm`, `.data`, `.onnx` model files from `https://r2.ultrafastfluency.com/whisper/` via Cache Storage API.
- **`whisper-worker-demo.js`** (138 lines) — demo worker (activated by `?demo` URL param). Uses HuggingFace Transformers.js pipeline instead of Sherpa-ONNX. Same message interface.
- **`audio-processor.js`** (14 lines) — AudioWorkletProcessor. Not a Web Worker; loaded dynamically via `audioWorklet.addModule()` in `speech.web.js:startLocalAudioTap()`. Captures raw PCM chunks and posts them to the main thread. Registered as `'audio-processor'`.

### `speech.shared.js` — Orchestrator (THE PROBLEM)
- Exports: `listeningState` (mutable), `initLocalVoiceAI`, `toggleSpeechRecognition`
- Direct imports (hard-coded):
  ```
  import * as Core from './speech.core.js';                          ✓ pure
  import * as WebAdapter from './speech.web.js';                     ✗ web-only
  import { transcribeAudioBuffer, preloadWhisperEngine }
    from '../workers/whisper/app-vad-asr-web.js';                    ✗ web-only
  import { updateSpeechRecording } from './storage.js';              ✗ web-only (IndexedDB)
  import { validateAnswerPrecheck } from './answers.js';             ✓ pure
  import { appStore } from './store.js';                             ✓ pure
  ```
- The `toggleSpeechRecognition()` function directly calls:
  - `WebAdapter.startSpeechCamRecording()` / `stopSpeechCamRecording()` / `startLocalAudioTap()` / `stopLocalAudioTap()` / `speechCamStream`
  - `transcribeAudioBuffer()` — direct, not through WebAdapter
  - `Core.trimSilenceWithPadding()` / `isGibberish()` / `cleanTranscript()`
- **For RN: the orchestration flow (hesitation timer, transcript validation, review timer) is platform-agnostic, but the adapter calls are hard-coded to web.**

### `speech.js` — Web Bridge
- `export { listeningState, initLocalVoiceAI, toggleSpeechRecognition } from './speech.shared.js';`
- `export * from './speech.web.js';`
- **All consumers import from here.** No file imports `speech.shared.js` directly.

### Consumer Files

| File | Imports from speech.js | Used as |
|------|----------------------|---------|
| `app-infra.js` | `warmUpSpeechCamStream`, `toggleSpeechRecognition`, `listeningState` | Passed as deps to factories |
| `step-loader.web.js` | `warmUpSpeechCamStream`, `toggleSpeechRecognition`, `listeningState` | Injected into `createLoadStep()` |
| `step-loader-execute.js` | (receives via deps injection) `toggleSpeechRecognition`, `listeningState` | Wired into mic button callback |
| `App.jsx` | `initLocalVoiceAI` | Preloads Whisper engine at boot |

## 4. Issues

### 4a. Naming: `speech.shared.js` is not actually shared
It imports `speech.web.js` and `app-vad-asr-web.js` directly. It cannot run on RN. The name is misleading.

### 4b. Import-time side effect in `app-vad-asr-web.js:118`
`preloadWhisperEngine()` fires when the module is imported. Currently imported by both `speech.web.js` (unused) and `speech.shared.js` (used). On RN this would crash (no `Worker` global).

### 4c. Module-level mutable state in 3 places
- `speech.web.js`: `speechCamStream`, `speechCamRecorder`, `speechCamChunks`, `localRawAudioChunks`, `localAudioContext`, `localAudioWorkletNode`
- `speech.shared.js`: `listeningState` (`{active, hesitationTimer, transitioning}`)
- `app-vad-asr-web.js`: `whisperWorker`, `isEngineReady`, `activeTranscriptionResolve`

### 4d. `window.whisperEngineReady` fallback
`app-vad-asr-web.js:46` still sets `window.whisperEngineReady = true` as a fallback. The primary path uses Zustand (`appStore.getState().setWhisperReady(true)`).

## 5. Refactoring Plan

Convert `speech.shared.js` → `speech-orchestrator.js` using the same **deps injection factory pattern** already proven in `answer-pipeline.js` and `lesson-progression.js`.

### New file: `js/modules/speech-orchestrator.js`

```js
export function createSpeechOrchestrator({
    // Media adapter (getter functions — values like speechCamStream are mutable)
    startSpeechCamRecording,
    stopSpeechCamRecording,
    getSpeechCamStream,   // getter: () => mediaAdapter.speechCamStream
    safelyStopStream,
    startLocalAudioTap,
    stopLocalAudioTap,
    // Whisper adapter
    transcribeAudioBuffer,
    preloadWhisperEngine,
    // Storage (IndexedDB — could also be injected if RN needs it)
    updateSpeechRecording,
}) {
    const listeningState = { active: false, hesitationTimer: null, transitioning: false };

    function initLocalVoiceAI() {
        return preloadWhisperEngine();
    }

    function stopListeningEarly(userData, player, uiHooks) { ... }

    async function processTranscript({ transcript, timingMeta, ... }) { ... }

    export async function toggleSpeechRecognition(params) { ... }

    return { listeningState, initLocalVoiceAI, toggleSpeechRecognition };
}
```

### Updated `js/modules/speech.js` (final — supersedes §6c.2 sample; §6c.2 is missing `getSpeechCamStream`)

```js
import * as mediaAdapter from './speech.web.js';
import { createWhisperAdapter } from '../workers/whisper/app-vad-asr-web.js';
import { updateSpeechRecording } from './storage.js';
import { createSpeechOrchestrator } from './speech-orchestrator.js';

const isDemoMode = window.location.search.includes('demo')
    || window.localStorage.getItem('whisperMode') === 'demo';

const whisperAdapter = createWhisperAdapter({
    workerUrl: isDemoMode
        ? new URL('../workers/whisper/whisper-worker-demo.js', import.meta.url)
        : new URL('../workers/whisper/whisper-worker-web.js', import.meta.url),
    workerOptions: isDemoMode
        ? { type: 'module' }
        : undefined,
});

const { listeningState, initLocalVoiceAI, toggleSpeechRecognition } =
    createSpeechOrchestrator({
        ...mediaAdapter,
        ...whisperAdapter,
        updateSpeechRecording,
        getSpeechCamStream: () => mediaAdapter.speechCamStream,
    });

whisperAdapter.preloadWhisperEngine();

export { listeningState, initLocalVoiceAI, toggleSpeechRecognition };
export * from './speech.web.js';
```

### Updated `js/workers/whisper/app-vad-asr-web.js`

Remove the import-time side effect at line 118:
```diff
- preloadWhisperEngine();
+ // preloadWhisperEngine() is now called from speech.js (the web entry point)
```

Remove the DOM call to `document.getElementById('appLoadingImageDiv')` — this preloader hiding belongs in the React bootstrap, not in a worker interface module.

### What stays the same

- `speech.core.js` — no changes
- `speech.web.js` — no changes (it keeps its module-level state; the factory wraps it)
- All consumers — no import changes needed (they all import from `speech.js`)
- `WhisperReview.jsx` — already pure React
- `step-loader-execute.js` — receives deps via injection, no change

### RN Path

A future `speech.native.js` would:
```js
import * as nativeMediaAdapter from './speech.native.js';    // native camera/audio
import { transcribeAudioBuffer, preloadWhisperEngine }
    from './whisper-rn-adapter.js';                           // native ONNX
import { createSpeechOrchestrator } from './speech-orchestrator.js';

const { listeningState, initLocalVoiceAI, toggleSpeechRecognition } =
    createSpeechOrchestrator({
        ...nativeMediaAdapter,
        transcribeAudioBuffer,
        preloadWhisperEngine,
        updateSpeechRecording: () => {}, // or native storage
    });

export { listeningState, initLocalVoiceAI, toggleSpeechRecognition };
export * from './speech.native.js';
```

## 6. Demo Mode Implementation Plan

### 6a. Goal

Enable a lightweight Transformers.js-based Whisper pipeline (`whisper-worker-demo.js`, ~40MB) as an alternative to the Sherpa-ONNX production pipeline (`whisper-worker-web.js`, ~110MB), reducing initial download for demo/trial users. The demo path exists but is gated behind an unused `?demo` URL param in `app-vad-asr-web.js`.

### 6b. Current State

```
app-vad-asr-web.js
  → checks window.location.search for 'demo' (line 38)
  → if demo: new Worker('whisper-worker-demo.js', { type: 'module' })
  → if not:  new Worker('whisper-worker-web.js')  [classic worker, importScripts]
```

The entire worker-selection logic lives inside `app-vad-asr-web.js`. The factory refactoring (Section 5) moves `preloadWhisperEngine` and `transcribeAudioBuffer` into the injectable `whisperAdapter` parameter — but the adapter itself currently hard-codes which worker to create.

### 6c. Strategy

> **Note**: The code samples below are simplified to show the demo-relevant changes. See §5 for the canonical `speech.js` wiring with `getSpeechCamStream` and full factory integration.

**Step 1 — Decouple worker selection from the whisper adapter.**

The whisper adapter (`app-vad-asr-web.js`) should accept the worker URL/path as a parameter rather than sniffing `window.location.search`. Create a thin factory inside `app-vad-asr-web.js`:

```js
// app-vad-asr-web.js — refactored
export function createWhisperAdapter({ workerUrl, workerOptions }) {
    // ...
    function preloadWhisperEngine() {
        whisperWorker = new Worker(workerUrl, workerOptions);
        // ... rest of existing setup (onmessage, state tracking, etc.)
    }
    function transcribeAudioBuffer(float32Array) { ... }
    function analyzeAudioBufferWithVAD(float32Array, options) { ... }
    return { preloadWhisperEngine, transcribeAudioBuffer, analyzeAudioBufferWithVAD };
}
```

**Step 2 — Wire at the web entry point (`speech.js`).**

```js
// speech.js — updated
import { createWhisperAdapter } from '../workers/whisper/app-vad-asr-web.js';
import { createSpeechOrchestrator } from './speech-orchestrator.js';
import * as mediaAdapter from './speech.web.js';

// Choose worker at the entry point, not inside the module
const isDemoMode = window.location.search.includes('demo')
    || window.localStorage.getItem('whisperMode') === 'demo';

const whisperAdapter = createWhisperAdapter({
    workerUrl: isDemoMode
        ? new URL('../workers/whisper/whisper-worker-demo.js', import.meta.url)
        : new URL('../workers/whisper/whisper-worker-web.js', import.meta.url),
    workerOptions: isDemoMode
        ? { type: 'module' }
        : undefined,  // classic worker
});

const { listeningState, initLocalVoiceAI, toggleSpeechRecognition } =
    createSpeechOrchestrator({
        ...mediaAdapter,
        ...whisperAdapter,
        updateSpeechRecording,
    });

// Kick off preload at web entry point (replaces import-time side effect)
whisperAdapter.preloadWhisperEngine();
```

**Step 3 — Clean up `app-vad-asr-web.js`.**

- Remove `window.location.search` sniffing (moved to `speech.js`)
- Remove the `document.getElementById('appLoadingImageDiv')` call (preloader hiding belongs in React)
- Remove line 118 `preloadWhisperEngine()` import-time side effect
- Remove `window.whisperEngineReady` fallback — confirmed unused, Zustand path is primary
- The existing `transcribeAudioBuffer` / `analyzeAudioBufferWithVAD` / state management can stay as-is; the factory just wraps them

### 6d. Feature Flag Options

| Approach | Pros | Cons |
|----------|------|------|
| **URL param** (`?demo`) | Simple, easy for QA to test | Clutters URL, lost on navigation |
| **localStorage** (`whisperMode=demo`) | Survives navigation, can be set before app loads | Requires page reload to switch |
| **Zustand store flag** | Reactive, instant toggle | Worker is already loaded by bootstrap — would need teardown + reload |
| **Build-time env** (Vite `import.meta.env.VITE_WHISPER_MODE`) | No runtime check, tree-shakeable | No user-facing toggle; env-specific build needed |

**Recommended**: URL param + localStorage, checked at the `speech.js` entry point. This keeps the decision in one place, survives navigation, and works before React mounts. The store-based toggle is not viable since the worker is created during bootstrap, before the UI is interactive.

### 6e. Files Changed

| File | Change |
|------|--------|
| `app-vad-asr-web.js` | Add `createWhisperAdapter()` factory; remove URL sniffing + DOM call + import-time side effect |
| `speech.js` (after refactor) | Choose worker path based on feature flag, pass to `createWhisperAdapter()`, call `preloadWhisperEngine()` |
| `whisper-worker-demo.js` | Add `loadAndCacheFile()` equivalent pointing at R2 — fetches model from your CDN, writes to Cache Storage API (~20 lines) |
| `whisper-worker-web.js` | No changes needed |
| `storage.js` | Optionally persist `whisperMode` preference if demo mode becomes user-selectable |

### 6f. Open Questions for Demo Mode — Resolved

1. **VAD**: `whisper-worker-demo.js` does NOT implement `vad_analyze` and does NOT need it. VAD is a very heavy file that was almost impossible to get working on web with the quantized 110MB model anyway. The web-side `trimSilenceWithPadding` + hesitation timer in `speech.core.js` is sufficient for the demo. Full VAD is a target for RN where the larger Whisper small model can handle it properly.
2. **Model caching**: Yes, the demo worker should absolutely cache the model. HuggingFace Hub is too slow for a first-impression demo — no edge caching for anonymous downloads, no Range-request negotiation in Transformers.js cache layer, and rate limits on anonymous IPs.

   **Approach**: Mirror the ONNX model files (`onnx-community/whisper-tiny.en`) to your existing R2 bucket at `r2.ultrafastfluency.com/whisper-demo/`. The demo worker reuses the same `loadAndCacheFile()` → Cache Storage API pattern the Sherpa-ONNX worker already has, but fetches from your own R2 CDN instead of HF. This gives full edge-cached global distribution, zero dependency on HF uptime, and no rate limits. Estimated addition: ~20 lines in `whisper-worker-demo.js`.

   Files changed: `whisper-worker-demo.js` — add `loadAndCacheFile()` equivalent pointing at your R2 path. No changes to `whisper-worker-web.js`.
3. **Analytics**: Yes, but can be deferred to a later iteration.

## 7. Eliminate Callbacks from Zustand

There are **6** function-valued fields in the store that should be removed. All follow the same anti-pattern: a module stashes a closure, a React component retrieves it.

### 7a. Full Inventory

| # | Store field | Set by | Read by | Triggered when |
|---|------------|--------|---------|----------------|
| 1 | `introContinueCallback` | `answer-pipeline.js:890` | `IntroChoices.jsx:7` | User clicks continue on lesson intro |
| 2 | `onMicClickCallback` | `AnswerInput.jsx:79` | `MicrophoneToggle.web.jsx:9` | User taps mic button |
| 3 | `loadLessonContentCallback` | `app-infra.js:120` | `LessonContainer.jsx:88`, `lesson-progression.js:45` | Need to load lesson content |
| 4 | `textInputSubmitCallback` | `step-loader-execute.js:129`, `step-loader-logic.js:58` | `AnswerInput.jsx:8` | User submits text answer |
| 5 | `speechInputToggleCallback` | `step-loader-execute.js:133` | `AnswerInput.jsx:9` | User toggles speech mode |
| 6 | `tutorChatSubmitCallback` | `app-infra.js:70` | `TutorChatInput.jsx:7` | User submits tutor chat |

### 7b. Strategy: Props via Wiring Layer

All six follow the same pattern:

```
module.js → set({ callback })      [write]
                 ↓
component.jsx → useStore(s => s.callback) → invoke it()   [read]
```

The fix inverts this: the callback is **returned from a factory or created at the wiring layer**, then passed to the React component via props or a React context. `LessonContainer.jsx` is the natural wiring hub — it already orchestrates `StepLoader`, `AnswerInput`, `IntroChoices`, `MicrophoneToggle`, etc.

### 7c. Per-Callback Plan

#### #1 `introContinueCallback`

**Current flow:**
```
answer-pipeline.js creates onContinue closure
  → appStore.getState().setIntroContinueCallback(onContinue)
  → IntroChoices.jsx reads introContinueCallback via useStore
  → user clicks → calls introContinueCallback()
```

**Target flow:**
```
answer-pipeline.js factory returns onContinue callback
  → app-infra.js receives it from createAnswerPipeline return value
  → passes as prop: <IntroChoices onContinue={...} />
  → LessonContainer passes it down
```

**Changes:**
- `answer-pipeline.js` factory: already exists — add `onContinue` to the return object (or it may already exist as part of the pipeline result)
- `app-infra.js`: destructure `onContinue` from pipeline and store in a ref on `LessonContainer` or pass directly
- `IntroChoices.jsx`: accept `onContinue` prop, remove `useStore(appStore, state => state.introContinueCallback)`
- `store.js`: remove `introContinueCallback`, `setIntroContinueCallback`
- `answer-pipeline.js:890`: remove the `setIntroContinueCallback` call

#### #2 `onMicClickCallback`

**Current flow:**
```
step-loader-execute.js sets speechInputToggleCallback in store
  → AnswerInput.jsx reads speechInputToggleCallback
  → AnswerInput sets onMicClickCallback = speechInputToggleCallback (line 79)
  → MicrophoneToggle reads onMicClickCallback via useStore
  → user taps mic → onMicClickCallback()
```

This one has a **double hop**: `speechInputToggleCallback` → `onMicClickCallback` through `AnswerInput.jsx`. The real source is `speechInputToggleCallback`.

**Target flow:**
```
step-loader-execute.js factory returns speechToggle callback
  → returned to step-loader.web.js → returned to LessonContainer
  → LessonContainer passes to MicrophoneToggle as onMicClick prop
  → AnswerInput receives speechToggle prop instead of reading from store
```

**Changes:**
- `step-loader-execute.js`: include `speechToggle` in the return from `_renderResponseStep` (it's already using `toggleSpeechRecognition` internally)
- `MicrophoneToggle.web.jsx`: accept `onMicClick` prop instead of reading store, remove `useStore` subscription
- `AnswerInput.jsx`: accept `speechToggle` prop, remove `useStore` + `setOnMicClickCallback` calls
- `store.js`: remove `onMicClickCallback`, `setOnMicClickCallback`, `speechInputToggleCallback`, `setSpeechInputToggleCallback`

#### #3 `loadLessonContentCallback`

**Current flow:**
```
app-infra.js creates loadLessonContent closure
  → appStore.getState().setLoadLessonContentCallback(loadLessonContent)
  → LessonContainer.jsx reads via appStore.getState().loadLessonContentCallback
  → lesson-progression.js reads via appStore.getState().loadLessonContentCallback (fallback)
```

**Target flow:**
```
app-infra.js: loadLessonContent is already a local variable in setupAppInfra()
  → lesson-progression.js: already accepts loadLessonContent via _deps param
  → LessonContainer.jsx: pass loadLessonContent as prop or call it directly
    (LessonContainer is the component that creates the loading context)
```

**Changes:**
- `lesson-progression.js`: already receives `loadLessonContent` via `_deps` (line 45 fallback). Ensure callers always pass it.
- `LessonContainer.jsx`: stop reading from store, call `loadLessonContent` directly or receive it from `app-infra.js` via context/props
- `store.js`: remove `loadLessonContentCallback`, `setLoadLessonContentCallback`
- `regression-guard.spec.js:152`: remove test that checks `loadLessonContentCallback` in store. Before removing, verify an existing integration test covers the prop-passing path (e.g., Playwright test that loads a lesson and confirms content renders). If none exists, add a brief Playwright assertion in `tests/answer-flow.spec.js` that the lesson content loads successfully.

#### #4 `textInputSubmitCallback`

**Current flow:**
```
step-loader-execute.js (or step-loader-logic.js) sets textInputSubmitCallback
  → AnswerInput.jsx reads via useStore
  → user types + presses enter → textInputSubmitCallback(value, btn)
```

**Target flow:**
```
step-loader-execute.js returns submitAnswer callback
  → returned through step-loader.web.js → LessonContainer
  → LessonContainer passes to AnswerInput as onSubmitText prop
```

**Changes:**
- `AnswerInput.jsx`: accept `onSubmitText` prop, remove `useStore` subscription
- `step-loader-execute.js`: the callback is already a closure around `submitAnswerPrecheck` — it can be returned from the factory and threaded through
- `store.js`: remove `textInputSubmitCallback`, `setTextInputSubmitCallback`, `clearInputUI` (which resets it)

#### #5 `speechInputToggleCallback`

(Merged with #2 above — `onMicClickCallback` is an alias of this value.)

#### #6 `tutorChatSubmitCallback`

**Current flow:**
```
app-infra.js sets tutorChatSubmitCallback = handleTutorChatSubmitFn
  → TutorChatInput.jsx reads via useStore
  → user types + presses enter → tutorChatSubmitCallback(message)
```

**Target flow:**
```
app-infra.js: handleTutorChatSubmitFn already exists as a local
  → passed to TutorChatInput as onSubmit prop via LessonContainer
```

**Changes:**
- `TutorChatInput.jsx`: accept `onSubmit` prop, remove `useStore` subscription + `callbackRef` dance
- `store.js`: remove `tutorChatSubmitCallback`, `setTutorChatSubmitCallback`

### 7d. Implementation Order

To minimize breakage, remove one callback at a time in dependency order:

1. **`tutorChatSubmitCallback`** — simplest, only one setter + one reader. No dependencies.
2. **`introContinueCallback`** — one setter + one reader. No dependencies.
3. **`loadLessonContentCallback`** — one setter + two readers (LessonContainer + lesson-progression fallback).
4. **`textInputSubmitCallback` + `speechInputToggleCallback` + `onMicClickCallback`** — all three are intertwined through `step-loader-execute.js` / `AnswerInput.jsx` / `MicrophoneToggle.web.jsx`. Should be done as a single batch.

### 7e. What's Left in the Store After Cleanup

Current non-serializable fields:
- `currentVideoPlayer` — mutable object with `pause()`, `play()`, `video` getter
- `answerPipelineDeps` — object of answer-pipeline functions
- 6 callbacks listed above

After cleanup:
- `currentVideoPlayer` — still mutable. The roadmap brief flags this for removal too (move to a module-level ref).
- `answerPipelineDeps` — still mutable. Used by `LessonContainer.jsx` and `app-infra.js`. Could be replaced by having the factory return value available at the wiring layer.

These two are separate work items outside this speech pipeline refactor.
