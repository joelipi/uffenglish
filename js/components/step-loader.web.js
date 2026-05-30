// --- components/step-loader.web.js ---
// Thin wrapper — all logic moved to js/modules/step-loader-execute.js.
// This exists so non-React callers (app-infra.js) can import loadStep as before.

import { createLoadStep } from '../modules/step-loader-execute.js';
import { warmUpSpeechCamStream, toggleSpeechRecognition, listeningState } from '../modules/speech.js';
import { clearChat, addAIFeedbackMessages } from './chat/chat-interface.js';

export function loadStep(step, lesson, fluencyData, deps) {
    const execute = createLoadStep({
        ...deps,
        warmUpSpeechCam: warmUpSpeechCamStream,
        toggleSpeechRecognition,
        listeningState,
        clearChat,
        addAIFeedbackMessages,
    });
    return execute(step, lesson, fluencyData);
}
