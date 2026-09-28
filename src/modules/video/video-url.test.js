import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getVideoUrl, getPosterUrl, getUgcThumbUrl, getUgcThumbKey, getCompleteVideoKey } from './video-url.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(__dirname, 'video-url.js'), 'utf8');

describe('getVideoUrl UGC routing (friend-concat)', () => {
    it('routes teacher slugs to assets/videos/ (dev = relative, proxied)', () => {
        // In vitest/dev, import.meta.env.DEV is true → teacher videos use the
        // Vite proxy relative path (same-origin, avoids CORS locally). In prod
        // they resolve to the full R2 assets/videos/ URL.
        expect(getVideoUrl('testvideo02')).toBe('/assets/videos/testvideo02.mp4');
    });

    it('routes friend UGC slugs (-response-NN) to videos/ (48h TTL namespace)', () => {
        // Slug after {friendCode} substitution: {shareCode}-model-w-response-01
        expect(getVideoUrl('abc123-model-w-response-01')).toBe('https://r2.ultrafastfluency.com/videos/abc123-model-w-response-01.mp4');
        expect(getVideoUrl('zzz9-model-w-response-02')).toBe('https://r2.ultrafastfluency.com/videos/zzz9-model-w-response-02.mp4');
    });

    it('does not misroute teacher slugs that end in -response but are not UGC', () => {
        // Guard against false positives — teacher slugs never use -response-NN suffix.
        expect(getVideoUrl('response')).toBe('/assets/videos/response.mp4');
    });
});

describe('getPosterUrl — uniform <video>.jpg rule (R2-only)', () => {
    it('teacher slug -> assets/videos/<slug>.jpg (dev relative, proxied)', () => {
        expect(getPosterUrl('do_you_have_rolls_too')).toMatch(/assets\/videos\/do_you_have_rolls_too\.jpg$/);
    });

    it('UGC slug -> videos/<slug>.jpg on R2', () => {
        expect(getPosterUrl('ab12-model-w-response-01'))
            .toBe('https://r2.ultrafastfluency.com/videos/ab12-model-w-response-01.jpg');
    });

    it('returns null for an empty or missing slug', () => {
        expect(getPosterUrl('')).toBeNull();
        expect(getPosterUrl(undefined)).toBeNull();
        expect(getPosterUrl(null)).toBeNull();
    });

    it('no longer exports/uses POSTER_BASE or an assets/posters path', () => {
        expect(SOURCE).not.toMatch(/POSTER_BASE/);
        expect(SOURCE).not.toMatch(/assets\/posters/);
    });
});

describe('UGC thumb helpers (sibling .jpg)', () => {
    it('getUgcThumbKey maps an mp4 key to its jpg sibling', () => {
        expect(getUgcThumbKey('videos/ab12-model-w-response-01.mp4')).toBe('videos/ab12-model-w-response-01.jpg');
        expect(getUgcThumbKey(undefined)).toBeNull();
    });

    it('getUgcThumbUrl maps an mp4 URL to its jpg sibling', () => {
        expect(getUgcThumbUrl('https://r2.ultrafastfluency.com/videos/ab12-model-w-response-01.mp4'))
            .toBe('https://r2.ultrafastfluency.com/videos/ab12-model-w-response-01.jpg');
    });
});

describe('getCompleteVideoKey — concatenated recap key', () => {
    it('builds the shareCode-courseId-lessonId-complete key', () => {
        expect(getCompleteVideoKey({ shareCode: 'ab12', courseId: 'model', lessonId: 'w' }))
            .toBe('videos/ab12-model-w-complete.mp4');
    });

    it('covers both friend lessons a and b', () => {
        expect(getCompleteVideoKey({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' }))
            .toBe('videos/ab12-friend-a-complete.mp4');
        expect(getCompleteVideoKey({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b' }))
            .toBe('videos/ab12-friend-b-complete.mp4');
    });

    it('never contains "concatenated" and stays in the shareCode namespace', () => {
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

    it('cannot collide with a segment key or its poster key', () => {
        const complete = getCompleteVideoKey({ shareCode: 'ab12', courseId: 'model', lessonId: 'w' });
        const segment = 'videos/ab12-model-w-response-01.mp4';
        expect(complete).not.toBe(segment);
        expect(complete).not.toBe(getUgcThumbKey(segment));
    });
});
