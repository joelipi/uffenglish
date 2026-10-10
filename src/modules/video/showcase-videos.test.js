import { describe, it, expect } from 'vitest';
import { SHOWCASE_VIDEO_SLUGS, buildShowcaseVideos } from './showcase-videos.js';
import { getVideoUrl, getPosterUrl } from './video-url.js';

describe('SHOWCASE_VIDEO_SLUGS', () => {
    it('is a non-empty array of non-empty strings', () => {
        expect(Array.isArray(SHOWCASE_VIDEO_SLUGS)).toBe(true);
        expect(SHOWCASE_VIDEO_SLUGS.length).toBeGreaterThan(0);
        for (const slug of SHOWCASE_VIDEO_SLUGS) {
            expect(typeof slug).toBe('string');
            expect(slug.trim().length).toBeGreaterThan(0);
        }
    });

    it('pins the three permanent wouldyourather recaps', () => {
        expect(SHOWCASE_VIDEO_SLUGS).toEqual([
            'exrwr-wouldyourather-b-complete',
            'pwspi-wouldyourather-b-complete',
            'exycy-wouldyourather-b-complete',
        ]);
    });

    it('never lists a temporary UGC (-response-NN) slug', () => {
        for (const slug of SHOWCASE_VIDEO_SLUGS) {
            expect(slug).not.toMatch(/-response-\d+$/);
        }
    });
});

describe('buildShowcaseVideos', () => {
    it('maps each slug to its video + poster URLs', () => {
        expect(buildShowcaseVideos(['a', 'b'])).toEqual([
            { slug: 'a', videoUrl: getVideoUrl('a'), posterUrl: getPosterUrl('a') },
            { slug: 'b', videoUrl: getVideoUrl('b'), posterUrl: getPosterUrl('b') },
        ]);
    });

    it('defaults to SHOWCASE_VIDEO_SLUGS', () => {
        expect(buildShowcaseVideos().map((v) => v.slug)).toEqual(SHOWCASE_VIDEO_SLUGS);
    });

    it('returns [] for an empty, non-array or string input', () => {
        expect(buildShowcaseVideos([])).toEqual([]);
        expect(buildShowcaseVideos(null)).toEqual([]);
        expect(buildShowcaseVideos('a')).toEqual([]);
    });

    it('drops blank and non-string entries without throwing', () => {
        expect(buildShowcaseVideos(['a', '', null, 42, 'b']).map((v) => v.slug)).toEqual(['a', 'b']);
        expect(buildShowcaseVideos([null, 42])).toEqual([]);
    });
});
