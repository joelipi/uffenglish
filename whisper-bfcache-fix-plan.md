# Implementation Plan: Whisper Page-Cache Memory Leak Fix

## Problem

On iPad Safari, reloading the page multiple times causes:

```
[whisper] engine initialization error: error: no available backend found. ERR [wasm] RangeError: Out of memory.
```

## Root Cause

The Whisper Web Worker (~100 MB WASM + model data) is created at module load in `src/modules/speech/speech.js` and **never terminated**. On iOS Safari, the page can be suspended (via bfcache, page cache, or tab suspension) while the worker is still running. Each reload adds another ~100 MB to memory until `ERR [wasm] RangeError: Out of memory` occurs, which surfaces as "no available backend found."

## Fix Strategy

Add lifecycle management to the Whisper worker:

1. **`pagehide` event** - Terminate the worker, close AudioContext, stop MediaStream. This frees ~100 MB of WASM memory before the page enters suspension/bfcache. `pagehide` fires regardless of the exact suspension mechanism (reload, back/forward, tab switch, low-memory eviction).
2. **`pageshow` event (with `event.persisted === true`)** - Recreate the worker, rebind it to the adapter, and reinitialize the engine. This restores speech functionality when the page is restored from page cache.

---

## Evidence-Backed Safety Claims

All claims verified via grep on the actual codebase:

### `stopWhisperEngine` / `startWhisperEngine` - 0 external callers
- `grep "stopWhisperEngine|startWhisperEngine"` in `src/` → only 2 matches, both in `app-vad-asr-web.js` itself (the definition and the no-op stub)
- Safe to delete both

### `isEngineReady` - 0 external consumers
- `grep "isEngineReady"` in `src/` → only in `app-vad-asr-web.js` itself (declaration line 5, assignment line 22)
- No file imports `isEngineReady` directly
- Safe to keep as export (preserved in new code)

### `createWhisperAdapter` - 1 external consumer
- `grep "createWhisperAdapter"` in `src/` → only `src/modules/speech/speech.js:3` imports it
- Safe — preserved in new code

### `transcribeAudioBuffer` / `analyzeAudioBufferWithVAD` / `preloadWhisperEngine` in `speech.web.js` body
- `grep "transcribeAudioBuffer|analyzeAudioBufferWithVAD|preloadWhisperEngine"` in `speech.web.js` → only on the import line (line 9)
- These names appear **nowhere else** in the file body — the import is dead
- Safe to delete the import line

### `export *` collision check
- `grep "export.*listeningState|export.*initLocalVoiceAI|export.*toggleSpeechRecognition"` in `speech.web.js` → 0 matches
- `speech.web.js` does NOT export any of those three names
- No collision with `export { listeningState, initLocalVoiceAI, toggleSpeechRecognition }` in `speech.js`

### `window.appStore` exposure - confirmed unconditional
- Wired in `src/hooks/use-app-bootstrap-webonly.js:31`:
  ```js
  // Intentional window.appStore — Playwright test bridge. Tests call
  // window.appStore.getState() from page.evaluate(). RN tests use different plumbing.
  window.appStore = appStore;
  ```
- Set unconditionally on every web mount (file is `@web-only`, not dev-gated)
- All 7 existing Playwright tests rely on this pattern
- Safe for test usage

### `answer-pipeline.test.js` mock isolation
- `src/modules/answer/answer-pipeline.test.js:7` mocks `app-vad-asr-web.js` wholesale:
  ```js
  vi.mock('../workers/whisper/app-vad-asr-web.js', () => ({ preloadWhisperEngine: vi.fn(), transcribeAudioBuffer: vi.fn() }));
  ```
- `answer-pipeline.test.js:8` also mocks `speech.js` wholesale:
  ```js
  vi.mock('./speech.js', () => ({ warmUpSpeechCamStream: vi.fn() }));
  ```
- `vi.mock` replaces the module entirely — doesn't validate against real export shape
- The test imports only `createAnswerPipeline` from `./answer-pipeline.js`, which doesn't import from `app-vad-asr-web.js` directly
- The module-level `new Worker(...)` call in `speech.js` never executes in JSDOM because `speech.js` is mocked
- Safe — changes to real modules don't break this test

### Direct importers of `speech.js`
- `src/App.jsx:4` — imports `initLocalVoiceAI` (preserved)
- `src/components/step-loader.web.js:6` — imports `warmUpSpeechCamStream`, `toggleSpeechRecognition`, `listeningState` (all preserved)
- `src/hooks/app-infra-webonly.js:22` — imports same three names (all preserved)
- None of these are test files
- All consume the public API which is re-exported unchanged from `speech.js`

