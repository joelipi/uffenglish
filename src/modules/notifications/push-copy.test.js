// modules/notifications/push-copy.test.js
import { describe, it, expect } from 'vitest';
import {
    buildPushNotification,
    normalizePushLanguage,
    notificationUrlForShareCode,
    notificationCollapseKey,
    pushCopyInputFromRecord,
    MAX_COLLAPSE_KEY_LENGTH,
} from './push-copy.js';

describe('normalizePushLanguage', () => {
    it('normalizes locales and falls back to English', () => {
        expect(normalizePushLanguage('es-ES')).toBe('es');
        expect(normalizePushLanguage('BN')).toBe('bn');
        expect(normalizePushLanguage('')).toBe('en');
        expect(normalizePushLanguage(null)).toBe('en');
        expect(normalizePushLanguage(undefined)).toBe('en');
    });

    it('maps the guest OTHER sentinel to English', () => {
        // The guest modal stores OTHER for "my language is not listed".
        expect(normalizePushLanguage('OTHER')).toBe('en');
        expect(normalizePushLanguage('other')).toBe('en');
    });
});

describe('notificationUrlForShareCode', () => {
    it('builds the actor profile path for a share code', () => {
        expect(notificationUrlForShareCode('Ab12')).toBe('/ab12');
        expect(notificationUrlForShareCode('  xy9  ')).toBe('/xy9');
    });

    it('never trusts the row: anything not a share code falls back to /home', () => {
        for (const value of [
            'https://evil.example',
            '//evil.example',
            'javascript:alert(1)',
            '/home',
            'a',
            'has space',
            '',
            null,
            undefined,
            42,
        ]) {
            expect(notificationUrlForShareCode(value), String(value)).toBe('/home');
        }
    });
});

describe('notificationCollapseKey', () => {
    it('uses the row id so a re-answer of the same notification collapses', () => {
        const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
        const key = notificationCollapseKey({ id });
        // 32 hex chars: within RFC 8030's 32-character Topic limit, url-safe.
        expect(key).toBe('0f8fad5bd9cb469fa16570867728950e');
        expect(key).toHaveLength(MAX_COLLAPSE_KEY_LENGTH);
        expect(key).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
        // Stable across calls — the same row always collapses onto itself.
        expect(notificationCollapseKey({ id })).toBe(key);
    });

    it('differs per row, so a different friend is a different notification', () => {
        expect(notificationCollapseKey({ id: 'aaaa-bbbb' }))
            .not.toBe(notificationCollapseKey({ id: 'cccc-dddd' }));
    });

    it('is undefined (non-collapsible) when the row has no usable id', () => {
        for (const record of [{}, { id: '' }, { id: '---' }, { id: 42 }, null, undefined]) {
            expect(notificationCollapseKey(record), JSON.stringify(record)).toBeUndefined();
        }
    });

    it('strips anything outside the url-safe alphabet and caps the length', () => {
        const key = notificationCollapseKey({ id: '!!aa??bb##' + 'x'.repeat(60) });
        expect(key).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
        expect(key.length).toBeLessThanOrEqual(MAX_COLLAPSE_KEY_LENGTH);
    });
});

describe('buildPushNotification', () => {
    const row = { type: 'friend_response', actorName: 'Ada', actorShareCode: 'ab12' };

    it('builds localized title, body, url and collapse tag', () => {
        const en = buildPushNotification({ ...row, id: 'row-1', lang: 'en' });
        expect(en).toEqual({
            title: 'New video with your questions',
            body: 'Ada continued your conversation lesson! 🥳See if you need to respond.',
            url: '/ab12',
            tag: 'row1',
        });
    });

    it('omits the tag when the row id is missing', () => {
        expect(buildPushNotification({ ...row, lang: 'en' }).tag).toBeUndefined();
    });

    it('translates the body for every supported language and never leaves a placeholder', () => {
        for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
            const copy = buildPushNotification({ ...row, lang });
            expect(copy.title, lang).toBeTruthy();
            expect(copy.body, lang).toContain('Ada');
            expect(copy.body, lang).not.toContain('{name}');
        }
    });

    it('uses an English fallback for an unknown or missing language', () => {
        const other = buildPushNotification({ ...row, lang: 'OTHER' });
        const missing = buildPushNotification({ ...row });
        expect(other.body).toBe('Ada continued your conversation lesson! 🥳See if you need to respond.');
        expect(missing.body).toBe('Ada continued your conversation lesson! 🥳See if you need to respond.');
    });

    it('falls back to a generic actor name when the row has none', () => {
        const copy = buildPushNotification({ ...row, actorName: '   ', lang: 'en' });
        expect(copy.body).toBe('A friend continued your conversation lesson! 🥳See if you need to respond.');
    });

    it('returns null for a type the app does not push', () => {
        expect(buildPushNotification({ ...row, type: 'something_else' })).toBeNull();
        expect(buildPushNotification({ ...row, type: undefined })).toBeNull();
        expect(buildPushNotification()).toBeNull();
    });
});

describe('pushCopyInputFromRecord', () => {
    it('reads a snake_case notification row', () => {
        const input = pushCopyInputFromRecord(
            { type: 'friend_response', payload: { actorName: 'Ada', actorShareCode: 'ab12' } },
            'fr'
        );
        expect(input).toEqual({
            type: 'friend_response',
            actorName: 'Ada',
            actorShareCode: 'ab12',
            id: undefined,
            lang: 'fr',
        });
    });

    it('is null-safe for a malformed record', () => {
        expect(pushCopyInputFromRecord(null, 'en')).toEqual({
            type: null,
            actorName: null,
            actorShareCode: null,
            id: null,
            lang: 'en',
        });
    });
});
