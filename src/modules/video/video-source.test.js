import { describe, it, expect } from 'vitest';
import { isUgcSlug, isFriendVideoSlug, remoteSource, setKnownShareCodes } from './video-source.js';

// UGC is identified by matching the share codes IN PLAY, never by slug shape.
const CODES = ['ab12', 'gs5i8'];

describe('isUgcSlug', () => {
    it('is true when the slug starts with a code in play', () => {
        expect(isUgcSlug('ab12-gs5i8-wouldyourather-b-02', CODES)).toBe(true);
        expect(isUgcSlug('gs5i8-gs5i8-wouldyourather-a-01', CODES)).toBe(true);
        expect(isUgcSlug('ab12-ab12-wouldyourather-a-complete', CODES)).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isUgcSlug('AB12-gs5i8-course-l-01', CODES)).toBe(true);
        expect(isUgcSlug('ab12-course-l-01', ['AB12'])).toBe(true);
    });

    it('treats an unresolved {friendCode} reference as UGC', () => {
        expect(isUgcSlug('{friendCode}wouldyourather-a-response-01', [])).toBe(true);
    });

    it('is false for system slugs, even hyphenated English ones', () => {
        // The reason the rule is code-based: these are gt2 prompts whose shape is
        // indistinguishable from a share-code prefix.
        expect(isUgcSlug('do-you-think-youre-a-good-friend', CODES)).toBe(false);
        expect(isUgcSlug('im-gonna-miss-you-here', CODES)).toBe(false);
        expect(isUgcSlug('wouldyourather-a-01', CODES)).toBe(false);
        expect(isUgcSlug('testvideo02', CODES)).toBe(false);
        expect(isUgcSlug('response', CODES)).toBe(false);
    });

    it('is false when no codes are known', () => {
        expect(isUgcSlug('ab12-course-l-01', [])).toBe(false);
    });

    it('handles junk input', () => {
        expect(isUgcSlug('', CODES)).toBe(false);
        expect(isUgcSlug(null, CODES)).toBe(false);
        expect(isUgcSlug(undefined, CODES)).toBe(false);
        expect(isUgcSlug(42, CODES)).toBe(false);
    });
});

describe('the code registry', () => {
    it('defaults to the codes set by setKnownShareCodes', () => {
        setKnownShareCodes(['q9uki', '']);
        expect(isUgcSlug('q9uki-q9uki-course-l-01')).toBe(true);
        expect(isUgcSlug('ab12-course-l-01')).toBe(false);
        setKnownShareCodes([]); // reset for other tests
    });
});

describe('isFriendVideoSlug (historical name)', () => {
    it('is the same predicate', () => {
        expect(isFriendVideoSlug('ab12-course-l-01', CODES)).toBe(true);
        expect(isFriendVideoSlug('testvideo02', CODES)).toBe(false);
    });
});

describe('remoteSource', () => {
    it('maps UGC to friend and everything else to system', () => {
        expect(remoteSource('ab12-gs5i8-course-l-01', CODES)).toBe('friend');
        expect(remoteSource('{friendCode}course-a-response-01', [])).toBe('friend');
        expect(remoteSource('testvideo02', CODES)).toBe('system');
        expect(remoteSource(null, CODES)).toBe('system');
    });
});
