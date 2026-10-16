// scripts/set-whisper-model-cache.mjs
//
// Stamps `Cache-Control` onto the Whisper model objects in R2.
//
// WHY THIS EXISTS
// The tiny.en model is a fixed, version-pinned artifact — nothing re-uploads it
// — but the objects were pushed to R2 out of band, so they carry no
// `httpMetadata.cacheControl`. R2 therefore serves them with no `Cache-Control`
// at all (`cf-cache-status: DYNAMIC`), so the browser can only fall back to
// heuristic freshness derived from Last-Modified.
//
// `functions/api/upload-segment.js` already writes `httpMetadata.cacheControl`
// for user-uploaded clips. There is no equivalent for these, because nothing in
// the repo uploads them — that gap is what this script closes.
//
// Two things learned the hard way, both recorded in docs/learnings.md:
//   - `httpMetadata` is the only shape R2 reads; a top-level `contentType` on
//     the payload is ignored.
//   - Cache-Control is NOT a substitute for app-side caching when a <video>
//     element is involved (media-element cache reuse is unreliable, which is why
//     `prefetchRemoteClips` exists in video-processor.web.js). Transformers.js
//     loads these with a plain `fetch()`, for which the HTTP cache does work —
//     which is why this is worth doing here.
//
// HOW IT WORKS
// wrangler exposes no metadata-only edit, and this environment has no S3
// credentials for a self-`copyObject` with MetadataDirective: REPLACE. So each
// object is fetched and written back byte-identical. The ETag of a single-part
// upload is the MD5, so a correct round-trip must leave it unchanged — that is
// the safety check, and the script fails loudly if it is not.
//
// Usage:
//   node scripts/set-whisper-model-cache.mjs                    # dry run
//   node scripts/set-whisper-model-cache.mjs --apply            # write
//   node scripts/set-whisper-model-cache.mjs --apply --max-age 604800

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
// The host the app actually fetches from, rather than a second copy of the URL
// that could silently drift (scripts/generate-tutorial-placeholders.mjs imports
// from src/ the same way). whisper-model-origin.test.js guards the module itself.
import { WHISPER_MODEL_BASE_URL } from '../src/modules/speech/whisper-model-origin.js';

/** Bucket the model lives in. */
export const R2_BUCKET = 'uff';

/**
 * Model repo id — must match the pipeline() call in whisper-worker-demo.js,
 * which this cannot import (a Worker module). set-whisper-model-cache.test.js
 * ties the two together.
 */
export const MODEL_ID = 'onnx-community/whisper-tiny.en';

/**
 * Every file Transformers.js pulls for this model, not just the two ONNX
 * graphs. They ship together as one release and none will change.
 */
export const MODEL_FILES = [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
];

/** Default lifetime: the model is pinned and never re-uploaded. */
export const DEFAULT_MAX_AGE_SECONDS = 31536000; // 1 year

// WHISPER_MODEL_BASE_URL already ends in `whisper/`, so this is the exact path
// Transformers.js builds for this model.
export const modelObjectUrl = (file) => `${WHISPER_MODEL_BASE_URL}${MODEL_ID}/${file}`;

export const cacheControlFor = (maxAge) => `public, max-age=${maxAge}`;

export const md5 = (buf) => createHash('md5').update(buf).digest('hex');

/** `etag: "abc"` -> `abc`; a multipart ETag (`"abc-3"`) has no usable MD5. */
export function etagHex(etag) {
    if (!etag) return null;
    const value = etag.replace(/^"|"$/g, '');
    return /^[0-9a-f]{32}$/.test(value) ? value : null;
}

/** Current response headers for an object, lowercased keys. */
export async function head(url) {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) throw new Error(`HEAD ${url} -> ${res.status}`);
    const out = {};
    for (const [k, v] of res.headers) out[k.toLowerCase()] = v;
    return out;
}

/**
 * Stamp one object. `dryRun` reports the intended change without writing.
 * Throws rather than writing if the fetched bytes do not match what R2 reports.
 */
export async function stampOne(file, { maxAge, dryRun, workDir }) {
    const url = modelObjectUrl(file);
    const before = await head(url);
    const cacheControl = cacheControlFor(maxAge);

    if (before['cache-control'] === cacheControl) {
        return { file, action: 'already-set', bytes: Number(before['content-length'] || 0) };
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());

    if (String(bytes.length) !== String(before['content-length'])) {
        throw new Error(
            `${file}: fetched ${bytes.length} bytes but R2 reports ${before['content-length']} — refusing to write`
        );
    }
    const expected = etagHex(before.etag);
    if (expected && md5(bytes) !== expected) {
        throw new Error(`${file}: content does not match its ETag — refusing to write`);
    }

    if (dryRun) {
        return {
            file,
            action: 'would-set',
            bytes: bytes.length,
            from: before['cache-control'] ?? '(none)',
            to: cacheControl,
        };
    }

    // Same bytes, same key — only the metadata changes. wrangler takes the
    // destination as ONE `{bucket}/{key}` positional.
    const local = join(workDir, file);
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, bytes);

    execFileSync(
        'npx',
        [
            'wrangler', 'r2', 'object', 'put',
            `${R2_BUCKET}/whisper/${MODEL_ID}/${file}`,
            '--file', local, '--cache-control', cacheControl,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    const after = await head(url);
    if (after.etag !== before.etag) {
        throw new Error(`${file}: ETag changed (${before.etag} -> ${after.etag}) — content was not preserved`);
    }
    if (after['cache-control'] !== cacheControl) {
        throw new Error(`${file}: Cache-Control reads back as ${after['cache-control'] ?? '(none)'}`);
    }
    return { file, action: 'set', bytes: bytes.length, to: cacheControl, etagUnchanged: true };
}

export async function run({
    maxAge = DEFAULT_MAX_AGE_SECONDS,
    dryRun = true,
    files = MODEL_FILES,
    log = console.log,
} = {}) {
    const workDir = mkdtempSync(join(tmpdir(), 'whisper-cache-'));
    const results = [];
    try {
        log(`${dryRun ? 'DRY RUN' : 'APPLY'} — ${MODEL_ID} (${files.length} files, max-age=${maxAge})`);
        for (const file of files) {
            const result = await stampOne(file, { maxAge, dryRun, workDir });
            results.push(result);
            log(`  ${result.action.padEnd(12)} ${file}  ${(result.bytes / 1048576).toFixed(2)} MB`);
        }
        const changed = results.filter((r) => r.action !== 'already-set').length;
        log(`Done. ${changed} of ${results.length} object(s) ${dryRun ? 'would change' : 'updated'}.`);
        return results;
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

/** `--apply` is opt-in: without it the run reports and writes nothing. */
export function parseArgs(argv) {
    const maxAgeIndex = argv.findIndex((a) => a === '--max-age');
    const maxAge = maxAgeIndex >= 0 ? Number(argv[maxAgeIndex + 1]) : DEFAULT_MAX_AGE_SECONDS;
    if (!Number.isFinite(maxAge) || maxAge <= 0) {
        throw new Error('--max-age must be a positive number of seconds');
    }
    return { apply: argv.includes('--apply'), maxAge };
}

async function main() {
    const { apply, maxAge } = parseArgs(process.argv.slice(2));
    await run({ maxAge, dryRun: !apply });
    if (!apply) console.log('Re-run with --apply to write these changes.');
}

const invokedDirectly =
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((e) => {
        console.error('ERROR:', e.message);
        process.exit(1);
    });
}