// modules/speech.native.js
// React Native stub — no implementation, just matching exports so Metro doesn't crash.

import { createSpeechOrchestrator } from './speech-orchestrator.js';

const stubAdapter = {
    startSpeechCamRecording: async () => console.warn('[speech.native] startSpeechCamRecording not implemented'),
    stopSpeechCamRecording: async () => console.warn('[speech.native] stopSpeechCamRecording not implemented'),
    getSpeechCamStream: () => null,
    safelyStopStream: () => {},
    startLocalAudioTap: async () => console.warn('[speech.native] startLocalAudioTap not implemented'),
    stopLocalAudioTap: async () => console.warn('[speech.native] stopLocalAudioTap not implemented'),
    transcribeAudioBuffer: async () => ({ text: '', confidence: 0 }),
    preloadWhisperEngine: async () => console.warn('[speech.native] preloadWhisperEngine not implemented'),
    updateSpeechRecording: async () => null,
};

const { listeningState, initLocalVoiceAI, toggleSpeechRecognition } =
    createSpeechOrchestrator({
        ...stubAdapter,
        getSpeechCamStream: () => null,
    });

export { listeningState, initLocalVoiceAI, toggleSpeechRecognition };
