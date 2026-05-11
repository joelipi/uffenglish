// whisper-worker-web.js v5 - Aggressive Parallelization
const WHISPER_BASE_PATH = 'https://r2.ultrafastfluency.com/whisper/';
const MODEL_CACHE_NAME = 'uff-whisper-cache-v3';

let vad = null;
let recognizer = null;
let isReady = false;

self.Module = {
    locateFile: function (path) {
        return WHISPER_BASE_PATH + path;
    },
    setStatus: function (status) { }
};

async function loadAndCacheFile(filename, isWasm) {
    const url = WHISPER_BASE_PATH + filename;
    const cache = await caches.open(MODEL_CACHE_NAME);
    let response = await cache.match(url);

    if (response) {
        console.log(`[whisper] ⚡ CACHE HIT: ${filename}`);
    } else {
        console.log(`[whisper] ☁️ CACHE MISS: Downloading ${filename}...`);
        response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP Error ${response.status} for ${filename}`);

        const buffer = await response.arrayBuffer();
        console.log(`[whisper] 💾 SAVING: Caching ${filename}`);
        try {
            await cache.put(url, new Response(buffer.slice(0), { headers: response.headers }));
        } catch (cacheError) {
            console.warn(`[whisper] ⚠️ Cache.put failed for ${filename}:`, cacheError);
        }
        response = new Response(buffer, { headers: response.headers });
    }

    return isWasm ? response : await response.arrayBuffer();
}

async function bootWhisperEngine() {
    try {
        console.log('[whisper] Initiating pre-fetch...');
        const [wasmResponse, dataBuffer] = await Promise.all([
            loadAndCacheFile('sherpa-onnx-wasm-main-vad-asr.wasm', true),
            loadAndCacheFile('sherpa-onnx-wasm-main-vad-asr.data', false)
        ]);

        self.Module.getPreloadedPackage = function () { return dataBuffer; };

        self.Module.instantiateWasm = function (imports, successCallback) {
            // Using instantiateStreaming is critical for SIMD/Multi-thread compiled WASM
            WebAssembly.instantiateStreaming(wasmResponse, imports)
                .then(output => successCallback(output.instance, output.module))
                .catch(e => console.error('[whisper] WASM Compile Error:', e));
            return {};
        };

        self.Module.onRuntimeInitialized = function () {
            console.time('[whisper] total init');

            let config = {
                modelConfig: {
                    debug: 0,
                    num_threads: navigator.hardwareConcurrency || 4, // 🚀 CORE OPTIMIZATION: Uses all available CPU threads
                    provider: "cpu", // Ensures it uses the optimized CPU provider
                    tokens: './tokens.txt',
                    whisper: {
                        encoder: './whisper-encoder.onnx',
                        decoder: './whisper-decoder.onnx',
                    }
                },
                decoderConfig: {
                    method: "greedy_search",
                    num_active_paths: 1
                }
            };

            recognizer = new OfflineRecognizer(config, self.Module);
            isReady = true;

            console.timeEnd('[whisper] total init');
            self.postMessage({ type: 'ready' });
            vad = createVad(self.Module);
        };

        importScripts(
            WHISPER_BASE_PATH + 'sherpa-onnx-vad.js',
            WHISPER_BASE_PATH + 'sherpa-onnx-asr.js',
            WHISPER_BASE_PATH + 'sherpa-onnx-wasm-main-vad-asr.js'
        );

    } catch (error) {
        console.error('[whisper] Fatal Boot Error:', error);
    }
}

bootWhisperEngine();

self.onmessage = function (e) {
    if (e.data.type === 'transcribe' && isReady) {
        try {
            const float32Array = e.data.audio;
            const stream = recognizer.createStream();
            stream.acceptWaveform(16000, float32Array);

            console.time('[whisper] decode speed');
            recognizer.decode(stream);
            console.timeEnd('[whisper] decode speed');

            const fullResult = recognizer.getResult(stream);
            stream.free();

            self.postMessage({
                type: 'result',
                text: fullResult.text,
                avg_logprob: fullResult.avg_logprob
            });
        } catch (error) {
            console.error('[whisper] transcription error:', error);
            self.postMessage({ type: 'result', text: null });
        }
    }
};