### `safelyStopStream` / `stopLocalAudioTap` / `speechCamStream` exports
- `speech.web.js:45` — `export function safelyStopStream()`
- `speech.web.js:352` — `export async function stopLocalAudioTap()` (async!)
- `speech.web.js:20` — `export let speechCamStream = null`
- All exported and accessible via `mediaAdapter.*` in the `pagehide` handler

---

## Files to Modify

| # | File | Action |
|---|------|--------|
| 1 | `src/workers/whisper/app-vad-asr-web.js` | Replace entirely |
| 2 | `src/modules/speech/speech.web.js` | Delete line 9 (dead import) |
| 3 | `src/modules/speech/speech.js` | Replace entirely |
| 4 | `tests/whisper-page-cache-lifecycle.spec.js` | Create new file |

---

## Change 1: Replace `src/workers/whisper/app-vad-asr-web.js`

Replace the **entire file** with the following content:

```js
// app-vad-asr-web.js v3 - Lifecycle-managed adapter

import { appStore } from '../../modules/store/store.js';

export let isEngineReady = false;

export function createWhisperAdapter({ worker }) {
    const state = {
        isReady: false,
        worker,
        readyResolve: null,
        transcriptionResolve: null,
        vadResolvers: new Map(),
        vadIdCounter: 0,
        preloadTimer: null,
    };

    const messageHandler = function (e) {
        if (e.data.type === 'ready') {
            state.isReady = true;
            isEngineReady = true;
            appStore.getState().setWhisperReady(true);
            appStore.getState().setWhisperEngineFailed(false);
            console.log('[whisper] engine ready at', performance.now().toFixed(0), 'ms');
            if (state.preloadTimer) {
                clearTimeout(state.preloadTimer);
                state.preloadTimer = null;
            }
            if (state.readyResolve) {
                state.readyResolve();
                state.readyResolve = null;
            }
        }
        else if (e.data.type === 'diag') {
            console.log('[whisper:diag]', e.data.message);
        }
        else if (e.data.type === 'error') {
            console.error('[whisper] Engine initialization error:', e.data.message);
            appStore.getState().setWhisperEngineFailed(true);
            if (state.preloadTimer) {
                clearTimeout(state.preloadTimer);
                state.preloadTimer = null;
            }
            if (state.readyResolve) {
                state.readyResolve();
                state.readyResolve = null;
            }
        }
        else if (e.data.type === 'result') {
            if (state.transcriptionResolve) {
                state.transcriptionResolve(e.data);
                state.transcriptionResolve = null;
            }
        }
        else if (e.data.type === 'vad_result') {
            const resolver = state.vadResolvers.get(e.data.id);
            if (resolver) {
                resolver(e.data);
                state.vadResolvers.delete(e.data.id);
            }
        }
    };

    const errorHandler = (err) => {
        console.error('[whisper] worker error:', err);
        if (state.preloadTimer) {
            clearTimeout(state.preloadTimer);
            state.preloadTimer = null;
        }
        if (state.readyResolve) {
            state.readyResolve();
            state.readyResolve = null;
        }
    };

    state.worker.onmessage = messageHandler;
    state.worker.onerror = errorHandler;

    function preloadWhisperEngine() {
        return new Promise((resolve) => {
            if (state.isReady) {
                resolve();
                return;
            }
            state.readyResolve = resolve;
            state.preloadTimer = setTimeout(() => {
                if (!state.readyResolve) return;
                if (state.isReady) {
                    state.readyResolve();
                    state.readyResolve = null;
                    return;
                }
                console.warn('[whisper] Engine preload timed out after 120s');
                appStore.getState().setWhisperEngineFailed(true);
                state.readyResolve();
                state.readyResolve = null;
            }, 120000);
        });
    }

    function transcribeAudioBuffer(float32Array) {
        return new Promise((resolve) => {
            if (!state.isReady || !state.worker) {
                console.error('[whisper] engine not ready.');
                resolve(null);
                return;
            }
            state.transcriptionResolve = resolve;
            state.worker.postMessage({
                type: 'transcribe',
                audio: float32Array
            }, [float32Array.buffer]);
        });
    }

    function analyzeAudioBufferWithVAD(float32Array, options = {}) {
        return new Promise((resolve) => {
            if (!state.isReady || !state.worker) {
                console.error('[whisper] engine not ready for VAD.');
                resolve(null);
                return;
            }
            const id = state.vadIdCounter++;
            state.vadResolvers.set(id, resolve);
            state.worker.postMessage({
                type: 'vad_analyze',
                id: id,
                audio: float32Array,
                options: options
            }, [float32Array.buffer]);
        });
    }

    function terminate() {
        if (state.worker) {
            try {
                state.worker.terminate();
            } catch (e) {
                console.warn('[whisper] terminate error (worker may already be dead):', e);
            }
            state.worker = null;
        }
        state.isReady = false;
        isEngineReady = false;
        appStore.getState().setWhisperReady(false);
        appStore.getState().setWhisperEngineFailed(false);
        if (state.preloadTimer) {
            clearTimeout(state.preloadTimer);
            state.preloadTimer = null;
        }
        if (state.readyResolve) {
            state.readyResolve();
            state.readyResolve = null;
        }
        if (state.transcriptionResolve) {
            state.transcriptionResolve({ text: null });
            state.transcriptionResolve = null;
        }
        if (state.vadResolvers && state.vadResolvers.size > 0) {
            state.vadResolvers.forEach((r) => r({ trimmedAudio: null, stats: null }));
            state.vadResolvers.clear();
        }
        state.vadIdCounter = 0;
    }

    function rebindWorker(newWorker) {
        terminate();
        state.worker = newWorker;
        state.worker.onmessage = messageHandler;
        state.worker.onerror = errorHandler;
        state.isReady = false;
        isEngineReady = false;
    }

    return {
        preloadWhisperEngine,
        transcribeAudioBuffer,
        analyzeAudioBufferWithVAD,
        terminate,
        rebindWorker,
    };
}
```

