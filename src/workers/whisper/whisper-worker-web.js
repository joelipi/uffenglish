// whisper-worker-web.js v5 - Aggressive Parallelization

// iOS detection — commented out so iOS uses the same path as other devices
// function isIOSWorker() {
//   return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
//     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
//     /iPad/i.test(navigator.platform);
// }

// ── Startup diagnostics — must fire before anything else ───────────────
// Post directly (postDiag not defined yet) so we can tell if the worker
// even loads on iOS. Also catch unhandled errors.
self.postMessage({ type: 'diag', message: 'Worker started, platform=' + (navigator.platform || '?') });

self.onerror = function(e) {
    self.postMessage({ type: 'diag', message: 'UNHANDLED ERROR: ' + (e.message || e) });
};
self.onunhandledrejection = function(e) {
    self.postMessage({ type: 'diag', message: 'UNHANDLED REJECTION: ' + (e.reason?.message || e.reason || e) });
};

function postDiag(msg) {
    self.postMessage({ type: 'diag', message: msg });
}

// SILENCE LOGS FOR PRODUCTION/CLEAN CONSOLE
const SILENT_LOGS = true; 
if (SILENT_LOGS) {
    console.log = () => {};
    console.time = () => {};
    console.timeEnd = () => {};
    // Workers' console.warn/error don't appear in Safari Web Inspector
    // main-thread view. Use postDiag() to relay diagnostics to main thread.
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
        // Load sequentially to avoid keeping both the 99 MB .data ArrayBuffer
        // and the 11 MB .wasm compilation live simultaneously on low-memory devices.
        let wasmResponse = await loadAndCacheFile('sherpa-onnx-wasm-main-vad-asr.wasm', true);
        let dataBuffer = await loadAndCacheFile('sherpa-onnx-wasm-main-vad-asr.data', false);

        self.Module.getPreloadedPackage = function () { return dataBuffer; };

        self.Module.instantiateWasm = function (imports, successCallback) {
            WebAssembly.instantiateStreaming(wasmResponse, imports)
                .then(output => {
                    const memory = output.instance.exports.M;
                    if (memory) {
                        const mb = (memory.buffer.byteLength / 1048576).toFixed(1);
                        postDiag('WASM compiled. Initial memory: ' + mb + ' MB');
                        const originalGrow = memory.grow.bind(memory);
                        memory.grow = function (pages) {
                            const beforeMB = (memory.buffer.byteLength / 1048576).toFixed(1);
                            const growthMB = (pages * 64 / 1024).toFixed(1);
                            try {
                                const result = originalGrow(pages);
                                const afterMB = (memory.buffer.byteLength / 1048576).toFixed(1);
                                postDiag('WASM grow: ' + beforeMB + ' MB -> ' + afterMB + ' MB (+' + growthMB + ' MB)');
                                return result;
                            } catch (e) {
                                postDiag('WASM grow FAILED: ' + beforeMB + ' MB -> +' + growthMB + ' MB, ' + e.message);
                                return -1;
                            }
                        };
                    } else {
                        postDiag('WASM compiled, no memory export');
                    }
                    wasmResponse = null;
                    successCallback(output.instance, output.module);
                })
                .catch(e => {
                    postDiag('WASM Compile Error: ' + (e.message || e));
                    self.postMessage({ type: 'error', message: 'WASM compilation failed: ' + e.message });
                });
            return {};
        };

        self.Module.onRuntimeInitialized = function () {
            dataBuffer = null;
            const dm = navigator.deviceMemory || '?';
            const hc = navigator.hardwareConcurrency || '?';
            const sab = typeof SharedArrayBuffer !== 'undefined' ? 'yes' : 'no';
            let safeThreads = (dm < 4 || dm === '?') ? 2 : Math.min(hc || 4, 8);
            // iOS workaround disabled — iOS now uses the same thread count as other devices
            // if (isIOSWorker()) {
            //     postDiag('iOS detected — forcing single-threaded to avoid WASM pthread hang');
            //     safeThreads = 1;
            // }
            postDiag('HW: mem=' + dm + 'GB, cores=' + hc + ', threads=' + safeThreads + ', SAB=' + sab);
            try {
                let config = {
                    modelConfig: {
                        debug: 1,
                        num_threads: safeThreads,
                        provider: "cpu",
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
                postDiag('OfflineRecognizer created');
                isReady = true;
                try {
                    vad = createVad(self.Module);
                    postDiag('VAD created');
                } catch (vadErr) {
                    postDiag('VAD failed (continuing): ' + vadErr.message);
                }
                self.postMessage({ type: 'ready' });
            } catch (initErr) {
                postDiag('Engine init failed: ' + (initErr.message || initErr));
                self.postMessage({ type: 'error', message: 'Engine init failed: ' + initErr.message });
            }
        };

        importScripts(
            '/whisper/sherpa-onnx-vad.js',
            '/whisper/sherpa-onnx-asr.js',
            '/whisper/sherpa-onnx-wasm-main-vad-asr.js'
        );

    } catch (error) {
        postDiag('Fatal Boot Error: ' + (error.message || error));
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