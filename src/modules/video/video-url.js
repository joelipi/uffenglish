// Shared video URL resolution — used by all modules that construct R2 video URLs.
// In dev (Vite proxy), uses a relative path to avoid CORS on localhost.
// In production, uses the full R2 URL.
import { isFriendVideoSlug } from './video-source.js';

const R2_BASE = 'https://r2.ultrafastfluency.com/';
const CDN_BASE = `${R2_BASE}assets/videos/`;
// UGC friend recordings live under /videos/ (48h TTL, see exportSegmentsToR2 key
// "videos/{shareCode}-{courseId}-{lessonId}-response-0N.mp4"). Teacher/system
// media lives under /assets/videos/.
const UGC_BASE = `${R2_BASE}videos/`;

// Full public URL for a `videos/` R2 key. `videos/` is never proxied in dev,
// so this is always absolute.
export function getUgcVideoUrl(r2Key) {
    if (!r2Key || typeof r2Key !== 'string') return null;
    return `${R2_BASE}${r2Key}`;
}

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

// Key for the concatenated end-of-lesson recap. Same `videos/` namespace as the
// per-segment clips, so it inherits the 48h lifecycle. Never contains
// "concatenated"; the suffix is `complete`. A co-authored answer recap embeds
// the other participant's share code after the creator's, so two B sessions
// with two friends never collide while the key still starts `videos/<creator>-`
// (the Cloudflare Function's namespace check). Returns null when any required
// part is missing so callers can skip cleanly.
export function getCompleteVideoKey({ shareCode, courseId, lessonId, otherShareCode } = {}) {
    if (!shareCode || !courseId || !lessonId) return null;
    const other = (typeof otherShareCode === 'string' && otherShareCode) ? `${otherShareCode}-` : '';
    return `videos/${shareCode}-${other}${courseId}-${lessonId}-complete.mp4`;
}

// Full public URL for a concatenated-recap key. `-complete` keys do not match
// isFriendVideoSlug (`-response-NN`), so they never go through getVideoUrl.
export function getCompleteVideoUrl({ shareCode, courseId, lessonId, otherShareCode } = {}) {
    return getUgcVideoUrl(getCompleteVideoKey({ shareCode, courseId, lessonId, otherShareCode }));
}

// Sibling .jpg of a recap's first segment: `<code>-<courseId>-<lessonId>-response-01`.
// Used for the embedded recap's poster (see resolveRecapFirstClip).
export function getSegmentPosterUrl({ shareCode, courseId, lessonId } = {}) {
    if (!shareCode || !courseId || !lessonId) return null;
    return getPosterUrl(`${shareCode}-${courseId}-${lessonId}-response-01`);
}
