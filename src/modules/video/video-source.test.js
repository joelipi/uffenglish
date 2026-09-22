import { describe, it, expect } from 'vitest';
import { isFriendVideoSlug, remoteSource } from './video-source.js';

describe('isFriendVideoSlug', () => {
    it('recognizes friend/UGC slugs (-response-NN)', () => {
        // Slugs after {friendCode} substitution: {shareCode}-model-w-response-01
        expect(isFriendVideoSlug('abc123-model-w-response-01')).toBe(true);
        expect(isFriendVideoSlug('zzz9-model-wf-response-02')).toBe(true);
    });

    it('rejects teacher slugs and non-strings', () => {
        expect(isFriendVideoSlug('testvideo02')).toBe(false);
        expect(isFriendVideoSlug('do_you_have_rolls_too')).toBe(false);
        // No false positive on "-response" without a trailing number.
        expect(isFriendVideoSlug('response')).toBe(false);
        expect(isFriendVideoSlug('')).toBe(false);
        expect(isFriendVideoSlug(null)).toBe(false);
        expect(isFriendVideoSlug(undefined)).toBe(false);
        expect(isFriendVideoSlug(42)).toBe(false);
    });
});

describe('remoteSource', () => {
    it('classifies friend vs system', () => {
        expect(remoteSource('abc123-model-w-response-01')).toBe('friend');
        expect(remoteSource('testvideo02')).toBe('system');
        expect(remoteSource(null)).toBe('system');
    });
});
