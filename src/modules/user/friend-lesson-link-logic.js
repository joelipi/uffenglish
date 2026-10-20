// modules/user/friend-lesson-link-logic.js
// Pure domain logic for the friend-challenge answer-lesson link shown on the
// public profile. A friend challenge is a ping-pong chain of `recapOverlay:
// "shareCta"` lessons in `configData.lessons` order; finishing a lesson records
// a link that points at the next shareCta lesson. The profile shows one link
// per lesson the owner recorded, labelled with the recorded lesson's title and
// grouped under its course. There is no fixed a/b pair.
// No DOM, no browser globals, no data access — fully unit-testable.

import { SHARE_URL_BASE, SHARE_WINDOW_HOURS } from '../video/video-processor-logic.js';
import { normalizeShareCode, NOTIFICATION_TYPE_FRIEND_RESPONSE } from '../notifications/notification-logic.js';
import { firstFriendLessonId } from '../courses/friend-courses-logic.js';

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

// The `friend_links` jsonb column holds one entry per recorded lesson (a
// player can be mid-chain with several people at once, and a profile shows one
// link per lesson they recorded), so the map key is
// `courseId:recordedLessonId`. The merge itself is SERVER-side now
// (`record_friend_link`, migration 008): a client-side read-modify-write could
// lose an entry SILENTLY, because a zero-row UPDATE is not an error in
// PostgREST — the profile then showed "all lessons expired" right after the
// learner recorded one.

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

// Render-ready view for the public-profile friend-practice area. `mode` is
// 'active' when at least one link is inside the 48h window, else 'expired'
// (which the component renders as the "all lessons expired" invitation).
// `isTicking` tells the component whether to run its per-second countdown
// clock. Keeps the gate out of the component.
export function buildFriendPracticeView(friendLinks, nowMs) {
    const groups = groupActiveFriendLinks(friendLinks, nowMs);
    const active = groups.length > 0;
    return { mode: active ? 'active' : 'expired', groups, isTicking: active };
}

// Ordered groups of entries by course. Groups are keyed by courseId (two
// courses may share a display name) and carry the first entry's courseName as
// the heading; entries within a group keep the input order. Empty → [].
function groupEntries(entries) {
    const groups = [];
    const byCourse = new Map();
    for (const entry of entries) {
        if (!byCourse.has(entry.courseId)) {
            const group = { courseId: entry.courseId, courseName: entry.courseName || entry.courseId, entries: [] };
            byCourse.set(entry.courseId, group);
            groups.push(group);
        }
        byCourse.get(entry.courseId).entries.push(entry);
    }
    return groups;
}

// Ordered groups of active entries by course, keeping listActiveFriendLinks
// order (newest first) within a group. Empty → [].
export function groupActiveFriendLinks(friendLinks, nowMs) {
    return groupEntries(listActiveFriendLinks(friendLinks, nowMs));
}

// Unique courseIds present in a friendLinks map, ascending. Used to fetch ONLY
// the configs the profile actually references (a public page must not pull in
// every course config). Malformed entries are ignored.
export function listFriendCourseIds(friendLinks) {
    if (!friendLinks || typeof friendLinks !== 'object' || Array.isArray(friendLinks)) return [];
    const seen = new Set();
    for (const entry of Object.values(friendLinks)) {
        const courseId = entry?.courseId;
        if (typeof courseId === 'string' && courseId) seen.add(courseId);
    }
    return [...seen].sort();
}

// `{ courseId, config }` entries → Map<courseId, firstLessonId>. A course whose
// config is missing/not a friend course contributes no head, so the read-time
// filter fails open for it (see buildVisitorPracticeView).
export function buildChainHeads(configEntries) {
    const heads = new Map();
    if (!Array.isArray(configEntries)) return heads;
    for (const entry of configEntries) {
        if (!entry || typeof entry.courseId !== 'string' || !entry.courseId) continue;
        const firstLessonId = firstFriendLessonId(entry.config);
        if (firstLessonId) heads.set(entry.courseId, firstLessonId);
    }
    return heads;
}

