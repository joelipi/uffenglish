// scripts/lib/video-optimize-utils.js
// Pure planning utilities for the manual R2 lesson-video optimizer
// (stories/032-optimize-r2-videos). Mirrors scripts/lib/poster-utils.js: all
// process/network work (ffmpeg, ffprobe, R2 download/upload) lives in the CLI
// (scripts/optimize-videos.mjs), so every decision here is unit-testable with
// fakes.
//
// One rule: a lesson video should be small and faststart so the browser paints
// the first frame without reading the whole file. "Faststart" means the `moov`
// atom precedes `mdat` in the top-level MP4 box order.

export const MAX_VIDEO_WIDTH = 720; // long-edge cap for lesson clips
export const MAX_TOTAL_BITRATE_BPS = 1_500_000; // ~1.5 Mbps muxed budget
export const X264_CRF = 26;
export const X264_PRESET = 'medium';
export const VIDEO_MAXRATE = '1.5M';
export const VIDEO_BUFSIZE = '3M';
export const AUDIO_BITRATE = '96k';
// A mdat-first file is decidable from the head alone, so a bounded read is
// always enough to classify faststart.
export const FASTSTART_HEAD_BYTES = 2 * 1024 * 1024;
export const DEFAULT_CDN_BASE = 'https://r2.ultrafastfluency.com/assets/videos/';

/**
 * Every distinct lesson-video slug referenced by any course config, in
 * first-seen order. For each lesson step, the loader precedence
 * `interactiveVideoUrl || simpleVideoUrl || introBackgroundVideoUrl` picks the
 * one slug. Falsy slugs and runtime-resolved `{friendCode}` templates are
 * skipped (same rule as poster-utils.introTargets / caption-utils).
 *
 * `questions`-shaped step lists are deliberately ignored: they are vestigial in
 * gt2.json and are not normalized to `steps` by the app.
 *
 * @param {Array<object>} configs parsed course configs
 * @returns {Array<{slug: string}>}
 */
export function collectVideoTargets(configs) {
    const seen = new Set();
    const targets = [];
    for (const config of configs || []) {
        for (const lesson of config?.lessons || []) {
            for (const step of lesson?.steps || []) {
                const slug =
                    step?.interactiveVideoUrl ||
                    step?.simpleVideoUrl ||
                    step?.introBackgroundVideoUrl;
                if (!slug || slug.includes('{friendCode}') || seen.has(slug)) continue;
                seen.add(slug);
                targets.push({ slug });
            }
        }
    }
    return targets;
}

/**
 * Parse the top-level MP4 boxes from a (possibly partial) head buffer.
 * Handles the 4-byte size + 4-byte type header, the 64-bit `size === 1`
 * largesize form, and the `size === 0` "runs to EOF" form (which stops the
 * scan). A size below the header length or a non-printable type stops the scan.
 *
 * @param {Buffer} buffer
 * @returns {Array<{type: string, size: number, offset: number}>}
 */
export function scanTopLevelBoxes(buffer) {
    const boxes = [];
    if (!buffer || buffer.length < 8) return boxes;
    let offset = 0;
    while (offset + 8 <= buffer.length) {
        let size = buffer.readUInt32BE(offset);
        const type = buffer.toString('latin1', offset + 4, offset + 8);
        if (!/^[\x20-\x7e]{4}$/.test(type)) break;
        let headerSize = 8;
        if (size === 1) {
            if (offset + 16 > buffer.length) break;
            size = Number(buffer.readBigUInt64BE(offset + 8));
            headerSize = 16;
        } else if (size === 0) {
            boxes.push({ type, size: buffer.length - offset, offset });
            break;
        }
        if (size < headerSize) break;
        boxes.push({ type, size, offset });
        offset += size;
    }
    return boxes;
}

/**
 * Whether a video's top-level boxes put `moov` before `mdat`.
 *
 * @param {Buffer} buffer head of the mp4 (>= the first few boxes)
 * @returns {boolean|null} true / false, or null when neither box is present in
 *   the buffer (inconclusive — the caller treats null as "needs remux").
 */
export function isFaststart(buffer) {
    for (const box of scanTopLevelBoxes(buffer)) {
        if (box.type === 'moov') return true;
        if (box.type === 'mdat') return false;
    }
    return null;
}

/**
 * Decide the action per probe. Rules:
 *   - width over `maxWidth` OR total bitrate over `maxTotalBitrateBps`
 *     → `reencode` (never on unknown data — unknown is not "over").
 *   - otherwise, `faststart !== true` (including null/inconclusive)
 *     → `remux` (lossless copy + faststart).
 *   - otherwise → `skip`.
 *   - `force` upgrades `skip` to `remux`; it never downgrades `reencode`.
 *
 * @param {object} opts
 * @param {Array<{slug: string, faststart?: boolean|null, width?: number|null, totalBitrateBps?: number|null}>} opts.probes
 * @param {boolean} [opts.force]
 * @param {number} [opts.maxWidth]
 * @param {number} [opts.maxTotalBitrateBps]
 * @returns {Array<{slug: string, action: 'skip'|'remux'|'reencode'}>}
 */
export function planVideoOptimize({
    probes,
    force = false,
    maxWidth = MAX_VIDEO_WIDTH,
    maxTotalBitrateBps = MAX_TOTAL_BITRATE_BPS,
} = {}) {
    return (probes || []).map((probe) => {
        const slug = probe?.slug;
        const width = typeof probe?.width === 'number' ? probe.width : null;
        const bitrate =
            typeof probe?.totalBitrateBps === 'number' ? probe.totalBitrateBps : null;
        const overWidth = width !== null && width > maxWidth;
        const overBitrate = bitrate !== null && bitrate > maxTotalBitrateBps;

        if (overWidth || overBitrate) return { slug, action: 'reencode' };
        if (probe?.faststart !== true) return { slug, action: 'remux' };
        if (force) return { slug, action: 'remux' };
        return { slug, action: 'skip' };
    });
}

// Lossless remux: move the existing streams under a front-loaded moov.
export function remuxArgs({ src, out }) {
    return ['-y', '-loglevel', 'error', '-i', src, '-c', 'copy', '-movflags', '+faststart', out];
}

// Downscale (never upscale: `min(iw, maxWidth)`) and re-encode under budget.
// The comma inside min() is escaped because `-vf` uses commas to separate
// filtergraph steps.
export function reencodeArgs({ src, out, maxWidth = MAX_VIDEO_WIDTH }) {
    return [
        '-y', '-loglevel', 'error', '-i', src,
        '-vf', `scale=min(iw\\,${maxWidth}):-2`,
        '-c:v', 'libx264', '-preset', X264_PRESET, '-crf', String(X264_CRF),
        '-maxrate', VIDEO_MAXRATE, '-bufsize', VIDEO_BUFSIZE,
        '-c:a', 'aac', '-b:a', AUDIO_BITRATE,
        '-movflags', '+faststart', out,
    ];
}

export function videoFilename(slug) {
    return `${slug}.mp4`;
}

export function videoR2Key(slug) {
    return `assets/videos/${slug}.mp4`;
}

export function videoSourceUrl(slug, base = DEFAULT_CDN_BASE) {
    return `${base}${slug}.mp4`;
}
