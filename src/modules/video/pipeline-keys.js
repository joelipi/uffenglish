// src/modules/video/pipeline-keys.js
// Single source of truth for the cloud lesson-video pipeline's key/name rules
// (stories/040-modal-lesson-video-pipeline). Imported by every new Pages
// Function and mirrored by docs/video-pipeline/pipeline_lib.py so the JS
// trigger/storage layer and the Python Modal runner cannot drift.
//
// Slugs are the bare CSV `filename` / `join` values (no extension), restricted
// to [A-Za-z0-9_-] with a leading alphanumeric and <=100 chars. This rejects
// `..`, `/`, leading dots and `.mp4` suffixes. Raw takes deliberately live
// under `raw/` — never `videos/` or `assets/videos/`, which carry the 48h R2
// lifecycle (wrangler.toml). Published media keeps the app's existing
// `assets/videos/<slug>.mp4` convention (video-url.js).

export const PIPELINE_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
export const PIPELINE_JOB_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export function isValidPipelineSlug(name) {
    return typeof name === 'string' && PIPELINE_SLUG_PATTERN.test(name);
}

// A job id is a UUID (or any 8-64 char [A-Za-z0-9-]) — never a path.
export function isValidPipelineJobId(jobId) {
    return typeof jobId === 'string' && PIPELINE_JOB_ID_PATTERN.test(jobId);
}

// Transient phone take: raw/<slug>.mp4 (outside the 48h videos/ lifecycle).
export function rawTakeKey(slug) {
    return isValidPipelineSlug(slug) ? `raw/${slug}.mp4` : null;
}

// Stage-level status marker written by the Modal orchestrator, polled by the
// recorder. Invalid/missing ids must not be turned into a path.
export function statusKey(jobId) {
    return isValidPipelineJobId(jobId) ? `raw/status/${jobId}.json` : null;
}

export function publishedVideoKey(slug) {
    return isValidPipelineSlug(slug) ? `assets/videos/${slug}.mp4` : null;
}

export function publishedPosterKey(slug) {
    return isValidPipelineSlug(slug) ? `assets/videos/${slug}.jpg` : null;
}

// Operator-uploaded pipeline inputs (fonts/backgrounds/audio/overlays/CSV).
// Windows separators are normalized so the same helper works on the operator PC
// and in the container.
export function pipelineAssetKey(relPath) {
    const normalized = String(relPath ?? '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    return `pipeline-assets/${normalized}`;
}
