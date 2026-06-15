// app-vad-asr-web.js v2

import { appStore } from '../../modules/store/store.js';

export let isEngineReady = false;
let whisperWorker = null;
let activeTranscriptionResolve = null;
let activeVadResolvers = new Map();
let vadRequestIdCounter = 0;

export function createWhisperAdapter({ worker }) {
    let adapterIsEngineReady = false;
    let adapterWhisperWorker = worker;
    let adapterReadyResolve = null;
    let adapterActiveTranscriptionResolve = null;
    let adapterActiveVadResolvers = new Map();
    let vadIdCounter = 0;

    adapterWhisperWorker.onmessage = function (e) {
        if (e.data.type === 'ready') {
            adapterIsEngineReady = true;
            isEngineReady = true;
            appStore.getState().setWhisperReady(true);
            appStore.getState().setWhisperEngineFailed(false);
            console.log('[whisper] engine ready at', performance.now().toFixed(0), 'ms');
            if (adapterReadyResolve) {
                adapterReadyResolve();
                adapterReadyResolve = null;
            }
        }
        else if (e.data.type === 'error') {
            console.error('[whisper] Engine initialization error:', e.data.message);
            if (e.data.detail) console.error('[whisper] Error detail:', e.data.detail);
            appStore.getState().setWhisperEngineFailed(true);
            if (adapterReadyResolve) {
                adapterReadyResolve();
                adapterReadyResolve = null;
            }
        }
        else if (e.data.type === 'result') {
            if (adapterActiveTranscriptionResolve) {
                adapterActiveTranscriptionResolve(e.data);
                adapterActiveTranscriptionResolve = null;
            }
        }
        else if (e.data.type === 'vad_result') {
            const resolver = adapterActiveVadResolvers.get(e.data.id);
            if (resolver) {
                resolver(e.data);
                adapterActiveVadResolvers.delete(e.data.id);
            }
        }
    };

    adapterWhisperWorker.onerror = (err) => {
        console.error('[whisper] worker error:', err);
        if (adapterReadyResolve) {
            adapterReadyResolve();
            adapterReadyResolve = null;
        }
    };

    function preloadWhisperEngine() {
        return new Promise((resolve) => {
            if (adapterIsEngineReady) {
                resolve();
                return;
            }
            adapterReadyResolve = resolve;
            setTimeout(() => {
                if (adapterReadyResolve) {
                    console.warn('[whisper] Engine preload timed out after 30s');
                    appStore.getState().setWhisperEngineFailed(true);
                    adapterReadyResolve();
                    adapterReadyResolve = null;
                }
            }, 30000);
        });
    }

    function transcribeAudioBuffer(float32Array) {
        return new Promise((resolve) => {
            if (!adapterIsEngineReady || !adapterWhisperWorker) {
                console.error('[whisper] engine not ready.');
                resolve(null);
                return;
            }

            adapterActiveTranscriptionResolve = resolve;

            adapterWhisperWorker.postMessage({
                type: 'transcribe',
                audio: float32Array
            }, [float32Array.buffer]);
        });
    }

    function analyzeAudioBufferWithVAD(float32Array, options = {}) {
        return new Promise((resolve) => {
            if (!adapterIsEngineReady || !adapterWhisperWorker) {
                console.error('[whisper] engine not ready for VAD.');
                resolve(null);
                return;
            }

            const id = vadIdCounter++;
            adapterActiveVadResolvers.set(id, resolve);

            adapterWhisperWorker.postMessage({
                type: 'vad_analyze',
                id: id,
                audio: float32Array,
                options: options
            }, [float32Array.buffer]);
        });
    }

    return { preloadWhisperEngine, transcribeAudioBuffer, analyzeAudioBufferWithVAD };
}

// Legacy named exports (kept for backward compat with speech.web.js unused import)
export function preloadWhisperEngine() { return Promise.resolve(); }
export function transcribeAudioBuffer() { return Promise.resolve(null); }
export function analyzeAudioBufferWithVAD() { return Promise.resolve(null); }

export async function startWhisperEngine(options) { return false; }
export function stopWhisperEngine() { }
