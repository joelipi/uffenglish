// src/modules/courses/course-tags-logic.js
// Pure domain logic for the topic pages: the welcome page (one big button per
// tag) and a tag page (the courses that carry that tag). No DOM, no React, no
// data access — fully unit-testable (AGENTS.md: logic lives in modules,
// components render).
//
// A tag is a course-level string in the course config
// (`src/config/<course>.json` -> `"tags": ["travel", "family"]`). The tag is
// course-level metadata, so the tag pages read it straight off the config; no
// separate tag registry exists, and adding a tag to a config is all it takes
// for the tag to appear.
//
// The reserved fixtures (`test`, `wouldyourather-test`) are never shown to
// users, so they are excluded here too — the same list the course listings
// page uses, so the two surfaces can never disagree about what exists.

import {
    EXCLUDED_FRIEND_COURSE_IDS,
    configTags,
    courseHeroImageFor,
    courseMissionFor,
    courseNameFor,
    courseNameTranslations,
    firstFriendLessonId,
} from './friend-courses-logic.js';

// The topic helpers live with the other course-metadata helpers
// (`friend-courses-logic.js`); re-exported here so the topic module stays the
// single import site for everything topic-related.
export { configTags };

// The welcome page: where "start without a friend's code" lands.
export const WELCOME_PATH = '/welcome';
// The tag pages live under this prefix: /tags/<tag>.
export const TAG_PATH_PREFIX = '/tags';

/**
 * The comparable form of a tag: trimmed and lowercased.
 *
 * Tags are matched case-insensitively (a config may write "Travel" and the
 * URL may carry "travel"), so every comparison goes through this. A non-string
 * or blank tag normalizes to the empty string, which never matches.
 *
 * @param {unknown} raw - the raw tag value
 * @returns {string} the normalized tag ('' when there is none)
 */
export function normalizeTag(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().toLowerCase();
}

/**
 * The in-app URL of a tag page.
 * @param {unknown} tag - the tag (any casing)
 * @returns {string} the path, or the bare prefix when there is no tag
 */
export function buildTagHref(tag) {
    const normalized = normalizeTag(tag);
    if (!normalized) return TAG_PATH_PREFIX;
    return `${TAG_PATH_PREFIX}/${encodeURIComponent(normalized)}`;
}

/**
 * The lesson a course starts at: the first friend (shareCta) lesson when the
 * course has one — that is the lesson startable without a friend's code —
 * otherwise the course's first lesson.
 *
 * @param {object} config - a course config
 * @returns {string|null} the lesson id, or null when the course has none
 */
export function startLessonIdFor(config) {
    const friendLessonId = firstFriendLessonId(config);
    if (friendLessonId) return friendLessonId;
    if (!config || !Array.isArray(config.lessons)) return null;
    const first = config.lessons[0];
    return first && typeof first.lessonId === 'string' && first.lessonId ? first.lessonId : null;
}

/**
 * Every course that can be listed on a tag page, shaped for the view.
 *
 * Unlike the friend-course listing this includes courses that have no friend
 * lesson (a plain course is still a course a learner can start), so a tag
 * page can show the whole topic. The reserved fixtures stay out.
 *
 * @param {Array<{ courseId: string, config: object }>} entries - config basename + parsed config
 * @returns {Array<{ courseId: string, courseName: string, lessonCount: number, firstLessonId: string, mission: object|null, heroImage: string|null, tags: string[] }>}
 *          sorted by courseId ascending.
 */
export function listTaggedCourses(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
        .filter((e) => e && typeof e.courseId === 'string' && e.courseId !== '')
        .filter((e) => !EXCLUDED_FRIEND_COURSE_IDS.includes(e.courseId))
        .filter((e) => e.config && Array.isArray(e.config.lessons) && e.config.lessons.length > 0)
        .map((e) => ({
            courseId: e.courseId,
            // The English name (the string every non-display consumer uses) and
            // the locale map, so a card can show the learner's language too.
            courseName: courseNameFor(e.config, 'en', e.courseId),
            courseNames: courseNameTranslations(e.config),
            lessonCount: e.config.lessons.length,
            firstLessonId: startLessonIdFor(e.config),
            mission: courseMissionFor(e.config),
            heroImage: courseHeroImageFor(e.config),
            tags: configTags(e.config),
        }))
        .filter((c) => !!c.firstLessonId)
        .sort((a, b) => (a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : 0));
}

