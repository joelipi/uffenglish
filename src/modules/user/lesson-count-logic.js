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
