import { pipeline, env } from '@huggingface/transformers';

// Keep logs enabled: stubbing console.log / console.time breaks onnxruntime-web
// internal profiling on some platforms (Android).
const SILENT_LOGS = false;

// Workers' console output doesn't appear in Safari Web Inspector main-thread view.
// Use postDiag() to relay diagnostics to the main thread.
function postDiag(msg) {
    self.postMessage({ type: 'diag', message: msg });
}

env.allowLocalModels = false;
env.useBrowserCache = true;
env.remoteHost = 'https://r2.ultrafastfluency.com';
env.remotePathTemplate = 'whisper/{model}/';

postDiag('Transformers.js version: 4.2.0');

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
    // Re-read from cache instead of holding the buffer in memory
    return await cache.match(url);
}

        //WebGPU wasn't working on Android so I'm giving up for now
/*
async function detectWebGPUSupport() {
    try {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        const device = await adapter.requestDevice();
        device.destroy();
        return true;
    } catch {
        return false;
    }
}
*/

// Single-thread only: ONNX WASM multi-threading (>1) hangs the pipeline
// on Cloudflare Pages. The 1-thread path is stable everywhere.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

// Cap WASM memory to prevent 2 GB heap reservation on iOS.
try {
    const wasmMem = new WebAssembly.Memory({
        initial: 256,   // 16 MB
        maximum: 3072,  // 192 MB — tight cap avoids virtual address reservation OOM
    });
    env.backends.onnx.wasm.wasmMemory = wasmMem;
    postDiag('wasmMemory set, max=192MB');
} catch (e) {
    postDiag('wasmMemory failed: ' + e.message);
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
        env.backends.onnx.wasm.wasmPaths = '/wasm/';
        const coi = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'undefined';
        postDiag('crossOriginIsolated: ' + coi);
        postDiag('WASM paths: ' + env.backends.onnx.wasm.wasmPaths);

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
        // The demo worker doesn't have the Sherpa-ONNX VAD engine, 
        // so we perform a basic threshold-based analysis to provide flow metrics.
        try {
            const audio = e.data.audio;
            const threshold = e.data.options?.threshold || 0.02;
            const sampleRate = e.data.options?.sampleRate || 16000;

            // 1. DC Offset Removal (Average out the first 50ms to remove hum)
            let dcOffset = 0;
            const dcWindow = Math.floor(0.05 * sampleRate);
            for (let i = 0; i < dcWindow && i < audio.length; i++) dcOffset += audio[i];
            dcOffset /= dcWindow;
            for (let i = 0; i < audio.length; i++) audio[i] -= dcOffset;

            // 2. Sustained Speech Check with Hardware Pop Suppression
            const minSpeechFrames = Math.floor(0.025 * sampleRate); // 25ms window
            let start = audio.length;

            // Skip the first 100ms for onset detection to ignore mic connection pops
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

            // If no speech found after the 100ms skip, check if it was actually in the first 100ms
            // but only if it's extremely loud (likely a fast response, not a pop)
            if (start === audio.length) {
                for (let i = 0; i < Math.floor(0.1 * sampleRate); i++) {
                    if (Math.abs(audio[i]) > threshold * 3) { // 3x threshold
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
                trimmedAudio: audio // Pass full audio, no slicing
            });
        } catch (error) {
            console.error('[whisper-demo] VAD analysis failed:', error);
            self.postMessage({ type: 'vad_result', stats: null });
        }
    }
};
