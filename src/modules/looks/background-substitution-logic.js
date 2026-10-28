// Pure rules for the operator studio's live background/foreground substitution
// (stories/100). NO React, NO DOM, NO browser globals — the browser adapter
// (background-substitution.webonly.js) and the static studio page both import the
// decisions here, and every rule is unit-tested.
//
// The composite is always the same 1080×1920 9:16 frame, so the look painters
// in recording-looks-logic.js (whose anchors, close-up oval and slot zones are
// fractions of that shape) compose on top unchanged.

import { emptySelection, sanitizeSelection } from './recording-looks-logic.js';

/**
 * The capture profile.
 *
 * The operator studio is the one capture path that does NOT hold Whisper or an
 * AudioWorklet in memory (the learner app drops phones to 720×1280 @ 24 for
 * exactly that reason), so it records at the social master's own size: Stage 3
 * burns its HTML overlay text at `base_video_clip.size`, so a 1080p take is what
 * keeps the burned cards crisp and the master eligible for full-HD feeds.
 *
 * `maskWidth`/`maskHeight` are the segmentation input, NOT the output: the
 * model runs on a 256×256 copy of the cropped frame so the per-frame mask is
 * 65,536 values instead of 2,073,600 (an 8 MB GPU→CPU readback per frame is
 * what puts the picture behind the live microphone).
 */
export function resolveSubstitutionDimensions() {
    return { width: 1080, height: 1920, fps: 30, maskWidth: 256, maskHeight: 256 };
}

/** How much of each new mask survives the temporal blend. */
export const DEFAULT_MASK_BLEND_WEIGHT = 0.85;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Temporal stabilisation for the segmentation mask.
 *
 * A per-frame predictor "boils" on hair and shoulders even when the subject is
 * still. Blending a little of the previous mask in removes the shimmer; the
 * weight stays high (0.85) so a nod or a gesture is not trailed by a ghost of
 * the old silhouette at 30 fps.
 *
 * @param {{ next?: Float32Array|number[], previous?: Uint8Array|null, weight?: number }} input
 * @returns {Uint8Array} one byte of alpha per pixel
 */
export function blendMaskAlpha({ next, previous = null, weight = DEFAULT_MASK_BLEND_WEIGHT } = {}) {
    const source = next || [];
    const count = source.length;
    const out = new Uint8Array(count);
    if (count === 0) return out;
    const w = Number.isFinite(weight) ? clamp01(weight) : DEFAULT_MASK_BLEND_WEIGHT;
    const havePrevious = !!previous && previous.length === count;
    for (let i = 0; i < count; i++) {
        const fresh = clamp01(Number(source[i]) || 0) * 255;
        const blended = havePrevious
            ? fresh * w + (Number(previous[i]) || 0) * (1 - w)
            : fresh;
        out[i] = Math.max(0, Math.min(255, Math.round(blended)));
    }
    return out;
}

/**
 * Light-wrap spill suppression at the matte rim.
 *
 * A hard matte against a bright room leaves a white halo around hair and
 * shoulders. Mixing a little of the replacement background into the
 * semi-transparent rim pixels hides the seam; the correction must not touch
 * solid person or solid background, so it peaks at half alpha and falls to zero
 * at both ends.
 *
 * @param {number} alpha 0..1
 * @param {number} [spillStrength]
 * @returns {number} 0…spillStrength
 */
export function resolveEdgeSpillMix(alpha, spillStrength = 0.15) {
    const a = clamp01(Number(alpha));
    const strength = Number.isFinite(spillStrength) ? clamp01(spillStrength) : 0.15;
    if (!(a > 0.15) || !(a < 0.85)) return 0;
    const rim = 1 - Math.abs(a - 0.5) / 0.35;
    return clamp01(rim) * strength;
}

const NONE_VALUES = new Set(['', 'none', 'skip']);
const LOCAL_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp)$/i;

/**
 * Whether a remote image may be fetched by the operator studio.
 *
 * Only public `https:` hosts: the studio runs against a personal R2 bucket and
 * whichever host the operator pastes, and the proxy Function that retries a
 * CORS-blocked image fetches server-side, so loopback/link-local/private
 * targets must never be reachable through it (SSRF).
 *
 * @param {string} urlString
 * @returns {boolean}
 */
