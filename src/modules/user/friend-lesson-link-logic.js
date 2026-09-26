// modules/user/friend-lesson-link-logic.js
// Pure domain logic for the friend-challenge answer-lesson link shown on the
// public profile. The mapping is fixed and deterministic: ask lesson 'a' ->
// answer lesson 'b' in the same course. There is no config field and no lookup.
// No DOM, no browser globals, no data access — fully unit-testable.

import { SHARE_URL_BASE, SHARE_WINDOW_HOURS } from '../video/video-processor-logic.js';

export const ASK_LESSON_ID = 'a';
export const ANSWER_LESSON_ID = 'b';

// Reuses the single share window (R2 UGC lifecycle, 48h). Do not add a second.
export const FRIEND_LINK_WINDOW_MS = SHARE_WINDOW_HOURS * 60 * 60 * 1000;

// Bare host/path, matching buildShareUrl's scheme-less convention.
export function buildFriendLessonLink({ courseId, lessonId, shareCode, base = SHARE_URL_BASE }) {
    return `${base}/course/${courseId}/lesson/${lessonId}?shareCode=${shareCode}`;
}

// A clickable anchor needs a scheme; SHARE_URL_BASE is deliberately scheme-less.
export function toFriendLessonHref(url) {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function getFriendLinkRemainingMs(addedAtMs, nowMs) {
    return Math.max(0, addedAtMs + FRIEND_LINK_WINDOW_MS - nowMs);
}

export function isFriendLinkActive(addedAtMs, nowMs) {
    return getFriendLinkRemainingMs(addedAtMs, nowMs) > 0;
}

// null when expired (caller hides the link). Minute granularity, floor.
export function formatFriendLinkRemaining(remainingMs) {
    if (!(remainingMs > 0)) return null;
    const totalMinutes = Math.floor(remainingMs / 60000);
    if (totalMinutes >= 60) return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
    return `${totalMinutes}m`;
}

// Immutable merge for the `friend_links` jsonb column. One entry per course
// (the ask lesson is always 'a'), so the course id is the map key.
export function upsertFriendLinkMap(existing, entry) {
    const map = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {};
    return { ...map, [entry.courseId]: entry };
}

// Entries still inside the 48h window, newest first.
export function listActiveFriendLinks(friendLinks, nowMs) {
    if (!friendLinks || typeof friendLinks !== 'object' || Array.isArray(friendLinks)) return [];
    return Object.values(friendLinks)
        .filter((e) => e && e.addedAt && isFriendLinkActive(new Date(e.addedAt).getTime(), nowMs))
        .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

/**
 * Gate + payload for recording a link at export time. Pure; no store/Supabase.
 * - only lesson 'a' exports create a link
 * - the course config must actually contain lesson 'b' (never link to nothing)
 * - a real export (succeeded > 0) and a shareCode are required
 */
export function resolveFriendLessonLink({ configData, lessonId, courseId, shareCode, succeeded }) {
    if (!succeeded || !shareCode || !courseId || !configData?.lessons) return null;
    if (lessonId !== ASK_LESSON_ID) return null;
    if (!configData.lessons.some((l) => l.lessonId === ANSWER_LESSON_ID)) return null;
    return { courseId, shareCode };
}
