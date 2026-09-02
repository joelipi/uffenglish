// Shared video URL resolution — used by all modules that construct R2 video URLs.
// In dev (Vite proxy), uses a relative path to avoid CORS on localhost.
// In production, uses the full R2 URL.

const CDN_BASE = 'https://r2.ultrafastfluency.com/assets/videos/';
const POSTER_BASE = 'https://r2.ultrafastfluency.com/assets/posters/';

export function getVideoUrl(slug) {
    if (import.meta.env.DEV) {
        return `/assets/videos/${slug}.mp4`;
    }
    return `${CDN_BASE}${slug}.mp4`;
}

export function getPosterUrl(lessonId) {
    if (!lessonId) return null;
    const base = import.meta.env.DEV ? '/assets/posters/' : POSTER_BASE;
    return `${base}${lessonId}.jpg`;
}

export function getUgcThumbUrl(r2VideoUrl) {
    if (!r2VideoUrl || typeof r2VideoUrl !== 'string') return null;
    return r2VideoUrl.replace(/\.mp4(\?.*)?$/i, '.jpg$1');
}

export function getUgcThumbKey(r2Key) {
    if (!r2Key || typeof r2Key !== 'string') return null;
    return r2Key.replace(/\.mp4$/i, '.jpg');
}
