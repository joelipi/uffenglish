// modules/lesson/success-continue-logic.js
// Pure timing/visibility rules for the success-screen Continue button
// (story 061, Task 4). No React, no DOM, no store, no data access — fully
// unit-testable.
//
// Rule: on friend (`recapOverlay: "shareCta"`) success rows the screen is
// Share-only at video-ready. The existing Continue button appears next to
// Share only after the learner taps Share (sheet displayed on mobile,
// download started elsewhere) plus a fixed delay — whatever the delivery
// outcome (fail-open: an aborted share must never strand the learner with
// no onward path). Non-friend rows keep today's immediate reveal.

import { resolveRecapOverlay } from '../video/video-processor-logic.js';

// Delay between the settled Share tap and the Continue reveal on friend
// success rows. Single source; the component must reference this constant,
// never its own numeric literal.
export const SUCCESS_CONTINUE_REVEAL_DELAY_MS = 3000;

// Single-source success-lesson lookup by id. The ready-path gate, the
// tap-time scheduler, and the row gate all resolve the lesson through
// here so the three can never disagree on identity.
export function findLessonById(configData, lessonId) {
    const lessons = configData?.lessons;
    if (!Array.isArray(lessons) || !lessonId) return null;
    return lessons.find((l) => l?.lessonId === lessonId) || null;
}

// True when the lesson's success row must withhold Continue until after
// the Share tap + delay. Unflagged, missing, or malformed lessons keep
// today's immediate reveal (`resolveRecapOverlay` defaults those to
// `'fluency'`).
export function isSuccessContinueDelayed(lesson) {
    return resolveRecapOverlay(lesson) === 'shareCta';
}

// Schedules `reveal()` after `delayMs`. Stale-guarded: the reveal runs
// only while the success screen still shows the scheduled lesson, so a
// timer that outlives its lesson (Repeat / onward navigation / the next
// success screen) can never reveal Continue in the wrong place. Returns a
// cancel function; the caller (component ref) owns the handle and cancels
// on unmount or supersede. Never throws on malformed inputs.
export function scheduleSuccessContinueReveal({
    lessonId = null,
    delayMs = SUCCESS_CONTINUE_REVEAL_DELAY_MS,
    reveal = null,
    getActiveLessonId = null,
} = {}) {
    if (typeof reveal !== 'function') return () => {};
    const wait = Number(delayMs);
    const ms = Number.isFinite(wait) && wait >= 0 ? wait : SUCCESS_CONTINUE_REVEAL_DELAY_MS;
    const timer = setTimeout(() => {
        try {
            if (typeof getActiveLessonId === 'function' && getActiveLessonId() !== lessonId) return;
        } catch {
            return;
        }
        try {
            reveal();
        } catch {
            // A throwing reveal (e.g. torn-down store) must never surface
            // as an uncaught timer exception; the schedule simply lapses.
        }
    }, ms);
    let cancelled = false;
    return () => {
        if (cancelled) return;
        cancelled = true;
        clearTimeout(timer);
    };
}
