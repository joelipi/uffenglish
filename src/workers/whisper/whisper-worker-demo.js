// ── Step 1: Imports ────────────────────────────────────────────────────
// On iOS, we load ORT 1.17.3 which has capped MAXIMUM_MEMORY (no OOM).
// On all other platforms, we let transformers use its bundled ORT.
import { isIOS } from '../../utils/detectIOS.js';

const SILENT_LOGS = false;

function postDiag(msg) {
    self.postMessage({ type: 'diag', message: msg });
}

postDiag('Worker started, platform=' + (navigator.platform || '?'));

// ── Step 2: On iOS ONLY, load ORT 1.17.3 and set global symbol ─────────
// transformers checks globalThis[Symbol.for('onnxruntime')] on startup.
// If set, it uses that ORT instead of its bundled copy.
let pipeline, env;

if (isIOS()) {
    postDiag('iOS detected — loading ORT 1.17.3 from CDN');
    const ort = await import('onnxruntime-web');
    ort.env.wasm.wasmPaths = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.3/';
    ort.env.wasm.simd = false;
    ort.env.wasm.numThreads = 1;
    globalThis[Symbol.for('onnxruntime')] = ort;
    postDiag('ORT 1.17.3 registered globally');
} else {
    // Non-iOS: single-thread for Cloudflare Pages, use default bundled ORT
    postDiag('Non-iOS — using bundled ORT');
}

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

const DEMO_CACHE_NAME = 'uff-whisper-demo-cache-v1';
const DEMO_MODEL_FILES = [
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
];

async function loadAndCacheFile(filePath) {
    const url = `https://r2.ultrafastfluency.com/whisper/onnx-community/whisper-tiny.en/${filePath}`;
    const cache = await caches.open(DEMO_CACHE_NAME);
    let response = await cache.match(url);

    if (response) {
        console.log(`[whisper-demo] CACHE HIT: ${filePath}`);
        return response;
    }

    console.log(`[whisper-demo] CACHE MISS: Downloading ${filePath}...`);
    response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP Error ${response.status} for ${filePath}`);

    const buffer = await response.arrayBuffer();
    await cache.put(url, new Response(buffer, { headers: response.headers }));
    return await cache.match(url);
}

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

        postDiag('Pre-caching ' + DEMO_MODEL_FILES.length + ' ONNX files sequentially...');
        for (const file of DEMO_MODEL_FILES) {
            await loadAndCacheFile(file);
        }
        postDiag('ONNX files cached, booting pipeline...');

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
