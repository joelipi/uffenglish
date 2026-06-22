// modules/speech.js - Web entry point, wires factories and re-exports
import * as mediaAdapter from './speech.web.js';
import { createWhisperAdapter } from '../../workers/whisper/app-vad-asr-web.js';
import { updateSpeechRecording } from '../storage/storage.js';
import { createSpeechOrchestrator } from './speech-orchestrator.js';
import { getIsPWAMode } from '../user/demo-mode-webonly.js';

const isPWAMode = getIsPWAMode();
console.warn(`[speech] PWA mode ${isPWAMode ? 'ACTIVE (Sherpa-ONNX full Whisper + VAD)' : 'OFF (Transformers.js tiny.en — default)'}`);

// Module worker so onnxruntime-web's internal dynamic import() works.
// Safari blocks dynamic imports inside blob: classic workers.
const whisperWorker = isPWAMode
    ? new Worker(new URL('../../workers/whisper/whisper-worker-web.js', import.meta.url))
    : new Worker(
        new URL('../../workers/whisper/whisper-worker-demo.js', import.meta.url),
        { type: 'module' },
    );

whisperWorker.onerror = (err) => {
    console.error(`[speech] Worker failed to load (${isPWAMode ? 'pwa' : 'default'}):`, err);
};

const whisperAdapter = createWhisperAdapter({ worker: whisperWorker });

const { listeningState, initLocalVoiceAI, toggleSpeechRecognition } =
    createSpeechOrchestrator({
        ...mediaAdapter,
        ...whisperAdapter,
        updateSpeechRecording,
        getSpeechCamStream: () => mediaAdapter.speechCamStream,
    });

whisperAdapter.preloadWhisperEngine();

export { listeningState, initLocalVoiceAI, toggleSpeechRecognition };
export * from './speech.web.js';