// Recorder direction of the "featured for the visitor" match: the visitor's own
// counted_lessons carries the `<courseId>_<recordedLessonId>` key (existing
// first-underscore convention). Joined on recordedLessonId, never lessonId.
function viewerCountedEntry(entry, countedLessons) {
    if (!Array.isArray(countedLessons)) return false;
    return countedLessons.includes(`${entry.courseId}_${entry.recordedLessonId}`);
}

// Inbox direction: the visitor's inbox has a friend_response row whose actor is
// the profile owner and whose (course_id, lesson_id) is the owner's recorded
// lesson. `ownerShareCode` is the profile owner's code (already normalized).
function viewerNotifiedEntry(entry, notifications, ownerShareCode) {
    if (!ownerShareCode || !Array.isArray(notifications)) return false;
    return notifications.some((row) =>
        row && row.type === NOTIFICATION_TYPE_FRIEND_RESPONSE
        && normalizeShareCode(row.payload?.actorShareCode) === ownerShareCode
        && row.course_id === entry.courseId
        && row.lesson_id === entry.recordedLessonId);
}

/**
 * Visitor-aware render view for the public-profile friend-practice area.
 *
 * - logged out (`viewer` null): only the chain-head (`a`) lessons are listed.
 * - logged in: lessons the visitor features in come first, then the `a`
 *   lessons; a featuring entry never repeats in the `a` group.
 * - `chainHeads` maps courseId → first shareCta lesson; a course absent from
 *   the map (config fetch failed) fails open and keeps the entry.
 * - every listed entry carries `completedTogether` (the recorder-direction
 *   match), so the section can badge joint completions.
 *
 * With neither `viewer` nor any `chainHeads` this delegates to
 * `buildFriendPracticeView`, preserving the pre-visitor output exactly.
 */
export function buildVisitorPracticeView({ friendLinks, nowMs, viewer = null, chainHeads = null } = {}) {
    const heads = chainHeads instanceof Map ? chainHeads : new Map();
    if (!viewer && heads.size === 0) {
        return buildFriendPracticeView(friendLinks, nowMs);
    }

    const ownerShareCode = viewer ? normalizeShareCode(viewer.ownerShareCode) : null;
    const countedLessons = viewer?.counted_lessons ?? [];
    const notifications = viewer?.notifications ?? [];

    const isFeaturing = (entry) => !!viewer
        && (viewerNotifiedEntry(entry, notifications, ownerShareCode)
            || viewerCountedEntry(entry, countedLessons));

    const isChainHead = (entry) => !heads.has(entry.courseId)
        || entry.recordedLessonId === heads.get(entry.courseId);

    const active = listActiveFriendLinks(friendLinks, nowMs);
    const featuring = active.filter(isFeaturing);
    const featuringSet = new Set(featuring);
    const listed = [
        ...featuring,
        ...active.filter((entry) => !featuringSet.has(entry) && isChainHead(entry)),
    ].map((entry) => ({
        ...entry,
        completedTogether: viewerCountedEntry(entry, countedLessons),
    }));

    const groups = groupEntries(listed);
    const activeView = groups.length > 0;
    return { mode: activeView ? 'active' : 'expired', groups, isTicking: activeView };
}

/**
 * Gate + payload for recording a link at export time. Pure; no store/Supabase.
 * - a link is created when the exported lesson is a shareCta lesson with a
 *   later shareCta lesson after it (the next ping-pong turn)
 * - a real export (succeeded > 0) and a shareCode are required
 * - `recordedLessonId` is the exported lesson (map key + profile label source);
 *   `lessonId` is the follow-on lesson the visitor records in (href target)
 * - the returned lessonTitle is the RECORDED lesson's English title (a string,
 *   normalized before export), so the profile can label the link
 */
export function resolveFriendLessonLink({ configData, lessonId, courseId, courseName, shareCode, succeeded } = {}) {
    if (!succeeded || !shareCode || !courseId) return null;
    const nextId = nextFriendLessonId(configData, lessonId);
    if (!nextId) return null;
    const recorded = configData.lessons.find((l) => l.lessonId === lessonId);
    const lessonTitle = typeof recorded?.title === 'string' ? recorded.title : '';
    return {
        courseId,
        courseName: typeof courseName === 'string' ? courseName : '',
        recordedLessonId: lessonId,
        lessonId: nextId,
        shareCode,
        lessonTitle,
    };
}
