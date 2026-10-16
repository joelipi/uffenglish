// scripts/set-whisper-model-cache.test.js
//
// Guards for the Whisper model Cache-Control stamper.
//
// This script re-uploads 43 MB of production model data to change one metadata
// header, so the things worth pinning are (a) it targets exactly the files the
// app downloads, and (b) it cannot write unless explicitly told to. Both are
// cheap to break silently: a model id that drifts from the worker's would stamp
// the wrong keys, and an `apply` that defaulted to true would rewrite objects
// on every run.
//
// Importing the module is itself part of the contract — see the "import must not
// write" test below, which relies on the `invokedDirectly` guard.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_MAX_AGE_SECONDS,
    MODEL_FILES,
    MODEL_ID,
    R2_BUCKET,
    cacheControlFor,
    etagHex,
    modelObjectUrl,
    parseArgs,
} from './set-whisper-model-cache.mjs';
import {
    WHISPER_MODEL_BASE_URL,
    WHISPER_MODEL_ORIGIN,
} from '../src/modules/speech/whisper-model-origin.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = readFileSync(
    path.join(ROOT, 'src/workers/whisper/whisper-worker-demo.js'),
    'utf8'
);
const SCRIPT = readFileSync(
    path.join(ROOT, 'scripts/set-whisper-model-cache.mjs'),
    'utf8'
);

/** The slice of the worker that actually builds the pipeline, so a matching id
 *  elsewhere in the file cannot satisfy the assertion below. */
function tryBootPipelineRegion(source) {
    const start = source.indexOf('async function tryBootPipeline');
    expect(start, 'tryBootPipeline not found').toBeGreaterThan(-1);
    const end = source.indexOf('\n}\n', start);
    expect(end, 'end of tryBootPipeline not found').toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('model identity', () => {
    it('uses the same model id the worker boots', () => {
        // Raw source, and scoped to the function that calls pipeline(): a stale
        // duplicate of the id in a comment or another branch would not qualify.
        const region = tryBootPipelineRegion(WORKER);
        expect(region).toContain(MODEL_ID);
        expect(region.indexOf('await pipeline(')).toBeLessThan(region.indexOf(MODEL_ID));
    });

    it('builds object URLs from the shared model origin module', () => {
        // Guards against the script hard-coding a second copy of the host.
        expect(modelObjectUrl('config.json')).toBe(
            `${WHISPER_MODEL_BASE_URL}${MODEL_ID}/config.json`
        );
        expect(modelObjectUrl('config.json')).toContain(WHISPER_MODEL_ORIGIN);
        // WHISPER_MODEL_PATH ends in a slash — a double slash here would 404.
        expect(modelObjectUrl('config.json')).not.toContain('//whisper');
    });

    it('keys uploads as {bucket}/whisper/{model}/{file}', () => {
        const key = `${R2_BUCKET}/whisper/${MODEL_ID}/onnx/encoder_model_quantized.onnx`;
        expect(key.startsWith(`${R2_BUCKET}/`)).toBe(true);
        expect(key.split('/').filter(Boolean)).toEqual([
            R2_BUCKET, 'whisper', 'onnx-community', 'whisper-tiny.en',
            'onnx', 'encoder_model_quantized.onnx',
        ]);
    });
});

describe('file list', () => {
    it('covers every file Transformers.js fetches for this model', () => {
        // Golden list: adding or renaming a file forces a deliberate update here.
        expect(MODEL_FILES).toEqual([
            'config.json',
            'generation_config.json',
            'preprocessor_config.json',
            'tokenizer.json',
            'tokenizer_config.json',
            'onnx/encoder_model_quantized.onnx',
            'onnx/decoder_model_merged_quantized.onnx',
        ]);
    });

    it('includes both quantized graphs — the ~40 MB that dominate the fetch', () => {
        const graphs = MODEL_FILES.filter((f) => f.endsWith('.onnx'));
        expect(graphs).toEqual([
            'onnx/encoder_model_quantized.onnx',
            'onnx/decoder_model_merged_quantized.onnx',
        ]);
    });
});

describe('cache-control value', () => {
    it('defaults to one year, since the model is pinned and never re-uploaded', () => {
        expect(DEFAULT_MAX_AGE_SECONDS).toBe(31536000);
        expect(cacheControlFor(DEFAULT_MAX_AGE_SECONDS)).toBe('public, max-age=31536000');
    });

    it('formats a public, cacheable directive', () => {
        expect(cacheControlFor(3600)).toBe('public, max-age=3600');
        expect(cacheControlFor(3600)).toMatch(/^public, max-age=\d+$/);
    });
});

describe('etag parsing', () => {
    it('extracts the hex from a single-part ETag', () => {
        // Single-part ETags are the MD5 of the body, which is what lets the
        // script prove it preserved content across a round-trip.
        expect(etagHex('"cd069c70a26af22c862b58cf55c3b56b"')).toBe(
            'cd069c70a26af22c862b58cf55c3b56b'
        );
    });

    it('returns null for a multipart ETag, which carries no usable MD5', () => {
        // Must be null, never a truncated string: a wrong value would make the
        // script reject a perfectly good upload.
        expect(etagHex('"cd069c70a26af22c862b58cf55c3b56b-3"')).toBeNull();
    });

    it('returns null for missing or malformed input', () => {
        expect(etagHex(undefined)).toBeNull();
        expect(etagHex('')).toBeNull();
        expect(etagHex('"not-a-digest"')).toBeNull();
        expect(etagHex('"ABCDEF0123456789ABCDEF0123456789"')).toBeNull();
    });
});

describe('write safety', () => {
    it('never writes without --apply', () => {
        expect(parseArgs([]).apply).toBe(false);
        expect(parseArgs(['--max-age', '3600']).apply).toBe(false);
        expect(parseArgs(['--apply']).apply).toBe(true);
    });

    it('defaults run() to a dry run as well', () => {
        // Belt and braces: even if argv were forged, the run is still read-only.
        const runIndex = SCRIPT.indexOf('export async function run(');
        expect(runIndex).toBeGreaterThan(-1);
        const runSignature = SCRIPT.slice(runIndex, SCRIPT.indexOf('} = {}', runIndex));
        expect(runSignature).toContain('dryRun = true');
    });

    it('rejects a nonsense max-age rather than defaulting', () => {
        expect(() => parseArgs(['--apply', '--max-age', '0'])).toThrow(/max-age/);
        expect(() => parseArgs(['--apply', '--max-age', 'soon'])).toThrow(/max-age/);
    });

    it('does not write at import time', () => {
        // Every test in this file already imported the module; reaching here means
        // the invokedDirectly guard held, so no `wrangler r2 object put` ran.
        expect(SCRIPT).toContain('invokedDirectly');
        const guardIndex = SCRIPT.indexOf('invokedDirectly');
        expect(guardIndex, 'guard must wrap the main() call').toBeLessThan(
            SCRIPT.indexOf('main().catch(')
        );
    });
});