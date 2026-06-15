# Fix: Whisper Speech Engine Fails to Load on iOS 16

## Symptom

On older iOS devices (v16), the speech engine shows **"Speech engine not ready. Please wait a moment."** indefinitely. No errors appear in the UI. The engine never becomes ready.

**Works on:** newer iOS (17+), Windows, Android  
**Fails on:** iOS 16 (both demo and non-demo modes)

---

## Root Cause Analysis

### Bug 1: Error messages from Web Workers are silently swallowed

File: `src/workers/whisper/app-vad-asr-web.js` (lines 19–43)

The `onmessage` handler only recognizes three message types from the worker:

| Type | Handled? | Effect |
|------|----------|--------|
| `'ready'` | ✅ Yes | Sets `isWhisperReady = true`, resolves preload promise |
| `'result'` | ✅ Yes | Resolves transcription promise |
| `'vad_result'` | ✅ Yes | Resolves VAD analysis promise |
| **`'error'`** | **❌ No** | **Message is consumed by the `if/else` chain and silently discarded** |

When initialization fails on iOS 16:

- **Demo worker** (`whisper-worker-demo.js`): Posts `{ type: 'error', message }` in both its inner catch (line 119) and outer catch (line 123). The adapter ignores it. `adapterIsEngineReady` stays `false`, `adapterReadyResolve` is never called, and the preload promise never resolves.

- **Prod worker** (`whisper-worker-web.js`): The `catch` block (lines 111–113) only `console.error`s. **No message of any kind is posted back to the main thread.** Same result: the adapter waits forever.

### Bug 2: No initialization timeout

File: `src/workers/whisper/app-vad-asr-web.js` (lines 53–61)

`preloadWhisperEngine()` returns a promise that only resolves when `{ type: 'ready' }` is received. If the worker fails or crashes silently, this promise never resolves. The main thread (`toggleSpeechRecognition` in `speech-orchestrator.js`) polls `isWhisperReady` every second, but it will never become `true`.

### Bug 3: Prod worker error is completely silent

File: `src/workers/whisper/whisper-worker-web.js` (lines 111–113)

```js
} catch (error) {
    console.error('[whisper] Fatal Boot Error:', error);
}
```

The error is logged to console but:
- `SILENT_LOGS = true` at line 3 suppresses `console.log` and `console.time` (but not `console.error` — so errors will appear).
- No message is posted to the main thread via `self.postMessage`, so the adapter has no way to know the engine failed.

### Likely Trigger on iOS 16

File: `public/wasm/` directory

The directory contains only two WASM files:

| File | Size | Requires |
|------|------|----------|
| `ort-wasm-simd-threaded.wasm` | 11.2 MB | WASM SIMD + SharedArrayBuffer |
| `ort-wasm-simd-threaded.jsep.wasm` | 21.6 MB | WASM SIMD + SharedArrayBuffer |

The `onnxruntime-web` package (v1.20.0-dev, used by `@huggingface/transformers` v3.0.0) no longer ships non-SIMD WASM variants.

On iOS 16:
- **iOS 16.0–16.3**: WASM SIMD support was absent or incomplete. The ONNX Runtime Web tries to compile the SIMD WASM binary and fails. There is no `ort-wasm.wasm` (non-SIMD) fallback available.
- **iOS 16.4+**: WASM SIMD is supported, but `ort-wasm-simd-threaded.wasm` requires `SharedArrayBuffer` (cross-origin isolation). If COEP/COOP headers fail (e.g., mixed content, third-party resources), `SharedArrayBuffer` is unavailable and the threaded WASM may not load.

In both cases, the ONNX Runtime fails silently → Transformers.js pipeline creation throws → worker posts error → adapter ignores it.

---

## Fix Plan

### Phase 1: Fix Error Handling (Critical — Unlocks Diagnosis)

These fixes are required regardless of the root cause and must ship first. They also make the actual failure mode visible so we can confirm the WASM hypothesis.

#### Fix 1.1: Handle `{ type: 'error' }` in the adapter

**File:** `src/workers/whisper/app-vad-asr-web.js`

Add a handler for `'error'` messages in the `onmessage` dispatch chain (after the existing `'vad_result'` case, around line 42):

