// ── Step 1: Imports ────────────────────────────────────────────────────
// iOS workaround disabled — iOS now uses bundled ORT like all other platforms.
// import { isIOS } from '../../utils/detectIOS.js';

const SILENT_LOGS = false;

function postDiag(msg) {
    self.postMessage({ type: 'diag', message: msg });
}

postDiag('Worker started, platform=' + (navigator.platform || '?'));

// ── Step 2: iOS workaround disabled — all platforms use the same ORT path ──
// transformers checks globalThis[Symbol.for('onnxruntime')] on startup.
// If set, it uses that ORT instead of its bundled copy.
let pipeline, env;

// iOS now uses the same bundled ORT as other devices
postDiag('Using bundled ORT');

// ── Step 3: Import transformers (uses our ORT on iOS, bundled on others)
const tf = await import('@huggingface/transformers');
pipeline = tf.pipeline;
env = tf.env;

// ── Step 5: Configure transformers env ────────────────────────────────
env.allowLocalModels = false;
env.useBrowserCache = true;
env.remoteHost = 'https://r2.ultrafastfluency.com';
env.remotePathTemplate = 'whisper/{model}/';

env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

postDiag('Transformers.js version: ' + (env.version || '?'));
postDiag('wasmPaths: ' + env.backends.onnx.wasm.wasmPaths);
postDiag('numThreads: ' + env.backends.onnx.wasm.numThreads);

// ── Step 6: Rest of worker (unchanged from here) ──────────────────────
//
// Model caching is deliberately NOT hand-rolled here. Transformers.js already
// fetches every file it needs (config.json, tokenizer.json and both ONNX
// graphs — ~41 MB) and caches it via the Cache API under `transformers-cache`
// (see env.useBrowserCache above), so later loads read from cache.
//
// This worker used to pre-download the two ONNX graphs itself (~9.7 MB encoder,
// ~29.3 MB decoder), in sequence, into a separate `uff-whisper-demo-cache-v1`
// bucket, immediately before booting the pipeline.
//
// That pass could not do what it was written to do: Transformers.js opens its
// own `transformers-cache` bucket, so pipeline() never saw those entries. What
// it actually cost, on the critical path to a working mic:
//
//   - it serialised the wait — the 9.7 MB file had to finish before the 29.3 MB
//     one started, and neither began until both were done, before pipeline()
//     even ran;
//   - it buffered the whole 29.3 MB decoder through JS heap via
//     response.arrayBuffer() just to hand it to the cache — a ~29 MB spike on a
//     phone that buys nothing;
//   - on a device that had never loaded the model it also transferred the same
//     ~41 MB a second time (the R2 objects carry only ETag/Last-Modified, no
//     Cache-Control, so a revisit may hit the HTTP cache heuristically — hence
//     "may", not "always").
//
// pipeline() fetches and caches in one pass, so removing the loop drops the
// serialised pre-pass, the heap spike and the unread bucket write together.
// Offline reuse is unaffected: env.useBrowserCache still populates
// transformers-cache, which is what later loads read.

postDiag('HW: mem=' + (navigator.deviceMemory || '?') + 'GB, cores=' + navigator.hardwareConcurrency);

let transcriber = null;
let selectedDevice = 'wasm';

const PIPELINE_OPTIONS = {
    dtype: {
        encoder_model: 'q8',
        decoder_model_merged: 'q8',
    },
};

const SESSION_OPTIONS = {
    enableCpuMemArena: false,
    enableMemPattern: false,
    executionMode: 'sequential',
    graphOptimizationLevel: 'basic',
    freeDimensionOverrides: {
        sequence_length: 1,
        past_sequence_length: 0,
    },
};

async function tryBootPipeline(device) {
    postDiag('Booting pipeline with device: ' + device + '...');
    postDiag('Session options: ' + JSON.stringify(SESSION_OPTIONS));
    const result = await pipeline(
        'automatic-speech-recognition',
        'onnx-community/whisper-tiny.en',
        { device, ...PIPELINE_OPTIONS, session_options: SESSION_OPTIONS },
    );
    postDiag('Pipeline created with device: ' + device);
    return result;
}

