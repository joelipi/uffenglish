// modules/notifications/push-copy.test.js
import { describe, it, expect } from 'vitest';
import {
    buildPushNotification,
    normalizePushLanguage,
    notificationUrlForShareCode,
    pushCopyInputFromRecord,
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

describe('buildPushNotification', () => {
    const row = { type: 'friend_response', actorName: 'Ada', actorShareCode: 'ab12' };

    it('builds localized title, body and url', () => {
        const en = buildPushNotification({ ...row, lang: 'en' });
        expect(en).toEqual({
            title: 'New video with your questions',
            body: 'Ada created a video with your questions',
            url: '/ab12',
        });
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
        expect(other.body).toBe('Ada created a video with your questions');
        expect(missing.body).toBe('Ada created a video with your questions');
    });

    it('falls back to a generic actor name when the row has none', () => {
        const copy = buildPushNotification({ ...row, actorName: '   ', lang: 'en' });
        expect(copy.body).toBe('A friend created a video with your questions');
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
            lang: 'fr',
        });
    });

    it('is null-safe for a malformed record', () => {
        expect(pushCopyInputFromRecord(null, 'en')).toEqual({
            type: null,
            actorName: null,
            actorShareCode: null,
            lang: 'en',
        });
    });
});
