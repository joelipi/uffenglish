// @web-only
// Shared video URL resolution — used by all modules that construct R2 video URLs.
// In dev (Vite proxy), uses a relative path to avoid CORS on localhost.
// In production, uses the full R2 URL.
// Always checks window.preloadedMedia first for cache-hit bypass.

const FIREBASE_BASE = 'https://r2.ultrafastfluency.com/assets/videos/';

export function getVideoUrl(slug) {
    if (typeof window !== 'undefined' && window.preloadedMedia?.[slug]) {
        return window.preloadedMedia[slug];
    }
    if (import.meta.env.DEV) {
        return `/assets/videos/${slug}.mp4`;
    }
    return `${FIREBASE_BASE}${slug}.mp4`;
}
