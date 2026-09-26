// modules/user/friend-lesson-detection.js
// Synchronous detection of a friend-challenge lesson from the route alone.
// A friend lesson is opened either via a friend share link (?shareCode=) or is
// one of the friend-challenge lesson ids ('a' ask / 'b' answer), in any course.
// No DOM, no browser globals beyond URLSearchParams/decodeURIComponent — fully
// unit-testable and safe to call during render (nothing can flash).

import { ASK_LESSON_ID, ANSWER_LESSON_ID } from './friend-lesson-link-logic.js';

// Single source of truth for the friend-challenge lesson ids; do not re-literal
// them here. Course ids are open-ended, so they are deliberately not part of the
// predicate.
export const FRIEND_LESSON_IDS = [ASK_LESSON_ID, ANSWER_LESSON_ID];

// Case-insensitive ?shareCode= in a URL search string (with or without '?').
// Returns the trimmed, lowercased code, or null.
export function getShareCodeFromSearch(search) {
    if (typeof search !== 'string' || search === '') return null;
    const params = new URLSearchParams(search[0] === '?' ? search.slice(1) : search);
    for (const [key, value] of params) {
        if (key.toLowerCase() === 'sharecode') {
            const code = value.trim().toLowerCase();
            return code || null;
        }
    }
    return null;
}

// Lesson id from '/course/:courseId/lesson/:lessonId'; null for any other path.
export function getLessonIdFromPathname(pathname) {
    if (typeof pathname !== 'string' || pathname === '') return null;
    const match = /^\/course\/[^/]+\/lesson\/([^/]+)\/?$/.exec(pathname);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        // Malformed percent-encoding (e.g. a bare '%') — fall back to the raw segment.
        return match[1];
    }
}

// A friend lesson is opened via a friend share link (?shareCode=) or is a
// friend-challenge lesson id ('a'/'b'), in any course.
export function isFriendLesson({ search, pathname } = {}) {
    if (getShareCodeFromSearch(search)) return true;
    const lessonId = getLessonIdFromPathname(pathname);
    return lessonId !== null && FRIEND_LESSON_IDS.includes(lessonId);
}