### What changed from the original

- All mutable state consolidated into a single `state` object so `terminate`/`rebindWorker` can reset it
- `messageHandler` and `errorHandler` are named functions (so they can be re-attached to a new worker on rebind)
- New `terminate()` method: terminates worker, resets all state, resolves pending promises with null, clears timers, resets counters
- New `rebindWorker(newWorker)` method: terminates old worker, wires up new one, resets state
- `preloadTimer` captured and cleared on early success (fixes dangling 120s timeout)
- `vadIdCounter` reset in `terminate()` (clean slate after rebind)
- **Deleted** the 4 legacy stub exports (lines 128-131, 133-134 of original): `export function preloadWhisperEngine()`, `export function transcribeAudioBuffer()`, `export function analyzeAudioBufferWithVAD()`, `export async function startWhisperEngine()`, `export function stopWhisperEngine()` — all confirmed unused by grep

---

## Change 2: Edit `src/modules/speech/speech.web.js`

**Delete line 9** — the dead import:

```diff
 import Strings from '../../data/strings.js';
 import { saveSpeechRecording } from '../storage/storage.js';
 import { appStore, setWebcamStream } from '../store/store.js';
 import { DEFAULT_USER_AVATAR_URL } from '../user/tutor-config.js';

-import { transcribeAudioBuffer, analyzeAudioBufferWithVAD, preloadWhisperEngine } from '../../workers/whisper/app-vad-asr-web.js';
-
 // iOS detection disabled — iOS now uses same path as other devices
```

### Why this is safe

- Grep confirmed the three imported names (`transcribeAudioBuffer`, `analyzeAudioBufferWithVAD`, `preloadWhisperEngine`) appear **only** on this import line — nowhere in the file body
- The real implementations come from the adapter spread in `speech.js:29` (`...whisperAdapter`), not from these stub imports
- The legacy named exports in `app-vad-asr-web.js` (which these imports referenced) are deleted in Change 1

---

## Change 3: Replace `src/modules/speech/speech.js`

Replace the **entire file** with the following content:

```js
// modules/speech/speech.js v2 - Lifecycle-managed worker
import * as mediaAdapter from './speech.web.js';
import { createWhisperAdapter } from '../../workers/whisper/app-vad-asr-web.js';
import { updateSpeechRecording } from '../storage/storage.js';
import { createSpeechOrchestrator } from './speech-orchestrator.js';
import { getIsPWAMode } from '../user/demo-mode-webonly.js';
import { appStore } from '../store/store.js';

const isPWAMode = getIsPWAMode();
console.warn(`[speech] PWA mode ${isPWAMode ? 'ACTIVE (Sherpa-ONNX full Whisper + VAD)' : 'OFF (Transformers.js tiny.en — default)'}`);

function createWhisperWorker() {
    const w = isPWAMode
        ? new Worker(new URL('../../workers/whisper/whisper-worker-web.js', import.meta.url))
        : new Worker(
            new URL('../../workers/whisper/whisper-worker-demo.js', import.meta.url),
            { type: 'module' },
        );
    w.onerror = (err) => {
        console.error(`[speech] Worker failed to load (${isPWAMode ? 'pwa' : 'default'}):`, err);
    };
    return w;
}

let whisperWorker = createWhisperWorker();

const whisperAdapter = createWhisperAdapter({ worker: whisperWorker });

const { listeningState, initLocalVoiceAI, toggleSpeechRecognition } =
    createSpeechOrchestrator({
        ...mediaAdapter,
        ...whisperAdapter,
        updateSpeechRecording,
        getSpeechCamStream: () => mediaAdapter.speechCamStream,
    });

whisperAdapter.preloadWhisperEngine();

// ── Lifecycle: free WASM memory when the page is suspended ──────────────
// iOS Safari can suspend the page (via bfcache, page cache, or tab
// suspension) while the Web Worker holds ~100 MB of WASM/model data
// alive. pagehide fires before suspension regardless of the exact
// mechanism (reload, back/forward, tab switch, low-memory eviction),
// so terminating here works in all cases.
//
// Note: pagehide deliberately does NOT branch on event.persisted —
// termination should happen on ANY pagehide. Regular navigation tears
// down the page too, so the worker memory would leak either way.
// Only pageshow branches on event.persisted (recreation is only
// relevant for cache-restore).
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
        console.warn('[speech] pagehide: releasing Whisper worker + media resources');
        try {
            if (typeof mediaAdapter.stopLocalAudioTap === 'function') {
                mediaAdapter.stopLocalAudioTap().catch(() => {});
            }
        } catch (e) {
            console.warn('[speech] stopLocalAudioTap during pagehide failed:', e);
        }
        try {
            if (typeof mediaAdapter.safelyStopStream === 'function' && mediaAdapter.speechCamStream) {
                mediaAdapter.safelyStopStream(mediaAdapter.speechCamStream);
            }
        } catch (e) {
            console.warn('[speech] safelyStopStream during pagehide failed:', e);
        }
        try {
            if (whisperAdapter && typeof whisperAdapter.terminate === 'function') {
                whisperAdapter.terminate();
            }
        } catch (e) {
            console.warn('[speech] terminate during pagehide failed:', e);
        }
    });

    // Restore from page cache (event.persisted=true) — recreate the
    // worker and reinitialize. The orchestrator's "wait for engine
    // ready" polling handles the brief gap.
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            console.warn('[speech] pageshow from page-cache: recreating Whisper worker');
            try {
                whisperWorker = createWhisperWorker();
                whisperAdapter.rebindWorker(whisperWorker);
                whisperAdapter.preloadWhisperEngine();
            } catch (e) {
                console.error('[speech] page-cache restore failed:', e);
                appStore.getState().setWhisperEngineFailed(true);
            }
        }
    });
}

export { listeningState, initLocalVoiceAI, toggleSpeechRecognition };
export * from './speech.web.js';
```

### What changed from the original