```
else if (e.data.type === 'error') {
    console.error('[whisper] Engine initialization error:', e.data.message);
    if (adapterReadyResolve) {
        adapterReadyResolve();
        adapterReadyResolve = null;
    }
}
```

This:
- Logs the error prominently
- Resolves the preload promise so the app stops waiting
- Does NOT set `adapterIsEngineReady = true` (so the engine stays in "not ready" state)

#### Fix 1.2: Post error from prod worker catch block

**File:** `src/workers/whisper/whisper-worker-web.js`

In the outer `catch` block (line 111), add:

```js
self.postMessage({ type: 'error', message: error.message });
```

So the main thread knows initialization failed.

#### Fix 1.3: Add timeout to preloadWhisperEngine()

**File:** `src/workers/whisper/app-vad-asr-web.js`

Modify `preloadWhisperEngine()` to reject/resolve after 30 seconds if no `'ready'` or `'error'` message is received:

```js
function preloadWhisperEngine() {
    return new Promise((resolve) => {
        if (adapterIsEngineReady) {
            resolve();
            return;
        }
        adapterReadyResolve = resolve;

        // Timeout: don't block forever if worker fails silently
        setTimeout(() => {
            if (adapterReadyResolve) {
                console.warn('[whisper] Engine preload timed out after 30s');
                adapterReadyResolve();
                adapterReadyResolve = null;
            }
        }, 30000);
    });
}
```

---

### Phase 2: Fix iOS 16 WASM Compatibility (Root Cause)

After Phase 1 is deployed, the actual error message from the worker will be logged to console, confirming the exact failure mode. Based on that, choose one of these strategies:

#### Option A: Provide non-SIMD WASM fallback (Recommended)

The `onnxruntime-web` package no longer ships `ort-wasm.wasm` (non-SIMD) or `ort-wasm-simd.wasm` (SIMD, no threads). However, older versions and CDN mirrors may have them.

**Approach:**
1. Download `ort-wasm.wasm` and `ort-wasm-simd.wasm` from a CDN archive:
   - `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort-wasm.wasm`
   - `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort-wasm-simd.wasm`
2. Place them in `public/wasm/` alongside the existing files.
3. Transformers.js / ONNX Runtime Web will auto-detect browser capabilities and select the correct file.

**Fallback chain that ONNX Runtime Web uses:**
1. Try `ort-wasm-simd-threaded.wasm` (SIMD + threads) — fails on iOS < 16.4
2. Try `ort-wasm-simd.wasm` (SIMD only) — works on iOS 16.4+ without SAB
3. Try `ort-wasm.wasm` (no SIMD, no threads) — works on iOS 16.0–16.3

Currently only step 1 is possible because steps 2 and 3 have no files.

#### Option B: Feature-detect WASM SIMD and configure

**File:** `src/workers/whisper/whisper-worker-demo.js`

Before setting `env.backends.onnx.wasm.wasmPaths = '/wasm/'`, detect WASM SIMD support and choose the appropriate path:

```js
// Check if SIMD is supported
let wasmPath = '/wasm/';
try {
    if (typeof WebAssembly !== 'undefined' && WebAssembly.validate) {
        // Test SIMD support by validating a minimal SIMD module
        const simdTest = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, // magic
            0x01, 0x00, 0x00, 0x00, // version
            0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type section (v128)
            0x03, 0x02, 0x01, 0x00, // function section
            0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x0b, // body with i8x16.splat
            0x00, 0x0b, // name section
        ]);
        const hasSIMD = WebAssembly.validate(simdTest);
        if (!hasSIMD) wasmPath = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/';
    }
} catch (e) {
    wasmPath = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/';
}
env.backends.onnx.wasm.wasmPaths = wasmPath;
```

But this requires the CDN to actually have the non-SIMD files. Option A (placing files locally) is more reliable.

#### Option C: Fallback between demo and prod workers

**File:** `src/modules/speech/speech.js`

If the primary worker fails, retry with the alternative worker:

