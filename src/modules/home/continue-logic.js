// modules/home/continue-logic.js
// Pure Continue-target resolution for the /home dashboard button.
// No React, no DOM, no store, no Supabase, no data access — fully
// unit-testable and safe in a monorepo or native client.
//
// Background: the button used to resume the persisted tuple verbatim
// (`/course/<courseId>/lesson/<activeLessonId>`). That link is correct for
// single-user courses but re-enters friend (`recapOverlay: "shareCta"`)
// response lessons solo: only the first chain lesson is startable without a
// `?shareCode=`, later lessons embed `{friendCode}` clips, and the resume
// bypasses the 48h friend-link period (story 061).
//
// Resolution order for a friend-course resume (all hrefs are in-app paths
// for react-router `navigate()`, never the scheme-less external share URLs):
//   1. oldest still-active (< 48h) friend response entry across the viewer's
//      friends, as `/course/<course>/<next>?shareCode=<friendCode>` — the
//      entry (write-time validated) is the href source, never the
//      notification row's untrusted context columns;
//   2. the `a` lesson of a randomly chosen unstarted friend course
//      (solo-startable by the `firstFriendLessonId` contract);
//   3. the most-recent started non-friend course resume (legacy solo shape);
//   4. null (the button hides; the course cards remain).
// A non-friend resume keeps the exact legacy solo link (both ids required,
// else null). An unclassifiable resume (entries not loaded, unknown course,
// fixture course) resolves to null so a broken link is never shown.

import {
    isFriendCourse,
    firstFriendLessonId,
    EXCLUDED_FRIEND_COURSE_IDS,
    buildCourseStartHref,
} from '../courses/friend-courses-logic.js';
import { listActiveFriendLinks } from '../user/friend-lesson-link-logic.js';
import { normalizeShareCode } from '../notifications/notification-logic.js';

// Config basenames that must never be recommended: the `test` fixture
// (same precedent as EXCLUDED_FRIEND_COURSE_IDS) plus the `test-api`
// single-lesson fixture. Neither is a real user course.
export const EXCLUDED_CONTINUE_COURSE_IDS = [...EXCLUDED_FRIEND_COURSE_IDS, 'test-api'];

