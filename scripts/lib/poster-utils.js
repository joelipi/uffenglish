// scripts/lib/poster-utils.js
// Poster-generation utilities for the uniform R2-only poster pipeline
// (stories/011-auto-intro-poster). Mirrors scripts/lib/caption-utils.js: all
// process/network work (ffmpeg, R2 HEAD) lives in the CLI
// (scripts/generate-thumbnails.mjs, scripts/verify-thumbnails.mjs), so the
// planning logic here is unit-testable with fakes. `loadConfigs` is the one I/O
// helper shared by both CLIs so the "read every src/config/*.json" contract and
// its parse-error policy cannot drift between them.
//
// One rule: a poster is a still of its video, so its name is the video's slug
// with `.mp4` → `.jpg` (sibling on R2 under assets/videos/ for teacher intros,
// videos/ for UGC). Nothing is committed to the repo and nothing is served
// locally.

import { promises as fs } from 'node:fs';
import path from 'node:path';

// Avoid the black frame at t=0 (UGC thumbs also sample 0.2s, speech.web.js).
export const FRAME_AT_SECONDS = 0.2;
// 1.78x the 360 CSS px display width (app.css `.intro-video-container`).
export const POSTER_WIDTH = 640;
// ffmpeg -q:v (was 4); ~31% smaller at SSIM 0.993 vs a -q:v 2 reference.
export const POSTER_QUALITY = 8;
// 32 KiB guard against regressions — a WARN only, never a build failure.
export const POSTER_MAX_BYTES = 32768;
export const LQIP_WIDTH = 32;

// Warn (never fail) when a generated JPEG blows the byte budget. Network and
// encoder variance must not fail the pipeline.
export function exceedsPosterBudget(bytes) {
    return bytes > POSTER_MAX_BYTES;
}

