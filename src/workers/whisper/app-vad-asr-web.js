// app-vad-asr-web.js v3 - Lifecycle-managed adapter

import { appStore } from '../../modules/store/store.js';

export let isEngineReady = false;

// A transcription must never be able to sit unanswered forever: a dead or hung
// worker used to leave the learner on "transcribing" for the life of the page
// (stories/087-no-audio-capture). 45 s is far above a real tiny.en run even on
// an old tablet, so it only fires when the worker is genuinely gone.
export const TRANSCRIPTION_TIMEOUT_MS = 45000;

export function createWhisperAdapter({ worker }) {
    const state = {
        isReady: false,
        worker,
        readyResolve: null,
        transcriptionResolve: null,
        transcriptionTimer: null,
        vadResolvers: new Map(),
        vadIdCounter: 0,
        preloadTimer: null,
    };

    // The one place a pending transcription is settled. Clearing the timer here
    // means a late timeout can never resolve a promise that a `result` already
    // answered, and a `terminate` cannot leave the timer to fire on a dead
    // worker.
    const settleTranscription = (payload) => {
        const resolve = state.transcriptionResolve;
        if (state.transcriptionTimer) {
            clearTimeout(state.transcriptionTimer);
            state.transcriptionTimer = null;
        }
        if (!resolve) return;
        state.transcriptionResolve = null;
        resolve(payload);
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
            try { import('../../modules/utils/posthog.js').then(m => m.captureException?.(new Error(e.data.message || 'whisper init error'), { source: 'whisper-init' })); } catch {}
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
            settleTranscription(e.data);
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
        try { import('../../modules/utils/posthog.js').then(m => m.captureException?.(err instanceof Error ? err : new Error(String(err?.message || err)), { source: 'whisper-worker' })); } catch {}
        if (state.preloadTimer) {
            clearTimeout(state.preloadTimer);
            state.preloadTimer = null;
        }
        if (state.readyResolve) {
            state.readyResolve();
            state.readyResolve = null;
        }
        // The worker is gone. Without this the pending transcription promise is
        // never settled, so the UI waits on "transcribing" forever.
        appStore.getState().setWhisperEngineFailed(true);
        settleTranscription({ text: null, error: 'worker-error' });
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
            // Defensive: never hand the worker a zero-length buffer (Whisper has
            // nothing to decode and some builds never reply). The orchestrator
            // already gates on analyzeCapturedAudio, so this is the unit-level
            // backstop.
            if (!float32Array || float32Array.length === 0) {
                console.warn('[whisper] refusing to transcribe an empty buffer');
                resolve({ text: null, error: 'empty-audio' });
                return;
            }

            // A second request must not orphan the first resolver.
            if (state.transcriptionResolve) {
                settleTranscription({ text: null, error: 'superseded' });
            }

            state.transcriptionResolve = resolve;
            state.transcriptionTimer = setTimeout(() => {
                console.warn(`[whisper] transcription timed out after ${TRANSCRIPTION_TIMEOUT_MS} ms`);
                try { import('../../modules/utils/posthog.js').then(m => m.captureException?.(new Error('whisper transcription timeout'), { source: 'whisper-transcribe' })); } catch {}
                settleTranscription({ text: null, error: 'timeout' });
            }, TRANSCRIPTION_TIMEOUT_MS);

            try {
                state.worker.postMessage({
                    type: 'transcribe',
                    audio: float32Array
                }, [float32Array.buffer]);
            } catch (e) {
                console.error('[whisper] postMessage failed:', e);
                settleTranscription({ text: null, error: 'post-message-failed' });
            }
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
        settleTranscription({ text: null, error: 'terminated' });
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