// Fail-open parse for the `user_profiles.course_progress` text map
// (`{ <courseId>: { current_lesson, lesson_timestamp } }`). Corrupt,
// missing, or non-object payloads count as "nothing started", never throw.
export function parseCourseProgress(text) {
    if (typeof text !== 'string' || text.trim() === '') return {};
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

// Basenames the learner has started: keys of the progress map plus the
// `courseId` prefixes of `counted_lessons` (`<courseId>_<lessonId>` keys).
export function startedCourseBasenames({ courseProgressText = null, countedLessons = [] } = {}) {
    const started = new Set();
    for (const key of Object.keys(parseCourseProgress(courseProgressText))) {
        if (key) started.add(key);
    }
    for (const key of Array.isArray(countedLessons) ? countedLessons : []) {
        if (typeof key !== 'string') continue;
        const sep = key.indexOf('_');
        if (sep > 0) started.add(key.slice(0, sep));
    }
    return started;
}

export function findConfigEntry(configEntries, courseId) {
    if (!Array.isArray(configEntries) || !courseId) return null;
    return configEntries.find((e) => e && e.courseId === courseId) || null;
}

// Friend-type classification for a resume courseId. Returns null when the
// course cannot be classified (entries not loaded yet, course absent, or a
// fixture id) so the caller hides instead of guessing.
export function isFriendCourseId(courseId, configEntries) {
    if (!courseId || EXCLUDED_CONTINUE_COURSE_IDS.includes(courseId)) return null;
    const entry = findConfigEntry(configEntries, courseId);
    if (!entry || !entry.config) return null;
    return isFriendCourse(entry.config);
}

// Friend courses eligible for recommendation: real shareCta courses only.
export function friendCourseEntries(configEntries) {
    if (!Array.isArray(configEntries)) return [];
    return configEntries.filter((e) =>
        e && typeof e.courseId === 'string' && e.courseId !== '' &&
        !EXCLUDED_CONTINUE_COURSE_IDS.includes(e.courseId) &&
        e.config && isFriendCourse(e.config));
}

// Deduped friend actor share codes from the viewer's notification inbox,
// newest first (the inbox query already orders newest-first). Blank codes
// and the viewer's own code are skipped.
export function collectFriendActorCodes(notifications, selfShareCode) {
    if (!Array.isArray(notifications)) return [];
    const self = normalizeShareCode(selfShareCode);
    const seen = new Set();
    const codes = [];
    for (const n of notifications) {
        const code = normalizeShareCode(n?.payload?.actorShareCode);
        if (!code || code === self || seen.has(code)) continue;
        seen.add(code);
        codes.push(code);
    }
    return codes;
}

// Pairs fetched profiles back to their actor codes for the resolver.
// `results` are the per-actor profile rows (or null on fetch failure —
// fail-open: that friend is skipped). Only the `friendLinks` map is kept.
export function buildFriendLinksMaps(actorCodes, results) {
    if (!Array.isArray(actorCodes) || !Array.isArray(results)) return [];
    const maps = [];
    for (let i = 0; i < actorCodes.length; i++) {
        const row = results[i];
        if (!row || typeof row !== 'object') continue;
        const friendLinks = row.friendLinks ?? row.friend_links;
        if (!friendLinks || typeof friendLinks !== 'object' || Array.isArray(friendLinks)) continue;
        maps.push({ shareCode: actorCodes[i], friendLinks });
    }
    return maps;
}

// Oldest still-active friend response entry across friends (smallest
// `addedAt` inside the 48h period). Expired and malformed entries are
// dropped by `listActiveFriendLinks`; the entry's own `shareCode` names
// the friend whose clips the follow-on lesson answers.
export function oldestActiveFriendEntry(friendLinksMaps, nowMs) {
    if (!Array.isArray(friendLinksMaps)) return null;
    let best = null;
    let bestAt = Infinity;
    for (const m of friendLinksMaps) {
        if (!m || typeof m !== 'object') continue;
        for (const entry of listActiveFriendLinks(m.friendLinks, nowMs)) {
            const at = new Date(entry.addedAt).getTime();
            if (Number.isFinite(at) && at < bestAt) {
                best = entry;
                bestAt = at;
            }
        }
    }
    return best;
}

// Deterministic pick from a pre-sorted id list. `rand` is injectable so
// tests pin the choice; the component relies on memoization (not this
// function) for target stability across re-renders.
export function pickRandomId(sortedIds, rand = Math.random) {
    if (!Array.isArray(sortedIds) || sortedIds.length === 0) return null;
    const raw = typeof rand === 'function' ? rand() : 0;
    const num = Number(raw);
    const frac = Number.isFinite(num) ? Math.min(Math.max(num, 0), 0.999999999) : 0;
    return sortedIds[Math.floor(frac * sortedIds.length)];
}

// Most-recent started non-friend course: `course_progress` timestamp
// descending, missing/corrupt timestamps last, basename ascending
// tie-break. Returns the basename or null.
export function mostRecentStartedNonFriend({ courseProgressText = null, countedLessons = [], configEntries = null } = {}) {
    const progress = parseCourseProgress(courseProgressText);
    const started = startedCourseBasenames({ courseProgressText, countedLessons });
    const candidates = [...started].filter((id) =>
        !EXCLUDED_CONTINUE_COURSE_IDS.includes(id) && isFriendCourseId(id, configEntries) === false);
    if (candidates.length === 0) return null;
    const timestampOf = (id) => {
        const t = new Date(progress[id]?.lesson_timestamp).getTime();
        return Number.isFinite(t) ? t : -1;
    };
    candidates.sort((a, b) => (timestampOf(b) - timestampOf(a)) || (a < b ? -1 : a > b ? 1 : 0));
    return candidates[0];
}

// In-app friend response path. Built from the path helper (react-router
// `navigate()` needs `/course/...`, not the scheme-less external share URL
// `buildFriendLessonLink` produces for profile anchors) with the same
// lesson + share code the share URL carries.
export function buildFriendContinuePath({ courseId, lessonId, shareCode } = {}) {
    if (!courseId || !lessonId || !shareCode) return null;
    return `${buildCourseStartHref(courseId, lessonId)}?shareCode=${encodeURIComponent(shareCode)}`;
}

/**
 * Full Continue-target resolution. Returns the in-app target path or null
 * (hide the button). Pure: same inputs + same `rand` always give the same
 * output, and it never throws on malformed inputs.
 */
export function resolveContinueTarget({
    courseId = null,
    activeLessonId = null,
    configEntries = null,
    courseProgressText = null,
    countedLessons = [],
    friendLinksMaps = [],
    nowMs = Date.now(),
    rand = Math.random,
} = {}) {
    if (!courseId) return null;
    const friendType = isFriendCourseId(courseId, configEntries);
    if (friendType === null) return null;
    if (friendType === false) {
        if (!activeLessonId) return null;
        return buildCourseStartHref(courseId, activeLessonId);
    }
    const active = oldestActiveFriendEntry(friendLinksMaps, nowMs);
    if (active) {
        const path = buildFriendContinuePath({
            courseId: active.courseId,
            lessonId: active.lessonId,
            shareCode: active.shareCode,
        });
        if (path) return path;
    }
    const started = startedCourseBasenames({ courseProgressText, countedLessons });
    const unstarted = friendCourseEntries(configEntries)
        .map((e) => e.courseId)
        .filter((id) => id !== courseId && !started.has(id))
        .sort();
    const pick = pickRandomId(unstarted, rand);
    if (pick) {
        const firstId = firstFriendLessonId(findConfigEntry(configEntries, pick)?.config);
        if (firstId) return buildCourseStartHref(pick, firstId);
    }
    const fallbackCourse = mostRecentStartedNonFriend({ courseProgressText, countedLessons, configEntries });
    if (fallbackCourse) {
        const progress = parseCourseProgress(courseProgressText);
        const current = progress[fallbackCourse]?.current_lesson;
        if (current) return buildCourseStartHref(fallbackCourse, current);
        const first = findConfigEntry(configEntries, fallbackCourse)?.config?.lessons?.[0]?.lessonId;
        if (first) return buildCourseStartHref(fallbackCourse, first);
    }
    return null;
}
