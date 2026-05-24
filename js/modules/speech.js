// modules/speech.js - Web entry point, re-exports from shared and web adapter
export { listeningState, initLocalVoiceAI, toggleSpeechRecognition } from './speech.shared.js';
export * from './speech.web.js';