export function isAllowedRemoteImageUrl(urlString) {
    if (typeof urlString !== 'string') return false;
    let url;
    try {
        url = new URL(urlString);
    } catch (e) {
        return false;
    }
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return false;
    if (host === 'localhost' || host.endsWith('.localhost')) return false;
    if (host.endsWith('.local') || host.endsWith('.internal')) return false;
    // IPv6 literals: loopback, unique-local and link-local only. A public IPv6
    // address is allowed.
    if (host.includes(':')) {
        if (host === '::1' || host === '::') return false;
        if (/^f[cd]/.test(host)) return false;
        if (/^fe80/.test(host)) return false;
        return true;
    }
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!v4) return true;
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (v4.slice(1).some((part) => Number(part) > 255)) return false;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
}

/**
 * Resolve a sheet cell to a layer source.
 *
 * Accepts a public `https:` image URL or a bare file name; everything else is
 * `null` so a bad cell can never half-apply. A bare name resolves inside the
 * layer's own directory, because the sheet value is authored by hand and must
 * never be treated as a path.
 */
function resolveLayerSource(value, directory) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (NONE_VALUES.has(trimmed.toLowerCase())) return null;
    if (/^https:/i.test(trimmed)) {
        return isAllowedRemoteImageUrl(trimmed) ? trimmed : null;
    }
    // Any other scheme (http:, data:, javascript:, file:) and any path-shaped
    // value is refused: a local layer is a NAME inside the bundled directory.
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return null;
    if (!LOCAL_FILE_PATTERN.test(trimmed)) return null;
    const file = IMAGE_EXTENSION_PATTERN.test(trimmed) ? trimmed : `${trimmed}.png`;
    return `${directory}/${file}`;
}

/** Behind the subject. */
export function resolveBackgroundSource(value) {
    return resolveLayerSource(value, '/overlays/backgrounds');
}

/** In front of the subject (a desk, a frame, a foreground prop). */
export function resolveForegroundSource(value) {
    return resolveLayerSource(value, '/overlays/foregrounds');
}

/**
 * What state a layer is in for the current row.
 *
 * `'empty'` and `'ready'` are the two states a take may start in. `'error'` is
 * the one that must block the take: the pipeline skips BiRefNet for any row that
 * names a background, so recording without it would silently ship the room.
 *
 * @param {{ sheetValue?: string, resolver?: (v: string) => string|null, imageLoaded?: boolean, imageError?: boolean }} input
 * @returns {'none'|'loading'|'ready'|'error'}
 */
export function resolveAssetLayerState({ sheetValue = '', resolver = resolveBackgroundSource, imageLoaded = false, imageError = false } = {}) {
    const raw = typeof sheetValue === 'string' ? sheetValue.trim() : '';
    if (NONE_VALUES.has(raw.toLowerCase())) return 'none';
    const resolved = typeof resolver === 'function' ? resolver(raw) : null;
    if (!resolved) return 'error';
    if (imageError) return 'error';
    return imageLoaded ? 'ready' : 'loading';
}

/**
 * Whether the take may start. A layer that is still loading is as blocking as a
 * failed one: starting anyway would record the first frames without it.
 */
export function shouldStartTake({ backgroundState = 'none', foregroundState = 'none' } = {}) {
    const ok = (state) => state === 'none' || state === 'ready';
    return ok(backgroundState) && ok(foregroundState);
}

/**
 * Which pane the expand toggle targets: the live view while recording, the
 * recorded take once it exists (the take is the encoded blob, so it is the only
 * place a soft matte edge is judgeable at full size).
 */
export function resolveExpandablePane({ isReviewing = false } = {}) {
    return isReviewing ? 'playback' : 'preview';
}

/**
 * A look selection carrying ONLY the four prop slots, so `paintLooks` paints no
 * colour grade, no lens effect and no screen overlay — the studio ships the
 * overlay rail without the filter/category pickers.
 */
export function overlaySelectionFor({ face = null, upper = null, lower = null, emoji = null } = {}) {
    const base = emptySelection();
    return sanitizeSelection({
        ...base,
        slots: { ...base.slots, face, upper, lower, emoji },
    });
}
