import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getVideoUrl, getPosterUrl, getPermanentVideoUrl, getPermanentPosterUrl, getUgcThumbUrl, getUgcThumbKey, getCompleteVideoKey } from './video-url.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(__dirname, 'video-url.js'), 'utf8');

const CODES = ['hu7ni', 'mncb1'];

describe('getVideoUrl UGC routing', () => {
    it('routes teacher slugs to assets/videos/ (dev = relative, proxied)', () => {
        // In vitest/dev, import.meta.env.DEV is true → teacher videos use the
        // Vite proxy relative path (same-origin, avoids CORS locally). In prod
        // they resolve to the full R2 assets/videos/ URL.
        expect(getVideoUrl('testvideo02', CODES)).toBe('/assets/videos/testvideo02.mp4');
    });

    it('routes UGC slugs to videos/ (48h TTL namespace)', () => {
        expect(getVideoUrl('hu7ni-mncb1-wouldyourather-b-02', CODES))
            .toBe('https://r2.ultrafastfluency.com/videos/hu7ni-mncb1-wouldyourather-b-02.mp4');
        expect(getVideoUrl('mncb1-mncb1-wouldyourather-a-01', CODES))
            .toBe('https://r2.ultrafastfluency.com/videos/mncb1-mncb1-wouldyourather-a-01.mp4');
    });

    it('routes an unresolved {friendCode} reference to videos/', () => {
        expect(getVideoUrl('{friendCode}wouldyourather-a-response-01'))
            .toBe('https://r2.ultrafastfluency.com/videos/{friendCode}wouldyourather-a-response-01.mp4');
    });

    it('does not misroute hyphenated system slugs that look like a code prefix', () => {
        // gt2's prompts are shape-identical to `{code}-{code}-…`, so classification
        // must match the codes in play, never the shape.
        expect(getVideoUrl('do-you-think-youre-a-good-friend', CODES))
            .toBe('/assets/videos/do-you-think-youre-a-good-friend.mp4');
        expect(getVideoUrl('im-gonna-miss-you-here', CODES))
            .toBe('/assets/videos/im-gonna-miss-you-here.mp4');
    });

    it('does not misroute when no codes are known', () => {
        expect(getVideoUrl('hu7ni-mncb1-wouldyourather-b-02', [])).toBe('/assets/videos/hu7ni-mncb1-wouldyourather-b-02.mp4');
    });
});

describe('getPermanentVideoUrl', () => {
    it('always resolves to the permanent namespace, never classifying', () => {
        // A curated permanent copy whose name happens to start with a live code
        // must still resolve to assets/videos/.
        expect(getPermanentVideoUrl('mncb1-mncb1-wouldyourather-b-complete'))
            .toBe('/assets/videos/mncb1-mncb1-wouldyourather-b-complete.mp4');
    });
});

describe('getPosterUrl — uniform <video>.jpg rule (R2-only)', () => {
    it('teacher slug -> assets/videos/<slug>.jpg (dev relative, proxied)', () => {
        expect(getPosterUrl('do_you_have_rolls_too')).toMatch(/assets\/videos\/do_you_have_rolls_too\.jpg$/);
    });

    it('UGC slug -> videos/<slug>.jpg on R2', () => {
        expect(getPosterUrl('ab12-ab12-model-w-01', ['ab12']))
            .toBe('https://r2.ultrafastfluency.com/videos/ab12-ab12-model-w-01.jpg');
    });

    it('returns null for an empty or missing slug', () => {
        expect(getPosterUrl('')).toBeNull();
        expect(getPosterUrl(undefined)).toBeNull();
        expect(getPosterUrl(null)).toBeNull();
    });

    it('getPermanentPosterUrl never classifies', () => {
        expect(getPermanentPosterUrl('ab12-ab12-model-w-complete'))
            .toBe('/assets/videos/ab12-ab12-model-w-complete.jpg');
    });

    it('no longer exports/uses POSTER_BASE or an assets/posters path', () => {
        expect(SOURCE).not.toMatch(/POSTER_BASE/);
        expect(SOURCE).not.toMatch(/assets\/posters/);
    });
});

describe('UGC thumb helpers (sibling .jpg)', () => {
    it('getUgcThumbKey maps an mp4 key to its jpg sibling', () => {
        expect(getUgcThumbKey('videos/hu7ni-mncb1-wouldyourather-b-02.mp4')).toBe('videos/hu7ni-mncb1-wouldyourather-b-02.jpg');
        expect(getUgcThumbKey(undefined)).toBeNull();
    });

    it('getUgcThumbUrl maps an mp4 URL to its jpg sibling', () => {
        expect(getUgcThumbUrl('https://r2.ultrafastfluency.com/videos/hu7ni-mncb1-wouldyourather-b-02.mp4'))
            .toBe('https://r2.ultrafastfluency.com/videos/hu7ni-mncb1-wouldyourather-b-02.jpg');
    });
});

describe('getCompleteVideoKey — concatenated recap key', () => {
    it('is {recorder}-{inviter}-{course}-{lesson}-complete, repeated when self-initiated', () => {
        expect(getCompleteVideoKey({ shareCode: 'ab12', courseId: 'model', lessonId: 'w' }))
            .toBe('videos/ab12-ab12-model-w-complete.mp4');
    });

    it('covers both friend lessons a and b', () => {
        expect(getCompleteVideoKey({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' }))
            .toBe('videos/ab12-ab12-friend-a-complete.mp4');
        expect(getCompleteVideoKey({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b' }))
            .toBe('videos/ab12-ab12-friend-b-complete.mp4');
    });

    it('never contains "concatenated" and stays in the recorder namespace', () => {
        const key = getCompleteVideoKey({ shareCode: 'ab12', courseId: 'model', lessonId: 'w' });
        expect(key.toLowerCase()).not.toContain('concatenated');
        expect(key.startsWith('videos/ab12-')).toBe(true);
        expect(key.endsWith('.mp4')).toBe(true);
    });

    it('returns null when any part is missing', () => {
        expect(getCompleteVideoKey({ shareCode: null, courseId: 'model', lessonId: 'w' })).toBeNull();
        expect(getCompleteVideoKey({ shareCode: 'ab12', courseId: null, lessonId: 'w' })).toBeNull();
        expect(getCompleteVideoKey({ shareCode: 'ab12', courseId: 'model', lessonId: null })).toBeNull();
        expect(getCompleteVideoKey({})).toBeNull();
        expect(getCompleteVideoKey()).toBeNull();
    });

    it('embeds a pair code recorder-first for two-user recaps', () => {
        expect(getCompleteVideoKey({ shareCode: 'q9uki', pairShareCode: 'gs5i8', courseId: 'wouldyourather', lessonId: 'b' }))
            .toBe('videos/q9uki-gs5i8-wouldyourather-b-complete.mp4');
    });

    it('keeps the recorder namespace and repeats the code when blank', () => {
        expect(getCompleteVideoKey({ shareCode: 'ab12', pairShareCode: '  ', courseId: 'model', lessonId: 'w' }))
            .toBe('videos/ab12-ab12-model-w-complete.mp4');
    });

    it('cannot collide with a segment key or its poster key', () => {
        const complete = getCompleteVideoKey({ shareCode: 'ab12', courseId: 'model', lessonId: 'w' });
        const segment = 'videos/ab12-ab12-model-w-01.mp4';
        expect(complete).not.toBe(segment);
        expect(complete).not.toBe(getUgcThumbKey(segment));
    });
});
