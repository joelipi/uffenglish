import { pipeline, env } from '@huggingface/transformers';

const SILENT_LOGS = true; 
if (SILENT_LOGS) {
    console.log = () => {};
    console.time = () => {};
    console.timeEnd = () => {};
}

env.allowLocalModels = false;
env.useBrowserCache = true;

// 1. Calculate safe thread count (same logic you had before)
const deviceMemory = navigator.deviceMemory || 4;
const safeThreadCount = deviceMemory < 4 ? 2 : Math.min(navigator.hardwareConcurrency || 4, 8);

// 2. Explicitly tell the ONNX WASM backend how many threads to use
env.backends.onnx.wasm.numThreads = safeThreadCount;

// 3. Log it!
console.log(`[whisper-demo] 🛠️ Hardware Info: Memory=${deviceMemory}GB, Cores=${navigator.hardwareConcurrency}`);
console.log(`[whisper-demo] ⚙️ Transformers.js configured for ${env.backends.onnx.wasm.numThreads} threads.`);
console.log(`[whisper-demo] 🚦 SharedArrayBuffer active: ${typeof SharedArrayBuffer !== 'undefined'}`);

let transcriber = null;

async function bootWhisperEngine() {
    try {
        transcriber = await pipeline(
            'automatic-speech-recognition',
            'onnx-community/whisper-tiny.en',
            {
                device: 'wasm',
                dtype: {
                    encoder_model: 'q8',        // encoder_model_quantized.onnx  ~10MB
                    decoder_model_merged: 'q8', // decoder_model_merged_int8.onnx ~31MB
                },
            }
        );

        console.log('[whisper] 🚀 Demo engine ready (Transformers.js / VAD-free)');
        self.postMessage({ type: 'ready' });

    } catch (error) {
        console.error('[whisper-demo] Fatal boot error:', error);
        self.postMessage({ type: 'error', message: error.message });
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
