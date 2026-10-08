// modules/courses/friend-courses-logic.js
// Pure domain logic for the public course-listings page (`/courses`). A friend
// course is any config with at least one `recapOverlay: "shareCta"` lesson (the
// ping-pong chain lessons). The `test.json` fixture also contains shareCta
// lessons but is reserved for testing, so it is excluded by id. No DOM, no
// store, no data access — fully unit-testable.

// Config ids whose shareCta lessons must never surface to users. `test.json`
// is the designated never-user-visible fixture.
export const EXCLUDED_FRIEND_COURSE_IDS = ['test'];

// A lesson is a friend-challenge chain lesson when it is a "share CTA" lesson.
export function isFriendLesson(lesson) {
    return !!lesson && lesson.recapOverlay === 'shareCta';
}

// A course is a friend course when it has at least one shareCta lesson.
export function isFriendCourse(config) {
    return !!config && Array.isArray(config.lessons) && config.lessons.some(isFriendLesson);
}

// The first shareCta lesson in config order (the "ask"/A lesson). null when the
// config has no usable friend lesson. This is the only lesson that is startable
// without a `?shareCode=` (later chain lessons embed `{friendCode}` references).
export function firstFriendLessonId(config) {
    if (!config || !Array.isArray(config.lessons)) return null;
    const lesson = config.lessons.find(isFriendLesson);
    return lesson && typeof lesson.lessonId === 'string' && lesson.lessonId ? lesson.lessonId : null;
}

// The in-app URL that starts a course at its first friend lesson. `courseId` is
// the config FILE basename (AppLayout fetches `/src/config/<courseId>.json`),
// never `config.courseId` (friend.json/test.json carry a non-file id).
export function buildCourseStartHref(courseId, lessonId) {
    return `/course/${courseId}/lesson/${lessonId}`;
}

/**
 * Filter and shape friend courses for the listings page.
 * @param {Array<{ courseId: string, config: object }>} entries - config basename + parsed config
 * @returns {Array<{ courseId: string, courseName: string, lessonCount: number, firstLessonId: string }>}
 *          sorted by courseId ascending.
 */
export function listFriendCourses(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
        .filter((e) => e && typeof e.courseId === 'string' && e.courseId !== '')
        .filter((e) => !EXCLUDED_FRIEND_COURSE_IDS.includes(e.courseId))
        .filter((e) => isFriendCourse(e.config))
        .map((e) => ({
            courseId: e.courseId,
            courseName: (typeof e.config.courseName === 'string' && e.config.courseName)
                ? e.config.courseName
                : e.courseId,
            lessonCount: e.config.lessons.length,
            firstLessonId: firstFriendLessonId(e.config),
        }))
        .filter((c) => !!c.firstLessonId)
        .sort((a, b) => (a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : 0));
}

/**
 * Render-ready state for the listings page, so the component only branches on
 * a returned state string. `state` is one of 'loading' | 'error' | 'empty' |
 * 'ready'; `courses` is always an array.
 */
export function buildCourseListView({ courses, isLoading = false, isError = false } = {}) {
    if (isLoading) return { state: 'loading', courses: [] };
    if (isError) return { state: 'error', courses: [] };
    const list = Array.isArray(courses) ? courses : [];
    if (list.length === 0) return { state: 'empty', courses: [] };
    return { state: 'ready', courses: list };
}
