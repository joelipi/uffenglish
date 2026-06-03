// modules/speech.core.js

export const MIN_LOGPROB_THRESHOLD = -1.0;

export function isGibberish(logprob) {
    return logprob < MIN_LOGPROB_THRESHOLD;
}

export function cleanTranscript(text) {
    if (!text) return "";
    // FIX: Removed "I" from the strip list — it's a valid standalone pronoun
    // and silently mangled answers like "Me and I" → "Me and".
    // Also anchored more carefully: only strip if the word is truly trailing
    // whitespace with nothing after it (the original regex already did this,
    // but the intent is now explicit).
    return text.replace(/\s+(a|an|the|and|or)$/i, '');
}

export function trimSilenceWithPadding(data, {
    threshold = 0.02,
    preRoll = 0.2,
    postRoll = 0.2,
    sampleRate = 16000,
    initialIgnoreMs = 0
} = {}) {
    // --- Find first sustained speech ---
    const minSpeechFrames = Math.floor(0.01 * sampleRate);
    let start = data.length; // default: no speech found
    const ignoreFrames = Math.floor((initialIgnoreMs / 1000) * sampleRate);
    let tempStart = ignoreFrames;

    while (tempStart < data.length) {
        if (Math.abs(data[tempStart]) >= threshold) {
            let sustained = 0;
            for (let j = 0; j < minSpeechFrames && (tempStart + j) < data.length; j++) {
                if (Math.abs(data[tempStart + j]) >= threshold * 0.5) sustained++;
            }
            if (sustained > minSpeechFrames * 0.5) {
                start = tempStart;
                break;
            }
        }
        // FIX: Always advance by 1, not by minSpeechFrames on failure.
        // The old jump skipped frames and could miss the real speech onset.
        tempStart++;
    }

    // Calculate hesitation in ms BEFORE padding
    const hesitation = Math.round((start / sampleRate) * 1000);

    // --- Find last speech ---
    let end = data.length - 1;
    while (end > start && Math.abs(data[end]) < threshold) {
        end--;
    }

    if (start >= end) {
        console.warn('[Trim] No speech detected');
        return { trimmed: data, pauseCount: 0, hesitation, netDuration: data.length / sampleRate };
    }

    // --- Count pauses (strictly 1-second minimum) ---
    // FIX: The original loop was correct in structure, but because `start`
    // could be wrong (see above), the pause window was also wrong. With the
    // corrected `start`, this now counts pauses over the true speech region.
    let pauseCount = 0;
    let inPause = false;
    let pauseStartFrame = 0;
    const pauseThresholdFrames = Math.floor(1.0 * sampleRate); // 1 full second

    for (let i = start; i <= end; i++) {
        if (Math.abs(data[i]) < threshold) {
            if (!inPause) {
                inPause = true;
                pauseStartFrame = i;
            }
        } else {
            if (inPause) {
                const pauseLength = i - pauseStartFrame;
                if (pauseLength >= pauseThresholdFrames) {
                    pauseCount++;
                    console.log(`[Trim] Pause detected (Duration: ${(pauseLength / sampleRate).toFixed(2)}s)`);
                }
                inPause = false;
            }
        }
    }

    // NOTE: A pause that runs to `end` without closing is intentionally
    // not counted — the user may have simply forgotten to stop the mic,
    // so trailing silence is excluded from pause scoring.

    const finalStart = Math.max(0, start - Math.floor(preRoll * sampleRate));
    const finalEnd = Math.min(data.length - 1, end + Math.floor(postRoll * sampleRate));

    const trimmed = data.slice(finalStart, finalEnd + 1);
    const netDuration = (end - start) / sampleRate;

    return { trimmed, pauseCount, hesitation, netDuration };
}
