import { describe, it, expect } from 'vitest';
import { getVideoUrl } from './video-url.js';

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