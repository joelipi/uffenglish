// modules/courses/friend-courses-logic.js
// Pure domain logic for the public course-listings page (`/courses`). A friend
// course is any config with at least one `recapOverlay: "shareCta"` lesson (the
// ping-pong chain lessons). The `test.json` fixture also contains shareCta
// lessons but is reserved for testing, so it is excluded by id. No DOM, no
// store, no data access — fully unit-testable.
//
// Optional course metadata (all rendered on the course cards of `/courses`
// and `/home`, nothing renders when absent):
// - `courseMission`: a top-level `{ key: translation }` map (mission,
//   setting, roles, and any future course-metadata keys) for the course
//   mission dropdown. When absent, the dropdown falls back to the first
//   shareCta lesson's `mission`/`setting`/`roleUser`/`roleOther`.
// - `courseHeroImage`: a top-level image URL string for the card banner.

// Config ids whose shareCta lessons must never surface to users. `test.json`
// and `wouldyourather-test.json` are the designated never-user-visible fixtures.
export const EXCLUDED_FRIEND_COURSE_IDS = ['test', 'wouldyourather-test'];

// The public course-listings route. Single source for the path so the profile's
// expired-state link and the route table cannot drift.
export const COURSE_LISTINGS_PATH = '/courses';

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

// Lesson keys used for the mission fallback, in dropdown row order. Kept in
// sync with the live lesson MissionSection rows.
export const COURSE_MISSION_FALLBACK_KEYS = ['mission', 'setting', 'roleUser', 'roleOther'];

// The course mission dropdown content: a `{ key: translation }` map, or null
// when the course has nothing to show. Prefers the top-level `courseMission`
// metadata block; otherwise falls back to the first shareCta lesson's
// mission/setting/roles. Future course-metadata keys pass through untouched.
export function courseMissionFor(config) {
    const top = config && typeof config === 'object' ? config.courseMission : undefined;
    if (top && typeof top === 'object' && !Array.isArray(top)) {
        const entries = Object.entries(top).filter(([, value]) => !!value);
        return entries.length > 0 ? Object.fromEntries(entries) : null;
    }
    if (!config || !Array.isArray(config.lessons)) return null;
    const lesson = config.lessons.find(isFriendLesson);
    if (!lesson) return null;
    const entries = COURSE_MISSION_FALLBACK_KEYS
        .filter((key) => !!lesson[key])
        .map((key) => [key, lesson[key]]);
    return entries.length > 0 ? Object.fromEntries(entries) : null;
}

// The course hero image URL, or null when the config carries none. Blank and
// non-string values render no banner.
export function courseHeroImageFor(config) {
    const url = config && typeof config === 'object' ? config.courseHeroImage : undefined;
    return typeof url === 'string' && url.trim() !== '' ? url : null;
}

// The topics of one course config, as authored (trimmed, blanks dropped). The
// topic is course-level metadata, so the course lists can filter by it.
export function configTags(config) {
    const tags = config && typeof config === 'object' ? config.tags : null;
    if (!Array.isArray(tags)) return [];
    return tags
        .filter((tag) => typeof tag === 'string' && tag.trim() !== '')
        .map((tag) => tag.trim());
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
 * @returns {Array<{ courseId: string, courseName: string, lessonCount: number, firstLessonId: string, mission: object|null, heroImage: string|null, tags: string[] }>}
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
            mission: courseMissionFor(e.config),
            heroImage: courseHeroImageFor(e.config),
            tags: configTags(e.config),
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
