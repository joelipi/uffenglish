// Pure "lessons completed" counter rules. No React, no DOM, no store, no data
// access — so the increment/idempotency rule is unit-testable in isolation and
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
 * Idempotent: a lesson whose key is already in `countedLessons` is not counted
 * again, so re-reaching the same success screen (a reload, a retry, or the two
 * persistence hooks) never double-counts.
 *
 * `countedLessons` (the `counted_lessons` column) predates this rule, so
 * accounts that completed lessons before it was written are missing entries;
 * re-completing one of those lessons counts it once more. Known and accepted.
 *
 * Note the reverse direction too: legacy rows keyed `counted_lessons` on the
 * NEXT-lesson target (the old code keyed on the `lessonId` param, which callers
 * always set to the next lesson), so a legacy residue key can suppress the
 * first post-fix completion of that target lesson (`changed: false` until a
 * different lesson completes). Each residue key was written alongside a legacy
 * +1, so this roughly nets out the old inflation rather than compounding it.
 *
 * @param {object} args
 * @param {string} args.courseId
 * @param {string} args.lessonId        - the lesson that was just completed
 * @param {number} [args.lessonsCompleted] - current count (defaults to 0)
 * @param {string[]} [args.countedLessons] - keys already counted (defaults to [])
 * @returns {{ lessonsCompleted: number, countedLessons: string[], key: string|null, changed: boolean }}
 */
export function nextLessonCompletion({ courseId, lessonId, lessonsCompleted = 0, countedLessons = [] } = {}) {
    const current = Number(lessonsCompleted) || 0;
    const counted = Array.isArray(countedLessons) ? [...new Set(countedLessons)] : [];
    const key = lessonCompletionKey(courseId, lessonId);

    if (!key || counted.includes(key)) {
        return { lessonsCompleted: current, countedLessons: counted, key, changed: false };
    }

    counted.push(key);
    return { lessonsCompleted: current + 1, countedLessons: counted, key, changed: true };
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
