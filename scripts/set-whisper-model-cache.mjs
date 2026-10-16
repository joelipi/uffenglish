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
// object is fetched and written back byte-identical. For a single-part upload
// the ETag is the MD5, so a correct round-trip must leave it unchanged — that is
// the safety check, and the script fails loudly if it is not. A multipart or
// absent ETag carries no usable MD5: the length is still checked, but the round
// trip cannot be verified by digest and the script warns rather than implying
// it verified something. wrangler replaces all httpMetadata, so any existing
// Content-Type is passed back explicitly and read back afterwards.
//
// A failure part-way leaves the earlier objects stamped; re-running is safe,
// because objects already carrying the wanted header are skipped without
// re-downloading.
//
// TESTS MUST PASS A `put`
// The writer is injected (`put = defaultPut`) on both stampOne and run, and any
// test must supply its own. Vitest's `vi.mock('node:child_process')` does NOT
// reach this module — see docs/learnings.md — so a test that looked fully mocked
// while mock-fetch returned 11 bytes really did run wrangler and overwrite two
// production objects. Injecting `put` is what actually isolates it.
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
 * The wrangler argv for one upload, as a pure function so it can be asserted on
 * without running wrangler.
 *
 * wrangler takes the destination as ONE `{bucket}/{key}` positional and replaces
 * all httpMetadata, so a Content-Type has to be passed back explicitly or it is
 * silently dropped — but these objects may have none, in which case passing an
 * empty one would invent a type.
 */
export const buildPutArgs = (key, local, { cacheControl, contentType }) => {
    const args = [
        'r2', 'object', 'put',
        `${R2_BUCKET}/${key}`,
        '--file', local, '--cache-control', cacheControl,
    ];
    if (contentType) args.push('--content-type', contentType);
    return args;
};

/**
 * Upload `local` over `key` with the given httpMetadata. This is the only
 * function that writes anything, and it is injectable so `stampOne` can be
 * exercised without mocking node:child_process (which does not reach into this
 * module) or touching R2.
 *
 * `UFF_NO_R2_WRITES` is a hard stop, checked at call time, because injection
 * alone has already proved insufficient: a test that stripped `put` from one
 * call fell through the default and really did overwrite a production object.
 * The test suite sets it, so no path out of this module can reach the bucket.
 */
export const defaultPut = (key, local, meta) => {
    if (process.env.UFF_NO_R2_WRITES) {
        throw new Error(`refusing to write ${key}: UFF_NO_R2_WRITES is set`);
    }
    try {
        execFileSync('npx', ['wrangler', ...buildPutArgs(key, local, meta)], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (e) {
        // Keep the detail: main() only prints e.message, and wrangler's stderr
        // (e.g. "bucket not found") is the actionable part.
        throw new Error(`wrangler put failed — ${e.stderr || e.message}`.trim());
    }
};

/**
 * Stamp one object. `dryRun` defaults to true, so a direct caller that forgets
 * it reports instead of writing.
 *
 * Throws rather than writing if the fetched bytes do not match what R2 reports.
 * When the ETag carries no usable MD5 (a multipart upload, or none at all) the
 * round trip cannot be verified by digest; that is reported as `verified: null`
 * rather than passed off as a successful check.
 */
export async function stampOne(
    file,
    { maxAge, dryRun = true, workDir, warn = console.warn, put = defaultPut }
) {
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
    if (!expected) {
        warn(
            `  WARN ${file}: ETag ${before.etag ?? '(none)'} carries no MD5, so the round trip ` +
            'can only be checked by length'
        );
    }

    // These objects currently carry no Content-Type; pass nothing back in that
    // case, and report one appearing after the write.
    const contentType = before['content-type'] ?? null;

    if (dryRun) {
        return {
            file,
            action: 'would-set',
            bytes: bytes.length,
            from: before['cache-control'] ?? '(none)',
            to: cacheControl,
        };
    }

    // Same bytes, same key — only the metadata changes.
    const local = join(workDir, file);
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, bytes);

    try {
        put(`whisper/${MODEL_ID}/${file}`, local, { cacheControl, contentType });
    } catch (e) {
        // Name the object: one of seven uploads failing is otherwise unattributable.
        throw new Error(`${file}: ${e.message}`);
    }

    const after = await head(url);
    // Only a single-part ETag is stable across a round trip: re-uploading a
    // multipart object as one part legitimately changes it, so comparing those
    // would throw after a perfectly good write.
    if (expected && after.etag !== before.etag) {
        throw new Error(`${file}: ETag changed (${before.etag} -> ${after.etag}) — content was not preserved`);
    }
    if (after['cache-control'] !== cacheControl) {
        throw new Error(`${file}: Cache-Control reads back as ${after['cache-control'] ?? '(none)'}`);
    }
    if (contentType && after['content-type'] !== contentType) {
        throw new Error(
            `${file}: Content-Type reads back as ${after['content-type'] ?? '(none)'}, was ${contentType}`
        );
    }
    if (!contentType && after['content-type']) {
        warn(`  WARN ${file}: gained an unexpected Content-Type: ${after['content-type']}`);
    }
    return { file, action: 'set', bytes: bytes.length, to: cacheControl, etagUnchanged: Boolean(expected) };
}

export async function run({
    maxAge = DEFAULT_MAX_AGE_SECONDS,
    dryRun = true,
    files = MODEL_FILES,
    log = console.log,
    warn = console.warn,
    // Threaded through so a caller (and any test) can exercise the whole loop
    // without reaching the real bucket via defaultPut.
    put = defaultPut,
} = {}) {
    const workDir = mkdtempSync(join(tmpdir(), 'whisper-cache-'));
    const results = [];
    try {
        log(`${dryRun ? 'DRY RUN' : 'APPLY'} — ${MODEL_ID} (${files.length} files, max-age=${maxAge})`);
        for (const file of files) {
            const result = await stampOne(file, { maxAge, dryRun, workDir, warn, put });
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
