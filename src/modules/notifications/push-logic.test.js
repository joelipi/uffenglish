// modules/notifications/push-logic.test.js
import { describe, it, expect } from 'vitest';
import {
    urlBase64ToUint8Array,
    isUsableVapidKey,
    shouldOfferPushNotifications,
    resolvePushPromptState,
    describeSubscribeResult,
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
        expect(shouldOfferPushNotifications({ ...base, isSubscribed: true })).toBe(false);
    });

    it('has no dismissal input: only being subscribed removes the offer', () => {
        // "Keep offering until notifications are enabled" — a dismissal must not
        // be able to switch the offer off.
        expect(shouldOfferPushNotifications({ ...base, dismissed: true })).toBe(true);
    });

    it('still offers when permission is already granted but this device is not subscribed', () => {
        // e.g. site data cleared: asking again is not needed, subscribing is.
        expect(shouldOfferPushNotifications({ ...base, permission: 'granted' })).toBe(true);
        expect(resolvePushPromptState({ ...base, permission: 'granted' })).toBe('ready');
    });

    it('is false with no arguments (guests / unsupported browsers)', () => {
        expect(shouldOfferPushNotifications()).toBe(false);
    });
});

describe('resolvePushPromptState', () => {
    const base = { supported: true, isLoggedIn: true, hasVapidKey: true };

    it('is hidden when there is nothing to offer', () => {
        expect(resolvePushPromptState()).toBe('hidden');
        expect(resolvePushPromptState({ ...base, supported: false })).toBe('hidden');
        expect(resolvePushPromptState({ ...base, isLoggedIn: false })).toBe('hidden');
        expect(resolvePushPromptState({ ...base, hasVapidKey: false })).toBe('hidden');
        expect(resolvePushPromptState({ ...base, isSubscribed: true })).toBe('hidden');
    });

    it('is ready when the button can actually subscribe', () => {
        expect(resolvePushPromptState({ ...base, permission: 'default' })).toBe('ready');
        expect(resolvePushPromptState({ ...base, permission: 'granted' })).toBe('ready');
    });

    it('is blocked (not hidden) when the OS already denied permission', () => {
        // The user can still unblock it in browser settings, so the offer must
        // stay visible rather than silently vanishing.
        expect(resolvePushPromptState({ ...base, permission: 'denied' })).toBe('blocked');
    });
});

describe('describeSubscribeResult', () => {
    it('maps each outcome to a renderable state', () => {
        expect(describeSubscribeResult({ ok: true })).toBe('subscribed');
        expect(describeSubscribeResult({ ok: false, reason: 'denied' })).toBe('denied');
        // A dismissal is its own state: it must not render as a denial.
        expect(describeSubscribeResult({ ok: false, reason: 'dismissed' })).toBe('dismissed');
        expect(describeSubscribeResult({ ok: false, reason: 'unsupported' })).toBe('unsupported');
        expect(describeSubscribeResult({ ok: false, reason: 'not-configured' })).toBe('not-configured');
        expect(describeSubscribeResult({ ok: false, reason: 'not-signed-in' })).toBe('not-signed-in');
        expect(describeSubscribeResult({ ok: false, reason: 'anything-else' })).toBe('failed');
        expect(describeSubscribeResult(null)).toBe('failed');
    });
});
