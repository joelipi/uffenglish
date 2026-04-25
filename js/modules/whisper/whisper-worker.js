// whisper-worker.js v501pm
const WHISPER_BASE_PATH = 'https://r2.ultrafastfluency.com/whisper/';

let vad = null;
let recognizer = null;
let isReady = false;

// Emscripten requires Module to exist in the worker scope
self.Module = {
    locateFile: function(path) {
        return WHISPER_BASE_PATH + path;
    },
    setStatus: function(status) {
        //if (status) console.log("Whisper Worker:", status);
    },
    onRuntimeInitialized: function() {
        console.log('Whisper Worker: Memory Initialized');
        
        vad = createVad(self.Module);
        
        let config = {
            modelConfig: {
                debug: 1,
                tokens: './tokens.txt',
                whisper: {
                    encoder: './whisper-encoder.onnx',
                    decoder: './whisper-decoder.onnx',
                }
            },
        };
        recognizer = new OfflineRecognizer(config, self.Module);
        isReady = true;
        
        // Tell the main page we are done loading!
        self.postMessage({ type: 'ready' });
    }
};

// Import the Emscripten engine directly into the worker
importScripts(
    WHISPER_BASE_PATH + 'sherpa-onnx-vad.js',
    WHISPER_BASE_PATH + 'sherpa-onnx-asr.js',
    WHISPER_BASE_PATH + 'sherpa-onnx-wasm-main-vad-asr.js'
);

// Listen for audio data sent from the main UI
self.onmessage = function(e) {
    if (e.data.type === 'transcribe' && isReady) {
        try {
            const float32Array = e.data.audio;
            const stream = recognizer.createStream();
            stream.acceptWaveform(16000, float32Array);
            recognizer.decode(stream);
            
            // NEW: Extract the entire result object, not just the text
            const fullResult = recognizer.getResult(stream);
            stream.free();
            
            // Send all available metrics back to the main UI
            self.postMessage({ 
                type: 'result', 
                text: fullResult.text,
                avg_logprob: fullResult.avg_logprob,
                tokens: fullResult.tokens,
                timestamps: fullResult.timestamps
            });
        } catch (error) {
            console.error("Worker transcription error:", error);
            self.postMessage({ type: 'result', text: null });
        }
    }
};