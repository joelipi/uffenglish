// whisper-worker-demo.js
// Lightweight Transformers.js Whisper worker for demo/mobile path.
// Replaces the Sherpa-ONNX bundle (~104MB) with ~41MB of ONNX files.
// Drop this alongside whisper-worker-web.js — no changes needed in speech.js.

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

// Point WASM files at your existing assets path if you have them locally,
// otherwise Transformers.js fetches them from its CDN automatically.
// env.backends.onnx.wasm.wasmPaths = '/assets/wasm/';

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
    }
};
