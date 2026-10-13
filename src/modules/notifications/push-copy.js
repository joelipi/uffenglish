// src/modules/notifications/push-copy.js
// The push message a notification row becomes. Shared by the sender Function
// (which composes it in the RECIPIENT's language) and its unit test — pure, no
// DOM, no network, so both stacks can import it.
//
// Copy reuses the existing notification strings where they already exist in all
// six languages (`notifications_friend_response`, `notifications_someone`) and
// adds only the one push-specific title.
import { get } from '../../data/strings.js';

export const PUSH_NOTIFICATION_TYPES = ['friend_response'];

// A share code is a short lowercase alphanumeric token (see 005's
// `lower(p.share_code)` lookup). Anything else — including a URL an actor tried
// to smuggle through the payload — falls back to the app home.
const SHARE_CODE_PATTERN = /^[a-z0-9]{2,32}$/;

/**
 * Normalize a stored language for copy lookup. A missing value and the guest
 * modal's `OTHER` sentinel ("my language is not listed") both resolve to
 * English, so no lookup or `lang` attribute ever sees `'other'`.
 */
export function normalizePushLanguage(lang) {
    if (typeof lang !== 'string') return 'en';
    const code = lang.split('-')[0].trim().toLowerCase();
    if (!code || code === 'other') return 'en';
    return code;
}

/** `/<shareCode>` for the actor's public profile, else `/home`. */
export function notificationUrlForShareCode(shareCode) {
    const code = typeof shareCode === 'string' ? shareCode.trim().toLowerCase() : '';
    return SHARE_CODE_PATTERN.test(code) ? `/${code}` : '/home';
}

/**
 * `{ title, body, url }` for a `user_notifications` row, or `null` for a type
 * the app does not push (an unknown type is skipped rather than guessed at).
 */
export function buildPushNotification({ type, actorName, actorShareCode, lang } = {}) {
    if (!PUSH_NOTIFICATION_TYPES.includes(type)) return null;

    const language = normalizePushLanguage(lang);
    const fallbackName = get('notifications_someone', language);
    const name = typeof actorName === 'string' && actorName.trim() ? actorName.trim() : fallbackName;

    return {
        title: get('push_friend_response_title', language),
        body: get('notifications_friend_response', language, { name }),
        url: notificationUrlForShareCode(actorShareCode),
    };
}

/** Read a notification row (snake_case from Postgres) into the copy inputs. */
export function pushCopyInputFromRecord(record, lang) {
    return {
        type: record && record.type,
        actorName: record && record.payload && record.payload.actorName,
        actorShareCode: record && record.payload && record.payload.actorShareCode,
        lang,
    };
}