async function bootWhisperEngine() {
    try {
        const coi = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'undefined';
        postDiag('crossOriginIsolated: ' + coi);

        const devices = ['wasm'];

        postDiag('Booting pipeline (it fetches + caches the model files itself)...');

        let lastError = null;
        for (const device of devices) {
            try {
                selectedDevice = device;
                transcriber = await tryBootPipeline(device);
                postDiag('Demo engine ready (' + device + ')');
                self.postMessage({ type: 'ready' });
                return;
            } catch (error) {
                lastError = error;
                transcriber = null;
                postDiag(device + ' failed: ' + error.name + ' ' + error.message);
                if (error.stack) {
                    const lines = error.stack.split('\n');
                    postDiag('Stack: ' + lines.slice(0, 3).join(' | '));
                }
            }
        }

        postDiag('All backends failed: ' + lastError.name + ': ' + lastError.message);
        self.postMessage({ type: 'error', message: lastError.name + ': ' + lastError.message });

    } catch (error) {
        postDiag('Fatal boot error: ' + error.name + ': ' + error.message);
        self.postMessage({ type: 'error', message: error.name + ': ' + error.message });
    }
}

bootWhisperEngine();

self.onmessage = async function (e) {
    if (e.data.type === 'transcribe' && transcriber) {
        try {
            const result = await transcriber(e.data.audio, {
                sampling_rate: 16000,
            });

            self.postMessage({
                type: 'result',
                text: result.text,
            });

        } catch (error) {
            console.error('[whisper-demo] Transcription error:', error);
            self.postMessage({ type: 'result', text: null });
        }
    } else if (e.data.type === 'vad_analyze') {
        try {
            const audio = e.data.audio;
            const threshold = e.data.options?.threshold || 0.02;
            const sampleRate = e.data.options?.sampleRate || 16000;

            let dcOffset = 0;
            const dcWindow = Math.floor(0.05 * sampleRate);
            for (let i = 0; i < dcWindow && i < audio.length; i++) dcOffset += audio[i];
            dcOffset /= dcWindow;
            for (let i = 0; i < audio.length; i++) audio[i] -= dcOffset;

            const minSpeechFrames = Math.floor(0.025 * sampleRate);
            let start = audio.length;
            let tempStart = Math.floor(0.1 * sampleRate);

            while (tempStart < audio.length) {
                if (Math.abs(audio[tempStart]) >= threshold) {
                    let sustained = 0;
                    for (let j = 0; j < minSpeechFrames && (tempStart + j) < audio.length; j++) {
                        if (Math.abs(audio[tempStart + j]) >= threshold * 0.7) sustained++;
                    }
                    if (sustained > minSpeechFrames * 0.6) {
                        start = tempStart;
                        break;
                    }
                }
                tempStart++;
            }

            if (start === audio.length) {
                for (let i = 0; i < Math.floor(0.1 * sampleRate); i++) {
                    if (Math.abs(audio[i]) > threshold * 3) {
                        start = i;
                        break;
                    }
                }
            }

            let end = audio.length - 1;
            while (end > start && Math.abs(audio[end]) < threshold) end--;

            const hesitation = Math.round((start / sampleRate) * 1000);
            const netDuration = Math.max(0, (end - start) / sampleRate);

            self.postMessage({
                type: 'vad_result',
                id: e.data.id,
                stats: {
                    pauseCount: 0,
                    hesitation,
                    netDuration,
                    speechStart: start / sampleRate,
                    speechEnd: end / sampleRate
                },
                trimmedAudio: audio
            });
        } catch (error) {
            console.error('[whisper-demo] VAD analysis failed:', error);
            self.postMessage({ type: 'vad_result', stats: null });
        }
    }
};