/**
 * Every tag the courses carry, with the courses that carry it.
 *
 * The tag label is the spelling the config authored (the first one wins), so
 * the button reads the way the course author wrote it; the matching key is
 * the normalized form, so "Travel" and "travel" are one tag.
 *
 * @param {Array<{ courseId: string, config: object }>} entries - config basename + parsed config
 * @returns {Array<{ tag: string, key: string, courseIds: string[] }>} sorted by tag label
 */
export function collectCourseTags(entries) {
    return topicOptionsForCourses(listTaggedCourses(entries));
}

/**
 * The topics a list of shaped courses carries, as filter options.
 *
 * @param {Array<{ courseId: string, tags: string[] }>} courses - shaped courses
 * @returns {Array<{ tag: string, key: string, courseIds: string[] }>} sorted by tag label
 */
export function courseTopicOptions(courses) {
    return topicOptionsForCourses(courses);
}

/**
 * The courses of a list that carry a topic. A blank topic means "all of them".
 *
 * @param {Array<{ courseId: string, tags: string[] }>} courses - shaped courses
 * @param {unknown} tag - the topic (any casing)
 * @returns {Array<object>} the courses that carry it
 */
export function filterCoursesByTag(courses, tag) {
    const list = Array.isArray(courses) ? courses : [];
    const key = normalizeTag(tag);
    if (!key) return list;
    return list.filter((course) => (course.tags || []).some((t) => normalizeTag(t) === key));
}

// The shared topic collector: the first authored spelling of a topic wins, the
// matching key is its normalized form, and the options are sorted by label.
function topicOptionsForCourses(courses) {
    const byKey = new Map();
    for (const course of Array.isArray(courses) ? courses : []) {
        for (const tag of course.tags || []) {
            const key = normalizeTag(tag);
            if (!key) continue;
            if (!byKey.has(key)) byKey.set(key, { tag, key, courseIds: [] });
            byKey.get(key).courseIds.push(course.courseId);
        }
    }
    return [...byKey.values()]
        .sort((a, b) => (a.tag.toLowerCase() < b.tag.toLowerCase() ? -1 : a.tag.toLowerCase() > b.tag.toLowerCase() ? 1 : 0));
}

/**
 * The label a course authored for a tag, so the page can show the tag the way
 * it was written ("Travel" stays "Travel" even though the URL is lowercase).
 *
 * @param {Array<{ courseId: string, config: object }>} entries - config basename + parsed config
 * @param {unknown} tag - the tag (any casing)
 * @returns {string|null} the authored label, or null when no course carries it
 */
export function findTagLabel(entries, tag) {
    const key = normalizeTag(tag);
    if (!key) return null;
    const found = collectCourseTags(entries).find((t) => t.key === key);
    return found ? found.tag : null;
}

/**
 * The courses that carry a tag.
 * @param {Array<{ courseId: string, config: object }>} entries - config basename + parsed config
 * @param {unknown} tag - the tag (any casing)
 * @returns {Array<object>} the courses, in courseId order
 */
export function listCoursesByTag(entries, tag) {
    const key = normalizeTag(tag);
    if (!key) return [];
    return listTaggedCourses(entries).filter((c) => c.tags.some((t) => normalizeTag(t) === key));
}

/**
 * Render-ready state for a tag page, so the component only branches on a
 * returned state string. `state` is one of 'loading' | 'error' | 'empty' |
 * 'ready'; `courses` is always an array.
 *
 * @param {{ tag?: string, courses?: Array<object>, isLoading?: boolean, isError?: boolean }} params
 * @returns {{ state: string, courses: Array<object> }}
 */
export function buildTagPageView({ tag = '', courses, isLoading = false, isError = false } = {}) {
    if (isLoading) return { state: 'loading', courses: [] };
    if (isError) return { state: 'error', courses: [] };
    const list = Array.isArray(courses) ? courses : [];
    if (!normalizeTag(tag) || list.length === 0) return { state: 'empty', courses: [] };
    return { state: 'ready', courses: list };
}
