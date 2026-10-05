// modules/notifications/notification-logic.js
// Pure domain logic for friend-response notifications. No DOM, no React, no
// React Native, no data access — fully unit-testable and safe in a monorepo.
// Presentation lives in the platform-tagged components under
// src/components/homescreen/ (NotificationList.web.jsx / NotificationsBell.web.jsx).

import { hasEarlierShareCtaLesson } from '../user/friend-lesson-link-logic.js';
import { buildShareUrl } from '../video/video-processor-logic.js';
import { LOCALE_MAP } from '../../data/languages.js';

export const NOTIFICATION_TYPE_FRIEND_RESPONSE = 'friend_response';

/**
 * Localized, human-readable timestamp for a notification row. Pure and
 * platform-agnostic (works in the browser and in Hermes).
 *
 * `lang` may be any case/locale ('EN', 'en', 'en-US'); LOCALE_MAP is keyed by
 * the uppercase base code, so normalize for the lookup and fall back to
 * English for unsupported codes. Invalid/missing dates return ''.
 */
export function formatNotificationDate(createdAt, lang = 'en') {
    if (createdAt == null || createdAt === '') return '';
    const t = new Date(createdAt).getTime();
    if (!Number.isFinite(t)) return '';
    const base = String(lang || 'en').split('-')[0].toUpperCase();
    const locale = LOCALE_MAP[base] || 'en';
    return new Date(t).toLocaleString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

// Trim + lowercase; '' and non-strings become null.
export function normalizeShareCode(code) {
    return (typeof code === 'string' ? code.trim().toLowerCase() : '') || null;
}

// Public profile URL for a share code: https://<host>/<code>.
// buildShareUrl is the canonical '<host>/<code>' builder; add the scheme for a
// clickable anchor (SHARE_URL_BASE is deliberately scheme-less).
export function buildProfileHref(shareCode) {
    const raw = typeof shareCode === 'string' ? shareCode.trim() : '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const url = buildShareUrl(normalizeShareCode(shareCode));
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function getUnreadCount(notifications) {
    if (!Array.isArray(notifications)) return 0;
    return notifications.reduce((count, n) => count + (n && !n.read_at ? 1 : 0), 0);
}

// Newest first; non-array / junk entries are ignored.
export function listNotifications(notifications) {
    if (!Array.isArray(notifications)) return [];
    return notifications
        .filter((n) => n && typeof n === 'object' && n.id)
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function getNotificationActorName(notification) {
    const name = notification?.payload?.actorName;
    return typeof name === 'string' ? name.trim() : '';
}

export function getNotificationActorShareCode(notification) {
    return normalizeShareCode(notification?.payload?.actorShareCode);
}

/**
 * Gate + RPC payload for recording a friend-response notification. Pure.
 * Fires only when a real publish happened for a chain lesson that has an
 * earlier shareCta lesson (i.e. the answer side of the ping-pong), in a course
 * that actually contains that lesson, with a recipient code that is not the
 * actor's own. Returns null otherwise.
 */
export function resolveFriendResponseNotification({
    configData,
    lessonId,
    courseId,
    recipientShareCode,
    actorShareCode,
    succeeded,
} = {}) {
    if (!succeeded || !courseId) return null;
    // `hasEarlierShareCtaLesson` itself rejects a lessonId absent from the config.
    if (!hasEarlierShareCtaLesson(configData, lessonId)) return null;
    const recipient = normalizeShareCode(recipientShareCode);
    const actor = normalizeShareCode(actorShareCode);
    if (!recipient || !actor || recipient === actor) return null;
    return { recipientShareCode: recipient, courseId, lessonId };
}
