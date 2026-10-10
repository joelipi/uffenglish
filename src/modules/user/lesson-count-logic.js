// Pure "lessons completed" counter rules. No React, no DOM, no store, no data
// access — so the counting rule is unit-testable in isolation and
// the same rule can be reused by a native client.

/**
 * Stable key for one completed lesson. `courseId` is the config basename and
 * `lessonId` the course-local lesson id (e.g. `wouldyourather` + `a`).
 *
 * @returns {string|null} null when either part is missing, so callers can skip.
 */
export function lessonCompletionKey(courseId, lessonId) {
    if (!courseId || !lessonId) return null;
    return `${courseId}_${lessonId}`;
}

/**
 * Computes the next lessons-completed state for a completed lesson.
 *
 * Every genuine completion counts — including repeats. Re-doing a lesson with
 * friends IS doing the lesson again, so it earns credit again.
 * `countedLessons` stays the UNIQUE set of completed lessons (the unique
 * count is its length); the total count is `lessonsCompleted`.
 *
 * The ONLY thing this does not guard against is a phantom completion, and that
 * guard lives at the call site, not here: `handleSuccessStep` only passes
 * `incrementCount` when the success step was reached by traversing the lesson
 * in-app (`stepLoadedFromRestore === false`). Landing on the success step
 * directly (page load, reload, signup redirect) persists resume state but
 * never asks for a count — so a reload can never double-count.
 *
 * @param {object} args
 * @param {string} args.courseId
 * @param {string} args.lessonId        - the lesson that was just completed
 * @param {number} [args.lessonsCompleted] - current total (defaults to 0)
 * @param {string[]} [args.countedLessons] - unique keys already seen (defaults to [])
 * @returns {{ lessonsCompleted: number, countedLessons: string[], key: string|null, isFirstCompletion: boolean }}
 */
export function nextLessonCompletion({ courseId, lessonId, lessonsCompleted = 0, countedLessons = [] } = {}) {
    const current = Number(lessonsCompleted) || 0;
    const counted = Array.isArray(countedLessons) ? [...new Set(countedLessons)] : [];
    const key = lessonCompletionKey(courseId, lessonId);

    if (!key) {
        return { lessonsCompleted: current, countedLessons: counted, key, isFirstCompletion: false };
    }

    const isFirstCompletion = !counted.includes(key);
    if (isFirstCompletion) counted.push(key);
    return { lessonsCompleted: current + 1, countedLessons: counted, key, isFirstCompletion };
}

/**
 * Lesson-count columns to seed into a brand-new profile row.
 *
 * A guest's completion only ever reaches the Zustand store: `syncUserMetaData`
 * skips guests, and the bootstrap that runs after signup seeds the store from
 * the new row — so the lesson the guest just finished would be silently lost.
 * This credits exactly the lesson whose success screen is showing, so their new
 * account starts at one completed lesson.
 *
 * Deliberately credits only `lessonId` (not the guest's whole local set): the
 * persisted `countedLessons` can hold entries from a previous account on the
 * same browser, and a guest who finished more than one lesson is caught up by
 * the absolute write of their next completion. Callers from outside the success
 * screen pass no `lessonId` and get no extra columns, so the column defaults
 * (migration 001: `lessons_completed 0`) still apply.
 *
 * @param {object} args
 * @param {string} args.courseId - store courseId (the config basename)
 * @param {string} args.lessonId - store successLessonId
 * @returns {{ creditLesson: boolean, lessonsCompleted: number, countedLessons: string[], key: string|null }}
 */
export function guestSignupLessonCredit({ courseId, lessonId } = {}) {
    const key = lessonCompletionKey(courseId, lessonId);
    if (!key) {
        return { creditLesson: false, lessonsCompleted: 0, countedLessons: [], key: null };
    }
    return { creditLesson: true, lessonsCompleted: 1, countedLessons: [key], key };
}