```js
// Track retry state
let retryAttempted = false;

whisperAdapter.preloadWhisperEngine().then(() => {
    if (!appStore.getState().isWhisperReady && !retryAttempted) {
        retryAttempted = true;
        console.warn('[speech] Primary engine failed, retrying with alternative...');
        const fallbackWorker = isDemoMode
            ? new Worker(new URL('../../workers/whisper/whisper-worker-web.js', import.meta.url))
            : new DemoWorker();
        // Re-wire adapter with fallback worker
    }
});
```

This adds complexity to the worker lifecycle. Only pursue if Options A/B are insufficient.

---

### Phase 3: Improve User-Facing Error Messaging

**File:** `src/modules/lesson/step-executor-webonly.js` (line 209–218)

Currently, `onEngineNotReady` always shows "Speech engine not ready. Please wait a moment." — implying waiting will help. Once the engine has definitively failed (error received or timeout reached), the message should change.

**Approach:**

Add a state to distinguish transient "still loading" from permanent "failed" in either the store or the adapter. The UI hook can then show a different message:

- While loading (first 30s): *"Speech engine is starting up..."*
- After failure/timeout: *"Speech engine could not be loaded on this device. Please try using text input."*

```js
onEngineNotReady: (userData, permanent = false) => {
    const key = permanent ? 'error_engine_failed' : 'error_engine_not_ready';
    const text = Strings.get(key, userData?.native_language) || "Speech engine not ready.";
    appStore.getState().setSystemMessage({ type: 'engine-error', text });
}
```

Add a new string `error_engine_failed` to `src/data/strings.js`.

---

## Implementation Order

| # | File | Change | Priority |
|---|------|--------|----------|
| 1 | `src/workers/whisper/app-vad-asr-web.js` | Handle `{ type: 'error' }` messages | **Critical** |
| 2 | `src/workers/whisper/app-vad-asr-web.js` | Add 30s timeout to `preloadWhisperEngine()` | **Critical** |
| 3 | `src/workers/whisper/whisper-worker-web.js` | Post error message from catch block | **High** |
| 4 | `public/wasm/` | Add `ort-wasm.wasm` + `ort-wasm-simd.wasm` | **High** |
| 5 | `src/data/strings.js` | Add `error_engine_failed` string | Medium |
| 6 | `src/modules/lesson/step-executor-webonly.js` | Update `onEngineNotReady` to distinguish transient/permanent | Medium |

---

## Testing

### Automated

Run the existing smoke test after implementing:

```bash
npx playwright test tests/answer-flow.spec.js
```

The test should verify:
- App loads without hanging on the preloader
- Speech engine readiness does not block lesson navigation
- Text input mode works when speech engine is not available

### Manual (iOS 16)

1. Open Safari Technology Preview or a remote iOS 16 device via Safari Web Inspector
2. Navigate to the app in demo mode (`?demo`)
3. Open the Console tab
4. Verify:
   - The error message from the worker is logged
   - The app does not hang on the preloader
   - The "Speech engine not ready" message appears and the mic button re-enables or shows a text input fallback
5. Repeat without `?demo` (prod mode)

### BrowserStack / Device Farm

If an iOS 16 device is not available locally, test via:
- BrowserStack real device testing
- macOS Safari with responsive design mode set to an iPhone with iOS 16

---

## Appendix: Key Files

| File | Role |
|------|------|
| `src/workers/whisper/app-vad-asr-web.js` | Main-thread adapter — bridges worker ↔ app |
| `src/workers/whisper/whisper-worker-web.js` | Prod worker — Sherpa-ONNX |
| `src/workers/whisper/whisper-worker-demo.js` | Demo worker — Transformers.js |
| `src/modules/speech/speech.js` | Web entry point — selects worker, wires adapter |
| `src/modules/speech/speech-orchestrator.js` | Orchestrator — checks `isWhisperReady`, polls |
| `src/modules/lesson/step-executor-webonly.js` | UI hooks — `onEngineNotReady`, `onEngineReady` |
| `src/data/strings.js` | Localized strings |
| `src/routes/HomeRoute.jsx` | Awaits `isWhisperReady` before finishing preloader |
| `public/wasm/` | ONNX WASM runtime files |
| `vite.config.js` | COOP/COEP headers, R2 proxy config |
