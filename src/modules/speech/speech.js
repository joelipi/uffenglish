// modules/speech.js - Web entry point, wires factories and re-exports
import * as mediaAdapter from './speech.web.js';
import { createWhisperAdapter } from '../../workers/whisper/app-vad-asr-web.js';
import { updateSpeechRecording } from '../storage/storage.js';
import { createSpeechOrchestrator } from './speech-orchestrator.js';
import { getIsDemoMode } from '../user/demo-mode-webonly.js';

// Use Vite's ?worker suffix so the bundler inlines all dependencies
// (including @huggingface/transformers) into a self-contained worker chunk.
// This works in both dev and production, unlike `new Worker(new URL(...),
// { type: 'module' })` which leaves bare specifiers unresolved in dev mode.
import DemoWorker from '../../workers/whisper/whisper-worker-demo.js?worker';

const isDemoMode = getIsDemoMode();
console.warn(`[speech] demo mode ${isDemoMode ? 'ACTIVE (Transformers.js tiny.en)' : 'OFF (Sherpa-ONNX)'}`);

const whisperWorker = isDemoMode
    ? new DemoWorker()
    : new Worker(new URL('../../workers/whisper/whisper-worker-web.js', import.meta.url));

whisperWorker.onerror = (err) => {
    console.error(`[speech] Worker failed to load (${isDemoMode ? 'demo' : 'prod'}):`, err);
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
