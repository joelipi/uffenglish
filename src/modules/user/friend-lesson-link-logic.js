// modules/user/friend-lesson-link-logic.js
// Pure domain logic for the friend-challenge answer-lesson link shown on the
// public profile. A friend challenge is a ping-pong chain of `recapOverlay:
// "shareCta"` lessons in `configData.lessons` order; finishing a lesson records
// a link that points at the next shareCta lesson. There is no fixed a/b pair.
// No DOM, no browser globals, no data access — fully unit-testable.

import { SHARE_URL_BASE, SHARE_WINDOW_HOURS } from '../video/video-processor-logic.js';

// Reuses the single share window (R2 UGC lifecycle, 48h). Do not add a second.
export const FRIEND_LINK_WINDOW_MS = SHARE_WINDOW_HOURS * 60 * 60 * 1000;

// Index of `lessonId` in `configData.lessons`, or -1. Shared by the chain
// predicates so the rule (a chain lesson is a shareCta lesson) lives in one place.
function chainIndex(configData, lessonId) {
    const lessons = configData?.lessons;
    if (!Array.isArray(lessons)) return -1;
    const index = lessons.findIndex((l) => l?.lessonId === lessonId);
    if (index === -1 || lessons[index]?.recapOverlay !== 'shareCta') return -1;
    return index;
}

// The next lesson after `lessonId` in a friend course: the first later entry in
// configData.lessons whose recapOverlay is 'shareCta'. null when lessonId is not
// a shareCta lesson or no shareCta lesson follows it.
export function nextFriendLessonId(configData, lessonId) {
    const lessons = configData?.lessons;
    const index = chainIndex(configData, lessonId);
    if (index === -1) return null;
    for (let i = index + 1; i < lessons.length; i++) {
        if (lessons[i]?.recapOverlay === 'shareCta') return lessons[i].lessonId;
    }
    return null;
}

// True when `lessonId` is itself a shareCta chain lesson and a shareCta lesson
// appears before it in config order. The answer ("response") side of a chain is
// any chain lesson except the first; a non-chain lesson is never the answer side.
export function hasEarlierShareCtaLesson(configData, lessonId) {
    const lessons = configData?.lessons;
    const index = chainIndex(configData, lessonId);
    if (index === -1) return false;
    for (let i = 0; i < index; i++) {
        if (lessons[i]?.recapOverlay === 'shareCta') return true;
    }
    return false;
}

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

// Immutable merge for the `friend_links` jsonb column. One entry per
// course+lesson (a player can be mid-chain with several people at once), so the
// map key is `courseId:lessonId`; entries without a lessonId fall back to the
// course key so a concurrent write cannot clobber a legacy row (listActiveFriendLinks
// still filters legacy entries off the profile).
export function upsertFriendLinkMap(existing, entry) {
    const map = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {};
    const key = entry.lessonId ? `${entry.courseId}:${entry.lessonId}` : entry.courseId;
    return { ...map, [key]: entry };
}

// Entries still inside the 48h window, newest first. Entries without a
// lessonId (legacy) or shareCode (unusable) are dropped.
export function listActiveFriendLinks(friendLinks, nowMs) {
    if (!friendLinks || typeof friendLinks !== 'object' || Array.isArray(friendLinks)) return [];
    return Object.values(friendLinks)
        .filter((e) => e && typeof e.lessonId === 'string' && e.lessonId !== ''
            && typeof e.shareCode === 'string' && e.shareCode !== ''
            && e.addedAt && isFriendLinkActive(new Date(e.addedAt).getTime(), nowMs))
        .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

/**
 * Gate + payload for recording a link at export time. Pure; no store/Supabase.
 * - a link is created when the exported lesson is a shareCta lesson with a
 *   later shareCta lesson after it (the next ping-pong turn)
 * - a real export (succeeded > 0) and a shareCode are required
 * - the returned lessonTitle is captured at export time (a string), so the
 *   profile can label the link in the exporter's language
 */
export function resolveFriendLessonLink({ configData, lessonId, courseId, shareCode, succeeded } = {}) {
    if (!succeeded || !shareCode || !courseId) return null;
    const nextId = nextFriendLessonId(configData, lessonId);
    if (!nextId) return null;
    const next = configData.lessons.find((l) => l.lessonId === nextId);
    const lessonTitle = typeof next?.title === 'string' ? next.title : '';
    return { courseId, lessonId: nextId, shareCode, lessonTitle };
}
