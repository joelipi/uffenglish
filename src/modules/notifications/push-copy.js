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
 * RFC 8030 §5.4 caps the Web Push `Topic` header (which makes a message
 * *collapsible* on FCM) at 32 URL-and-filename-safe base64 characters. The same
 * value doubles as the Notification `tag`, so repeats replace each other instead
 * of stacking.
 */
export const MAX_COLLAPSE_KEY_LENGTH = 32;
// Normalize to alphanumerics (a strict subset of the allowed alphabet): a UUID
// is then exactly 32 characters with nothing truncated, and a value made only of
// separators collapses to nothing instead of emitting a meaningless key.
const COLLAPSE_KEY_STRIP = /[^A-Za-z0-9]/g;

/**
 * A stable, URL-safe collapse key for one notification row.
 *
 * `user_notifications` is upserted on `(recipient_id, actor_id, type)`, so its
 * `id` survives a re-answer: using it means every re-answer of the *same*
 * notification collapses onto one entry (platform throttle + one visible
 * notification), while a different friend's answer is a different row and a
 * different key. Returns undefined when the row has no usable id, which leaves
 * the push non-collapsible rather than guessing.
 */
export function notificationCollapseKey(record) {
    const raw = record && typeof record.id === 'string' ? record.id : '';
    const compact = raw.replace(COLLAPSE_KEY_STRIP, '');
    if (!compact) return undefined;
    return compact.slice(0, MAX_COLLAPSE_KEY_LENGTH);
}

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
export function buildPushNotification({ type, actorName, actorShareCode, lang, id } = {}) {
    if (!PUSH_NOTIFICATION_TYPES.includes(type)) return null;

    const language = normalizePushLanguage(lang);
    const fallbackName = get('notifications_someone', language);
    const name = typeof actorName === 'string' && actorName.trim() ? actorName.trim() : fallbackName;

    return {
        title: get('push_friend_response_title', language),
        body: get('notifications_friend_response', language, { name }),
        url: notificationUrlForShareCode(actorShareCode),
        // Collapse key: undefined when the row carries no id.
        tag: notificationCollapseKey({ id }),
    };
}

/** Read a notification row (snake_case from Postgres) into the copy inputs. */
export function pushCopyInputFromRecord(record, lang) {
    return {
        type: record && record.type,
        actorName: record && record.payload && record.payload.actorName,
        actorShareCode: record && record.payload && record.payload.actorShareCode,
        id: record && record.id,
        lang,
    };
}
