// Where the transcription review box starts (stories/094).
//
// The box must begin flush with the BOTTOM of the lesson's top overlay (the bar
// holding the close glyph, the progress bar, the activity stats and the mission
// line) — not at a guessed ratio of the frame, because that bar's height changes
// with the step (the mission block wraps to more lines for B2/C1 and in some
// languages). It also must not sit in the middle of the frame: the recorded
// take's play control lives there, and a refused autoplay leaves that control as
// the learner's only way in.
//
// The container measures the bar and passes its height in; this module only
// decides what to do with the number, so the rule is testable without a DOM.

/** Used until the bar has been measured (first paint) or if measuring fails. */
export const TRANSCRIPT_TOP_OFFSET_FALLBACK_PX = 96;

/**
 * The top offset for the review box, in pixels from the top of the frame.
 *
 * @param {number|undefined|null} measuredHeightPx the top overlay's height
 * @param {{ fallback?: number }} [options]
 * @returns {number}
 */
export function resolveTranscriptTopOffset(measuredHeightPx, { fallback = TRANSCRIPT_TOP_OFFSET_FALLBACK_PX } = {}) {
    const value = Number(measuredHeightPx);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.round(value);
}