// Parse a Last-Modified value (Date | string | number) to epoch ms, or null
// when it is missing/unparseable. Null is the "unknown" signal: the caller
// must then fall back to the safe default (treat the poster as current).
function toTimestamp(value) {
    if (value === null || value === undefined) return null;
    const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/**
 * Whether an existing poster must be regenerated because its source video is
 * newer. The freshness rule is deliberately conservative: a missing or invalid
 * timestamp on either side means "not stale" (never churn a poster we cannot
 * prove is behind), and equality is not staleness — only a strictly newer
 * video triggers a rebuild. Absence of the poster itself is handled by
 * `planPosterRun` via `posterExists`, not here.
 *
 * @param {{ videoLastModified?: Date|string|number, posterLastModified?: Date|string|number }} [timestamps]
 * @returns {boolean}
 */
export function isPosterStale({ videoLastModified, posterLastModified } = {}) {
    const video = toTimestamp(videoLastModified);
    const poster = toTimestamp(posterLastModified);
    if (video === null || poster === null) return false;
    return video > poster;
}

/**
 * Read and parse every `<dir>/*.json` course config, sorted by filename. Shared
 * by the generator and the verifier so both see the same config set.
 *
 * Parse errors are ALWAYS fatal: a malformed config would otherwise silently
 * shrink the target set (the generator would rewrite the LQIP module without
 * that course's entries and still exit 0). The optional `onParseError` hook
 * lets a caller report the failing file before the throw; it does not make the
 * error recoverable.
 *
 * @param {string} dir directory containing course configs
 * @param {{ onParseError?: (file: string, error: Error) => void }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function loadConfigs(dir, { onParseError } = {}) {
    const files = (await fs.readdir(dir))
        .filter((f) => f.endsWith('.json'))
        .sort();
    const configs = [];
    const errors = [];
    for (const file of files) {
        try {
            configs.push(JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')));
        } catch (e) {
            if (onParseError) onParseError(file, e);
            errors.push(`${file}: ${e.message}`);
        }
    }
    if (errors.length) {
        throw new Error(`could not parse config file(s): ${errors.join('; ')}`);
    }
    return configs;
}

/**
 * Every first-step intro slug across all course configs, deduped in
 * first-seen order. A lesson contributes iff its first step carries a truthy
 * `introBackgroundVideoUrl`; a lesson with no `steps` or an intro only on a
 * later step contributes nothing. Slugs containing the `{friendCode}` template
 * placeholder are skipped: they are resolved per-user at runtime
 * (config-normalizer.js) and are not literal R2 filenames.
 *
 * @param {Array<object>} configs parsed course configs
 * @returns {Array<{slug: string}>}
 */
export function introTargets(configs) {
    const seen = new Set();
    const targets = [];
    for (const config of configs || []) {
        for (const lesson of config?.lessons || []) {
            const slug = lesson?.steps?.[0]?.introBackgroundVideoUrl;
            // Runtime-resolved `{friendCode}` templates are not literal R2
            // filenames (config-normalizer substitutes the share code at
            // runtime), so they can never be generated or verified as teacher
            // posters. Same rule as findNewSimpleVideoTargets in
            // scripts/lib/caption-utils.js.
            if (!slug || slug.includes('{friendCode}') || seen.has(slug)) continue;
            seen.add(slug);
            targets.push({ slug });
        }
    }
    return targets;
}

// <slug>.jpg — the sibling name shared by teacher and UGC posters.
export function posterFilename(slug) {
    return `${slug}.jpg`;
}

// Remote objects key for R2 uploads.
export function posterR2Key(slug) {
    return `assets/videos/${slug}.jpg`;
}

// Download path for the built-in ffmpeg frame grab.
export function posterSourceUrl(slug) {
    return `https://r2.ultrafastfluency.com/assets/videos/${slug}.mp4`;
}

/**
 * Pure run planner. The CLI injects `posterExists(slug)` (an R2 HEAD) so this
 * stays testable without network access. `posterExists` may be synchronous or
 * asynchronous (the real R2 HEAD is async), so the planner always awaits it.
 *
 * - `targets`: intro slugs whose poster does not yet exist, or whose existing
 *   poster is stale (its source video is newer), in discovery order.
 * - `rebuild`: true when the LQIP module is absent (`moduleText == null`), when
 *   any intro slug is missing from it, or when there is work to do.
 *
 * `posterStale` is optional (defaults to never stale) and awaited like
 * `posterExists`; it is only consulted for slugs whose poster exists, so the
 * common "poster absent" path issues no extra freshness checks and behaviour
 * is byte-identical when the predicate is omitted.
 *
 * @param {object} opts
 * @param {Array<object>} opts.configs parsed course configs
 * @param {(slug: string) => boolean | Promise<boolean>} opts.posterExists
 * @param {(slug: string) => boolean | Promise<boolean>} [opts.posterStale]
 * @param {string|null} opts.moduleText committed poster-lqips.js text (null = absent)
 * @returns {Promise<{targets: Array<{slug: string}>, rebuild: boolean}>}
 */
export async function planPosterRun({ configs, posterExists, posterStale = () => false, moduleText }) {
    const all = introTargets(configs);
    const exists = await Promise.all(all.map((t) => posterExists(t.slug)));
    const stale = await Promise.all(all.map((t, i) => (exists[i] ? posterStale(t.slug) : false)));
    const targets = all.filter((_, i) => !exists[i] || stale[i]);
    const moduleMissing =
        moduleText == null ||
        all.some(
            (t) =>
                !moduleText.includes(`"${t.slug}"`) &&
                !moduleText.includes(`'${t.slug}'`),
        );
    return { targets, rebuild: moduleMissing || targets.length > 0 };
}

/**
 * Byte format of src/generated/poster-lqips.js, keyed by slug. Returns valid JS
 * that exports POSTER_LQIPS and getPosterLqip(slug).
 *
 * @param {Record<string, string>} lqipsBySlug slug -> data:image/jpeg;base64,...
 * @returns {string}
 */
export function formatLqipModule(lqipsBySlug) {
    const entries = Object.entries(lqipsBySlug || {})
        .map(([slug, dataUri]) => `    ${JSON.stringify(slug)}: ${JSON.stringify(dataUri)},`)
        .join('\n');
    return `// Auto-generated by scripts/generate-thumbnails.mjs — do not hand-edit.
export const POSTER_LQIPS = {
${entries}
};

export function getPosterLqip(slug) {
    return POSTER_LQIPS[slug] || null;
}
`;
}