- `const whisperWorker` → `let whisperWorker` (for reassignment on `pageshow`)
- Worker creation extracted into `createWhisperWorker()` helper for reuse on `pageshow`
- `appStore` imported at top (was not imported before)
- `pagehide` listener: calls `stopLocalAudioTap()` (with `.catch()` since it's async), `safelyStopStream()`, and `whisperAdapter.terminate()` — each in its own try/catch
- `pageshow` listener: if `event.persisted`, recreates worker, rebinds to adapter, reinitializes engine
- `export * from './speech.web.js'` preserved unchanged (no collision — verified by grep)

---

## Change 4: Create `tests/whisper-page-cache-lifecycle.spec.js`

Create this **new file**:

```js
// @ts-check
// tests/whisper-page-cache-lifecycle.spec.js
// Regression tests for the Whisper worker page-cache memory leak fix.
//
// Test 1 (lifecycle): directly dispatches synthetic pagehide/pageshow
// events to exercise the new handlers. This validates the code path
// that fixes the bug. It does NOT exercise real iOS Safari bfcache
// behavior — that requires manual on-device testing.
//
// Test 2 (reload smoke): reloads 3 times and verifies no OOM-related
// engine init errors appear. This catches the original symptom
// ("no available backend found" / "Out of memory") without validating
// the underlying mechanism.

import { test, expect } from '@playwright/test';

const LESSON_URL = '/course/gt2/lesson/a';

test.describe('Whisper page-cache lifecycle', () => {
    test('worker terminates on pagehide and reinitializes on pageshow(persisted)', async ({ page }) => {
        const initErrors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error' && /initialization error|no available backend|Out of memory/i.test(msg.text())) {
                initErrors.push(msg.text());
            }
        });
        page.on('pageerror', (err) => {
            if (/whisper/i.test(err.message)) initErrors.push(err.message);
        });

        await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });

        // Initial preload must complete
        await page.waitForFunction(
            () => window.appStore?.getState()?.isWhisperReady === true,
            { timeout: 90000 }
        );

        // ── pagehide: engine should flip to not-ready ──────────────────
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        });

        await page.waitForFunction(
            () => window.appStore?.getState()?.isWhisperReady === false,
            { timeout: 5000 }
        );

        // ── pageshow(persisted=true): engine should reinitialize ───────
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });

        await page.waitForFunction(
            () => window.appStore?.getState()?.isWhisperReady === true,
            { timeout: 90000 }
        );

        const finalReady = await page.evaluate(() => window.appStore.getState().isWhisperReady);
        expect(finalReady, 'engine should be ready again after pageshow(persisted)').toBe(true);

        expect(initErrors, `No init errors expected, got: ${initErrors.join('; ')}`).toHaveLength(0);
    });

    test('3 consecutive reloads do not produce engine init errors', async ({ page }) => {
        const initErrors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error' && /initialization error|no available backend|Out of memory/i.test(msg.text())) {
                initErrors.push(msg.text());
            }
        });

        for (let i = 0; i < 3; i++) {
            if (i === 0) {
                await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });
            } else {
                await page.reload({ waitUntil: 'domcontentloaded' });
            }

            await page.waitForFunction(
                () => window.appStore?.getState()?.isWhisperReady === true,
                { timeout: 90000 }
            );
        }

        expect(initErrors, `No init errors after 3 reloads, got: ${initErrors.join('; ')}`).toHaveLength(0);
    });
});
```

---

## Execution Order

Execute these steps in order:

1. **Change 1** — Replace `src/workers/whisper/app-vad-asr-web.js` (foundation: factory + lifecycle methods)
2. **Change 2** — Edit `src/modules/speech/speech.web.js` (delete dead import line 9 — depends on Change 1 having removed the stub exports)
3. **Change 3** — Replace `src/modules/speech/speech.js` (wires up the lifecycle handlers)
4. **Change 4** — Create `tests/whisper-page-cache-lifecycle.spec.js`

## Verification Steps

After all 4 changes are applied:

5. **Run unit tests** — `npx vitest run` (or equivalent npm script)
   - Verifies `answer-pipeline.test.js` and other Vitest tests survive the module-shape change
   - Expected: all pass (mocks isolate them from real module changes)

6. **Run existing Playwright regression tests** — `npx playwright test tests/answer-flow.spec.js tests/whisper-review.spec.js`
   - Verifies no regression in existing flows
   - Expected: all pass

7. **Run new Playwright test** — `npx playwright test tests/whisper-page-cache-lifecycle.spec.js`
   - Verifies the lifecycle handlers work (synthetic pagehide/pageshow)
   - Verifies 3 reloads don't produce OOM errors
   - Expected: both tests pass

8. **BLOCKING — Manual on-device iPad Safari test**
   - Open the app on iPad Safari
   - Reload the page 5+ times
   - Verify: no "Out of memory" or "no available backend found" errors
   - Verify: speech recognition still works after reloads
   - Verify: navigating back via swipe gesture restores speech (worker recreates)
   - This is a **hard blocker** — the fix is not "done" until this passes.
   - The automated tests validate the code path but cannot confirm the core assumption that `pagehide` fires before iOS page suspension.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Module-shape change breaks importers | Low | Grep evidence: only 1 direct importer (`speech.js`), uses preserved public API |
| JSDOM unit tests break from module-level `new Worker` | Low | `answer-pipeline.test.js` mocks both `speech.js` and `app-vad-asr-web.js` wholesale |
| `pagehide` cleanup throws and blocks termination | Low | Each cleanup step in its own try/catch; `stopLocalAudioTap()` has `.catch()` |
| `pageshow` rebind fails | Low | try/catch with `setWhisperEngineFailed(true)` fallback |
| Dangling 120s preload timeout | Fixed | `clearTimeout(state.preloadTimer)` on ready/error/terminate |
| `vadIdCounter` not reset on rebind | Fixed | `state.vadIdCounter = 0` in `terminate()` |
| Real iOS page-suspension doesn't fire `pagehide` | Medium | Manual iPad verification is BLOCKING; can't be validated in headless Chromium |
| Headless Chromium test gives false confidence | Low | Test comments explicitly acknowledge this; manual iPad test is the real validator |

---

## Net Change

- Modified files: 3
- New files: 1
- Lines added: ~210
- Lines removed: ~30
- Net change: ~180 lines