// Pure friend-completion credit rules. No React, no DOM, no store, no data
// access — so the gate (which completions credit the share-link owner) is
// unit-testable in isolation and reusable by a native client.
//
// A friend completion credits the owner of the share link (`?shareCode=`) when
// ALL of these hold:
// - the success step was reached by traversing the lesson in-app (a reload or
//   redirect landing is a phantom, never a completion),
// - the lesson is on the ANSWER side of a friend chain (it literally plays the
//   owner's videos — the prompt lesson does not),
// - an owner share code is present,
// - the completer is not the owner themselves.
// Authentication is NOT gated here: a guest completion stashes a pending
// credit that the signup/login flush sends. The server RPC re-verifies
// everything (actor from auth.uid(), self-exclusion) and is idempotent.

import { hasEarlierShareCtaLesson } from './friend-lesson-link-logic.js';
import { normalizeShareCode } from '../notifications/notification-logic.js';

// The answer side of a friend chain: a shareCta lesson with an earlier
// shareCta lesson before it. These are the lessons whose steps embed the
// owner's `{friendCode}` clips — the prompt (first) lesson has none.
export function isAnswerSideFriendLesson({ configData, lessonId } = {}) {
    return hasEarlierShareCtaLesson(configData, lessonId);
}

/**
 * Gate + RPC payload for crediting a friend completion to the share-link
 * owner. Returns null when no credit applies. The actor's own share code may
 * be null (guest) — self-completion is only excluded when the actor is known.
 */
export function resolveFriendCredit({
    configData,
    lessonId,
    courseId,
    ownerShareCode,
    actorShareCode,
    completedInApp,
} = {}) {
    if (!completedInApp) return null;
    if (!courseId || !lessonId) return null;
    if (!isAnswerSideFriendLesson({ configData, lessonId })) return null;
    const owner = normalizeShareCode(ownerShareCode);
    if (!owner) return null;
    const actor = normalizeShareCode(actorShareCode);
    if (actor && actor === owner) return null;
    return { ownerShareCode: owner, courseId, lessonId };
}

// Stable key for one pending credit. Friend credit counts UNIQUE users, so
// repeat completions of the same lesson collapse to one pending entry — the
// server RPC additionally dedupes, making flushes idempotent.
export function pendingCreditKey(credit) {
    const { ownerShareCode, courseId, lessonId } = credit || {};
    if (!ownerShareCode || !courseId || !lessonId) return null;
    return `${ownerShareCode}|${courseId}|${lessonId}`;
}

// Immutable append for the pending-credit queue. A guest may complete several
// lessons before an account exists; each must survive until signup/login.
// Entries with the same key collapse (unique-users semantics).
export function appendPendingCredit(existing, credit) {
    const list = Array.isArray(existing) ? [...existing] : [];
    if (!credit || typeof credit !== 'object') return list;
    const key = pendingCreditKey(credit);
    if (!key) return list;
    if (list.some((e) => pendingCreditKey(e) === key)) return list;
    return [...list, { ownerShareCode: credit.ownerShareCode, courseId: credit.courseId, lessonId: credit.lessonId }];
}
