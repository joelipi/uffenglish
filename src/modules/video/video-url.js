// Shared video URL resolution — used by all modules that construct R2 video URLs.
// In dev (Vite proxy), uses a relative path to avoid CORS on localhost.
// In production, uses the full R2 URL.
import { isFriendVideoSlug } from './video-source.js';

const CDN_BASE = 'https://r2.ultrafastfluency.com/assets/videos/';
// UGC friend recordings live under /videos/ (48h TTL, see exportSegmentsToR2 key
// "videos/{shareCode}-{courseId}-{lessonId}-response-0N.mp4"). Teacher/system
// media lives under /assets/videos/.
const UGC_BASE = 'https://r2.ultrafastfluency.com/videos/';

export function getVideoUrl(slug) {
    if (!slug) return '';
    // A slug ending in "-response-NN" is a friend's UGC question recording —
    // resolve it to the /videos/ namespace (always full URL; the Vite proxy only
    // covers /assets/videos/, and these only exist cross-origin on R2 anyway).
    if (isFriendVideoSlug(slug)) {
        return `${UGC_BASE}${slug}.mp4`;
    }
    if (import.meta.env.DEV) {
        return `/assets/videos/${slug}.mp4`;
    }
    return `${CDN_BASE}${slug}.mp4`;
}

// Uniform poster rule: a poster is a still of its video, so it is the video URL
// with .mp4 -> .jpg. Teacher intros resolve to /assets/videos/<slug>.jpg (dev
// relative, proxied to R2; prod absolute), UGC to /videos/<key>.jpg. Posters are
// never served locally.
export function getPosterUrl(slug) {
    if (!slug) return null;
    return getUgcThumbUrl(getVideoUrl(slug));
}

export function getUgcThumbUrl(r2VideoUrl) {
    if (!r2VideoUrl || typeof r2VideoUrl !== 'string') return null;
    return r2VideoUrl.replace(/\.mp4(\?.*)?$/i, '.jpg$1');
}

export function getUgcThumbKey(r2Key) {
    if (!r2Key || typeof r2Key !== 'string') return null;
    return r2Key.replace(/\.mp4$/i, '.jpg');
}
