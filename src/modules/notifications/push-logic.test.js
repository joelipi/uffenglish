// modules/notifications/push-logic.test.js
import { describe, it, expect } from 'vitest';
import {
    urlBase64ToUint8Array,
    isUsableVapidKey,
    shouldOfferPushNotifications,
    hasJustInstalled,
    describeSubscribeResult,
    PUSH_PROMPT_DISMISSED_KEY,
} from './push-logic.js';
import { DEFAULT_VAPID_PUBLIC_KEY } from './push-config.js';

describe('urlBase64ToUint8Array', () => {
    it('decodes the app\'s own VAPID key to an uncompressed P-256 point', () => {
        const bytes = urlBase64ToUint8Array(DEFAULT_VAPID_PUBLIC_KEY);
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(65);
        expect(bytes[0]).toBe(0x04);
    });

    it('handles base64url characters and missing padding', () => {
        // "hello" -> aGVsbG8 (no padding needed); with padding it still decodes.
        expect(Array.from(urlBase64ToUint8Array('aGVsbG8'))).toEqual([104, 101, 108, 108, 111]);
        // url-safe alphabet: 0xFB 0xFF encodes as "-_8" in base64url.
        expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
    });

    it('returns null instead of throwing for junk input', () => {
        expect(urlBase64ToUint8Array('')).toBeNull();
        expect(urlBase64ToUint8Array(null)).toBeNull();
        expect(urlBase64ToUint8Array(undefined)).toBeNull();
        expect(urlBase64ToUint8Array(42)).toBeNull();
        expect(urlBase64ToUint8Array('!!!not base64!!!')).toBeNull();
    });
});

describe('isUsableVapidKey', () => {
    it('accepts the committed key and rejects malformed values', () => {
        expect(isUsableVapidKey(DEFAULT_VAPID_PUBLIC_KEY)).toBe(true);
        expect(isUsableVapidKey('')).toBe(false);
        expect(isUsableVapidKey('not-a-key')).toBe(false);
        // Right length, wrong leading byte (must be 0x04 for uncompressed).
        const wrongPrefix = Buffer.from([0x02, ...Buffer.alloc(64, 1)]).toString('base64url');
        expect(isUsableVapidKey(wrongPrefix)).toBe(false);
    });
});

describe('shouldOfferPushNotifications', () => {
    const base = { supported: true, isLoggedIn: true, hasVapidKey: true, permission: 'default' };

    it('offers only when every gate holds', () => {
        expect(shouldOfferPushNotifications(base)).toBe(true);
    });

    it('is false for each individual unmet gate', () => {
        expect(shouldOfferPushNotifications({ ...base, supported: false })).toBe(false);
        expect(shouldOfferPushNotifications({ ...base, isLoggedIn: false })).toBe(false);
        expect(shouldOfferPushNotifications({ ...base, hasVapidKey: false })).toBe(false);
        expect(shouldOfferPushNotifications({ ...base, permission: 'denied' })).toBe(false);
        expect(shouldOfferPushNotifications({ ...base, isSubscribed: true })).toBe(false);
        expect(shouldOfferPushNotifications({ ...base, dismissed: true })).toBe(false);
    });

    it('still offers when permission is already granted but this device is not subscribed', () => {
        // e.g. site data cleared: asking again is not needed, subscribing is.
        expect(shouldOfferPushNotifications({ ...base, permission: 'granted' })).toBe(true);
    });

    it('is false with no arguments (guests / unsupported browsers)', () => {
        expect(shouldOfferPushNotifications()).toBe(false);
    });
});

describe('hasJustInstalled', () => {
    it('is true only on the false -> true transition', () => {
        expect(hasJustInstalled({ wasStandalone: false, isStandalone: true })).toBe(true);
        expect(hasJustInstalled({ wasStandalone: true, isStandalone: true })).toBe(false);
        expect(hasJustInstalled({ wasStandalone: false, isStandalone: false })).toBe(false);
        expect(hasJustInstalled({ wasStandalone: true, isStandalone: false })).toBe(false);
        expect(hasJustInstalled()).toBe(false);
    });
});

describe('describeSubscribeResult', () => {
    it('maps each outcome to a renderable state', () => {
        expect(describeSubscribeResult({ ok: true })).toBe('subscribed');
        expect(describeSubscribeResult({ ok: false, reason: 'denied' })).toBe('denied');
        expect(describeSubscribeResult({ ok: false, reason: 'unsupported' })).toBe('unsupported');
        expect(describeSubscribeResult({ ok: false, reason: 'not-configured' })).toBe('not-configured');
        expect(describeSubscribeResult({ ok: false, reason: 'not-signed-in' })).toBe('not-signed-in');
        expect(describeSubscribeResult({ ok: false, reason: 'anything-else' })).toBe('failed');
        expect(describeSubscribeResult(null)).toBe('failed');
    });
});

describe('PUSH_PROMPT_DISMISSED_KEY', () => {
    it('is a stable storage key', () => {
        expect(PUSH_PROMPT_DISMISSED_KEY).toBe('uff-push-prompt-dismissed');
    });
});
