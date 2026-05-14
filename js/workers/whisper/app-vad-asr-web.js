// app-vad-asr-web.js v2

import { appStore } from '../../modules/store.js';

export let isEngineReady = false;
let whisperWorker = null;
let activeTranscriptionResolve = null;
let activeVadResolvers = new Map();
let vadRequestIdCounter = 0;

export function preloadWhisperEngine() {
    return new Promise((resolve, reject) => {
        if (whisperWorker) {
            // Worker already exists — check if it's already ready
            if (isEngineReady) {
                resolve();
            } else {
                // Worker is loading — poll until ready
                const interval = setInterval(() => {
                    if (isEngineReady) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 50);
            }
            return;
        }

        console.log('[whisper] spawning worker at', performance.now().toFixed(0), 'ms');

        const params = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search)
            : new URLSearchParams();
        const isDemoMode = params.has('demo');

        const workerOptions = isDemoMode ? { type: 'module' } : {};
        whisperWorker = new Worker(new URL(
            isDemoMode ? './whisper-worker-demo.js' : './whisper-worker-web.js',
            import.meta.url
        ), workerOptions);
        whisperWorker.onmessage = function (e) {
            if (e.data.type === 'ready') {
                isEngineReady = true;
                // REFACTORED: Push to Zustand
                appStore.getState().setWhisperReady(true);
                window.whisperEngineReady = true; // (Safe to leave this as a fallback for now)
                console.log('[whisper] engine ready at', performance.now().toFixed(0), 'ms');

                const preloader = document.getElementById('appLoadingImageDiv');
                if (preloader) preloader.style.display = 'none';

                resolve();
            }
            else if (e.data.type === 'result') {
                if (activeTranscriptionResolve) {
                    activeTranscriptionResolve(e.data);
                    activeTranscriptionResolve = null;
                }
            }
            else if (e.data.type === 'vad_result') {
                const resolver = activeVadResolvers.get(e.data.id);
                if (resolver) {
                    resolver(e.data);
                    activeVadResolvers.delete(e.data.id);
                }
            }
        };

        whisperWorker.onerror = (err) => {
            console.error('[whisper] worker error:', err);
            reject(err);
        };
    });
}

export function transcribeAudioBuffer(float32Array) {
    return new Promise((resolve) => {
        if (!isEngineReady || !whisperWorker) {
            console.error('[whisper] engine not ready.');
            resolve(null);
            return;
        }

        activeTranscriptionResolve = resolve;

        // Transfer the buffer (zero-copy) instead of cloning it
        whisperWorker.postMessage({
            type: 'transcribe',
            audio: float32Array
        }, [float32Array.buffer]);
    });
}

export function analyzeAudioBufferWithVAD(float32Array, options = {}) {
    return new Promise((resolve) => {
        if (!isEngineReady || !whisperWorker) {
            console.error('[whisper] engine not ready for VAD.');
            resolve(null);
            return;
        }

        const id = vadRequestIdCounter++;
        activeVadResolvers.set(id, resolve);

        whisperWorker.postMessage({
            type: 'vad_analyze',
            id: id,
            audio: float32Array,
            options: options
        }, [float32Array.buffer]);
    });
}

// Kick off worker loading immediately when this module is imported —
// don't wait for a user action. This is the single biggest latency win
// if you were previously calling preloadWhisperEngine() on a button click
// or after some other async gate.
preloadWhisperEngine();

// Stubs to prevent errors with existing code
export async function startWhisperEngine(options) { return false; }
export function stopWhisperEngine() { }
