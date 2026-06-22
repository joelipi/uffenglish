// --- components/step-loader.web.js ---
// Thin wrapper — all logic moved to js/modules/step-loader-execute.js.
// This exists so non-React callers (app-infra.js) can import loadStep as before.

import { createLoadStep } from '../modules/lesson/step-executor-webonly.js';
import { warmUpSpeechCamStream, toggleSpeechRecognition, listeningState } from '../modules/speech/speech.js';
import { clearChat, addAIFeedbackMessages } from './chat/chat-interface.js';
import { Media } from '../modules/media/media.js';

export function loadStep(step, lesson, fluencyData, deps) {
    const execute = createLoadStep({
        ...deps,
        warmUpSpeechCam: warmUpSpeechCamStream,
        toggleSpeechRecognition,
        listeningState,
        clearChat,
        addAIFeedbackMessages,
        enableAudioSystem: () => Media.enableAudioSystem(),
    });
    return execute(step, lesson, fluencyData);
}
