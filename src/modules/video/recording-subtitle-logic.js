// Pure helpers for the friend-closed-response recording overlay.
// Determines whether a step should show its phrase as subtitles on the
// camera preview while recording, and extracts the (English-only) phrase.

import { getCueText } from '../utils/utils.js';

/**
 * Returns { phrase } for a friend-closed-response step, or null otherwise.
 * The phrase is always the English cue text, never localized.
 */
export function getRecordingPhraseOverlay(currentStep) {
    if (!currentStep || currentStep.responseType !== 'friendClosedResponse') {
        return null;
    }
    const phrase = getCueText(currentStep.cue);
    if (!phrase) return null;
    return { phrase };
}

export default { getRecordingPhraseOverlay };
