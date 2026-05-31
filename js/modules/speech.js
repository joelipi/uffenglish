// modules/speech.js - Web entry point, wires factories and re-exports
import * as mediaAdapter from './speech.web.js';
import { createWhisperAdapter } from '../workers/whisper/app-vad-asr-web.js';
import { updateSpeechRecording } from './storage.js';
import { createSpeechOrchestrator } from './speech-orchestrator.js';
import { getIsDemoMode } from './demo-mode-webonly.js';

const isDemoMode = getIsDemoMode();

const whisperAdapter = createWhisperAdapter({
    workerUrl: isDemoMode
        ? new URL('../workers/whisper/whisper-worker-demo.js', import.meta.url)
        : new URL('../workers/whisper/whisper-worker-web.js', import.meta.url),
    workerOptions: isDemoMode
        ? { type: 'module' }
        : undefined,
});

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
