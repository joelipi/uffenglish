// whisper-worker-web.js v5 - Aggressive Parallelization
// SILENCE LOGS FOR PRODUCTION/CLEAN CONSOLE
const SILENT_LOGS = true; 
if (SILENT_LOGS) {
    console.log = () => {};
    console.time = () => {};
    console.timeEnd = () => {};
}
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

            // Use Device Memory API if available, assume 4GB if missing
            const deviceMemory = navigator.deviceMemory || 4;
            
            // If the device has low memory (< 4GB), aggressively cap to 2 threads to prevent OOM
            // Otherwise, use available cores up to 8 (diminishing returns beyond 8 for ONNX WASM)
            const safeThreadCount = deviceMemory < 4 
                ? 2 
                : Math.min(navigator.hardwareConcurrency || 4, 8);

            console.log(`[whisper] 🛠️ Hardware Info: Memory=${deviceMemory}GB, Cores=${navigator.hardwareConcurrency}, SelectedThreads=${safeThreadCount}, SharedArrayBuffer=${typeof SharedArrayBuffer !== 'undefined'}`);

            let config = {
                modelConfig: {
                    debug: 1,
                    num_threads: safeThreadCount, // 🚀 CORE OPTIMIZATION: Caps threads to prevent crashes
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
            vad = createVad(self.Module);
            self.postMessage({ type: 'ready' });
        };

        importScripts(
            '/whisper/sherpa-onnx-vad.js',
            '/whisper/sherpa-onnx-asr.js',
            '/whisper/sherpa-onnx-wasm-main-vad-asr.js'
        );

    } catch (error) {
        console.error('[whisper] Fatal Boot Error:', error);
        self.postMessage({ type: 'error', message: error.message });
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
    } else if (e.data.type === 'vad_analyze' && isReady && vad) {
        try {
            const { audio, options, id } = e.data;
            const sampleRate = options.sampleRate || 16000;
            const preRollFrames = Math.floor((options.preRoll || 0.2) * sampleRate);
            const postRollFrames = Math.floor((options.postRoll || 0.2) * sampleRate);

            vad.reset();
            vad.acceptWaveform(audio);
            vad.flush();

            let segments = [];
            while (!vad.isEmpty()) {
                const seg = vad.front();
                // Copy the samples as seg.samples might be freed/overwritten
                segments.push({
                    start: seg.start,
                    samples: new Float32Array(seg.samples),
                    length: seg.samples.length
                });
                vad.pop();
            }

            if (segments.length === 0) {
                console.log('[whisper-web] VAD found 0 speech segments. Returning full audio.');
                self.postMessage({
                    type: 'vad_result',
                    id: id,
                    trimmedAudio: audio,
                    stats: { pauseCount: 0, hesitation: 0, netDuration: audio.length / sampleRate, speechStart: 0, speechEnd: 0 }
                });
                return;
            }

            console.log(`[whisper-web] VAD found ${segments.length} segments.`);
            segments.forEach((seg, i) => {
                console.log(`[whisper-web] Seg ${i}: start=${seg.start}, length=${seg.length}`);
            });

            let startFrame = segments[0].start;
            let endFrame = segments[segments.length - 1].start + segments[segments.length - 1].length;

            const hesitation = Math.round((startFrame / sampleRate) * 1000);
            const speechStart = startFrame / sampleRate;
            const speechEnd = endFrame / sampleRate;

            let pauseCount = 0;
            let netFrames = 0;
            const pauseThresholdFrames = Math.floor(0.6 * sampleRate);

            for (let i = 0; i < segments.length; i++) {
                netFrames += segments[i].length;
                if (i > 0) {
                    const pauseLength = segments[i].start - (segments[i - 1].start + segments[i - 1].length);
                    if (pauseLength >= pauseThresholdFrames) {
                        pauseCount++;
                    }
                }
            }

            const netDuration = netFrames / sampleRate;

            // We no longer slice the audio based on VAD boundaries for transcription.
            // Whisper is perfectly capable of ignoring silence, and slicing it was causing 
            // valid speech to be dropped if the VAD miscalculated the end frame.
            // We still return the VAD metrics (hesitation, pauses) for the scoring UI.
            self.postMessage({
                type: 'vad_result',
                id: id,
                trimmedAudio: audio, // Pass the full, intact audio to Whisper
                stats: {
                    pauseCount: pauseCount,
                    hesitation: hesitation,
                    netDuration: netDuration,
                    speechStart: speechStart,
                    speechEnd: speechEnd
                }
            }); // Let structured clone handle the buffer transfer safely

        } catch (error) {
            console.error('[whisper] VAD analysis error:', error);
            // fallback
            self.postMessage({
                type: 'vad_result',
                id: e.data.id,
                trimmedAudio: e.data.audio,
                stats: { pauseCount: 0, hesitation: 0, netDuration: e.data.audio.length / (e.data.options.sampleRate || 16000), speechStart: 0, speechEnd: 0 }
            });
        }
    }
};