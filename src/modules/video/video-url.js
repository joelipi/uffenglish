// Shared video URL resolution — used by all modules that construct R2 video URLs.
// In dev (Vite proxy), uses a relative path to avoid CORS on localhost.
// In production, uses the full R2 URL.
import { isUgcSlug } from './video-source.js';

const CDN_BASE = 'https://r2.ultrafastfluency.com/assets/videos/';
// UGC clips live under /videos/ (48h TTL): a friend's recorded clip and the
// concatenated end-of-lesson recap. Teacher/system media lives under
// /assets/videos/ and never expires.
const UGC_BASE = 'https://r2.ultrafastfluency.com/videos/';

// The permanent namespace, resolved without any UGC classification. Used by
// curated permanent assets (the homepage showcase) whose slugs are copies that
// live in assets/videos/ by definition.
export function getPermanentVideoUrl(slug) {
    if (!slug) return '';
    if (import.meta.env.DEV) return `/assets/videos/${slug}.mp4`;
    return `${CDN_BASE}${slug}.mp4`;
}

/**
 * Resolve a config slug to its R2 URL.
 *
 * @param {string} slug a step slug from a config (after {friendCode} resolution)
 * @param {string[]} [codes] share codes in play; defaults to the registry
 *   maintained by video-source.js. Never inferred from the slug's shape.
 */
export function getVideoUrl(slug, codes) {
    if (!slug) return '';
    // A UGC clip starts with a share code in play — resolve it to the /videos/
    // namespace (always a full URL; the Vite proxy only covers /assets/videos/,
    // and these only exist cross-origin on R2 anyway).
    if (isUgcSlug(slug, codes)) {
        return `${UGC_BASE}${slug}.mp4`;
    }
    return getPermanentVideoUrl(slug);
}

// Uniform poster rule: a poster is a still of its video, so it is the video URL
// with .mp4 -> .jpg. Teacher intros resolve to /assets/videos/<slug>.jpg (dev
// relative, proxied to R2; prod absolute), UGC to /videos/<key>.jpg. Posters are
// never served locally.
export function getPosterUrl(slug, codes) {
    if (!slug) return null;
    return getUgcThumbUrl(getVideoUrl(slug, codes));
}

// Poster for a curated permanent asset (never classified as UGC).
export function getPermanentPosterUrl(slug) {
    if (!slug) return null;
    return getUgcThumbUrl(getPermanentVideoUrl(slug));
}

export function getUgcThumbUrl(r2VideoUrl) {
    if (!r2VideoUrl || typeof r2VideoUrl !== 'string') return null;
    return r2VideoUrl.replace(/\.mp4(\?.*)?$/i, '.jpg$1');
}

export function getUgcThumbKey(r2Key) {
    if (!r2Key || typeof r2Key !== 'string') return null;
    return r2Key.replace(/\.mp4$/i, '.jpg');
}

/**
 * Key for the concatenated end-of-lesson recap. Same `videos/` namespace as the
 * per-segment clips, so it inherits the 48h lifecycle. Returns null when any
 * part is missing so callers can skip cleanly.
 *
 * `{recorder}-{inviter}` identity, matching buildUgcSegmentKey: the two share
 * codes are embedded recorder-first. Recorder-first is mandatory, not cosmetic
 * — the upload Function only accepts keys starting with `videos/<caller>-`.
 * A self-initiated (or self-linked) recap repeats the same code rather than
 * dropping the segment, so UGC detection stays uniform.
 */
export function getCompleteVideoKey({ shareCode, courseId, lessonId, pairShareCode } = {}) {
    if (!shareCode || !courseId || !lessonId) return null;
    // Case is preserved (matching buildUgcSegmentKey): the upload Function
    // checks the key against the raw x-share-code header case-sensitively, and
    // share codes are lowercase-only by convention.
    const recorder = String(shareCode).trim();
    const inviter = String(pairShareCode || '').trim() || recorder;
    return `videos/${recorder}-${inviter}-${courseId}-${lessonId}-complete.mp4`;
}
