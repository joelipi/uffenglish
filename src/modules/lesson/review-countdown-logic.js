// The transcript review's auto-accept countdown.
//
// After a take the learner sees their transcript over the recorded video and
// chooses ✓ (accept) or ✕ (record again). That screen used to run a 7-second
// countdown and then ACCEPT on its own when it reached zero, so a learner who
// was reading (or re-reading) their transcript lost the choice.
//
// The countdown is therefore **off by default**: `REVIEW_COUNTDOWN_ENABLED` is
// `false`, the screen shows no timer, and the learner takes as long as they want
// to accept or re-record. The ticker and the auto-accept stay in place behind
// this switch, so turning it back on is this one constant (plus nothing else) —
// see `speech-orchestrator.js`, which asks this module for the starting value,
// and `WhisperReview.jsx`, which asks it whether to render the timer.
//
// NO React, NO DOM, NO timers: the rule is pure so it is unit-testable and the
// orchestrator owns the interval.

/** How long the review screens counts down for, when the countdown is enabled. */
export const REVIEW_COUNTDOWN_SECONDS = 7;

/**
 * Whether the review screen auto-accepts when the countdown runs out.
 * Default OFF — a deliberate product decision, not an oversight.
 */
export const REVIEW_COUNTDOWN_ENABLED = false;

/**
 * Is the countdown on?
 *
 * @param {boolean} [enabled] override for tests / a future per-course setting
 * @returns {boolean}
 */
export function isReviewCountdownEnabled(enabled = REVIEW_COUNTDOWN_ENABLED) {
    return enabled === true;
}

/**
 * The value the review starts its timer at, or `null` when there is no
 * countdown. `null` is the signal the whole chain uses: the store leaves
 * `whisperReviewTimeLeft` empty and the overlay renders no timer.
 *
 * @param {{ enabled?: boolean }} [options]
 * @returns {number|null}
 */
export function resolveReviewCountdownStart({ enabled = REVIEW_COUNTDOWN_ENABLED } = {}) {
    return isReviewCountdownEnabled(enabled) ? REVIEW_COUNTDOWN_SECONDS : null;
}

/**
 * Should the review overlay render the "Time remaining" line and the bar? Only
 * when there is a countdown to show.
 *
 * @param {number|null|undefined} timeLeft
 * @returns {boolean}
 */
export function shouldShowReviewCountdown(timeLeft) {
    return typeof timeLeft === 'number' && Number.isFinite(timeLeft);
}

/**
 * How full the countdown bar is, as a percentage (0 at zero, 100 at the start).
 * Render-only arithmetic, kept here so the component stays markup.
 *
 * @param {number|null|undefined} timeLeft
 * @param {number} [total] the value the countdown started at
 * @returns {number}
 */
export function reviewCountdownProgress(timeLeft, total = REVIEW_COUNTDOWN_SECONDS) {
    if (!shouldShowReviewCountdown(timeLeft)) return 0;
    if (!Number.isFinite(total) || total <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, timeLeft / total));
    return ratio * 100;
}

/**
 * Should the review accept itself because the countdown ran out?
 *
 * @param {{ enabled?: boolean, timeLeft?: number|null }} [options]
 * @returns {boolean}
 */
export function shouldAutoAcceptReview({ enabled = REVIEW_COUNTDOWN_ENABLED, timeLeft = null } = {}) {
    if (!isReviewCountdownEnabled(enabled)) return false;
    return shouldShowReviewCountdown(timeLeft) && timeLeft <= 0;
}
