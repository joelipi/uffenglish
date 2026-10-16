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
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// Set before anything can call the writer. Injection is not enough on its own —
// a test that stripped `put` from one call fell through the default and really
// did overwrite a production object, so defaultPut refuses outright here.
process.env.UFF_NO_R2_WRITES = '1';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    DEFAULT_MAX_AGE_SECONDS,
    MODEL_FILES,
    MODEL_ID,
    R2_BUCKET,
    cacheControlFor,
    etagHex,
    buildPutArgs,
    defaultPut,
    modelObjectUrl,
    parseArgs,
    run,
    stampOne,
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
const VERIFIER = readFileSync(
    path.join(ROOT, 'scripts/verify-whisper-model.sh'),
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

afterAll(() => {
    delete process.env.UFF_NO_R2_WRITES;
});

describe('model identity', () => {
    it('uses the same model id the worker boots', () => {
        // Raw source, and scoped to the function that calls pipeline(): a stale
        // duplicate of the id in a comment or another branch would not qualify.
        const region = tryBootPipelineRegion(WORKER);
        expect(region).toContain(MODEL_ID);
        // Assert the anchor EXISTS first: indexOf returns -1 when missing, and
        // -1 is less than any positive index, so ordering alone would pass
        // vacuously if the pipeline() call were renamed or dropped.
        const call = region.indexOf('await pipeline(');
        expect(call, 'the pipeline() call anchors the assertion').toBeGreaterThan(-1);
        expect(call).toBeLessThan(region.indexOf(MODEL_ID));
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
describe('stampOne (network mocked, put injected)', () => {
    const BODY = 'model-bytes';
    const BODY_ETAG = `"${createHash('md5').update(BODY).digest('hex')}"`;
    const WANTED = cacheControlFor(DEFAULT_MAX_AGE_SECONDS);
    let workDir;
    let warnings;
    let put;
    const realFetch = global.fetch;

    /**
     * Serve `before` for the first HEAD, `after` (default: the wanted header
     * applied, i.e. what a successful write reads back) for the second, and
     * BODY for the GET. `after` differing is what lets the multipart test prove
     * the post-write ETag is not compared.
     */
    function serve(before, after = { 'cache-control': WANTED }) {
        let heads = 0;
        const body = Buffer.from(BODY);
        global.fetch = vi.fn(async (_url, init) => {
            const headers = init?.method === 'HEAD'
                ? (heads++ === 0 ? before : { ...before, ...after })
                : before;
            return {
                ok: true,
                status: 200,
                headers: new Headers(headers),
                arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
            };
        });
    }

    beforeEach(() => {
        workDir = mkdtempSync(path.join(tmpdir(), 'stamp-test-'));
        warnings = [];
        put = vi.fn();
    });
    afterEach(() => {
        global.fetch = realFetch;
        rmSync(workDir, { recursive: true, force: true });
    });

    const baseHeaders = () => ({
        etag: BODY_ETAG,
        'content-length': String(BODY.length),
    });

    const stamp = (file, extra = {}) => stampOne(file, {
        maxAge: DEFAULT_MAX_AGE_SECONDS, workDir, put, warn: (m) => warnings.push(m), ...extra,
    });

    it('skips an already-correct object without downloading it', async () => {
        serve({ ...baseHeaders(), 'cache-control': WANTED });
        const result = await stamp('config.json');
        expect(result.action).toBe('already-set');
        expect(global.fetch).toHaveBeenCalledTimes(1); // HEAD only, no GET
        expect(put).not.toHaveBeenCalled();
    });

    it('defaults to a dry run — a caller that omits dryRun must not write', async () => {
        serve(baseHeaders());
        const result = await stampOne('config.json', {
            maxAge: DEFAULT_MAX_AGE_SECONDS, workDir, put, warn: () => {},
        });
        expect(result.action).toBe('would-set');
        expect(put).not.toHaveBeenCalled();
    });

    it('writes the one {bucket}/{key} with the wanted Cache-Control', async () => {
        serve(baseHeaders());
        const result = await stamp('config.json', { dryRun: false });
        expect(result.action).toBe('set');
        const [key, local, meta] = put.mock.calls[0];
        expect(key).toBe(`whisper/${MODEL_ID}/config.json`);
        expect(local.startsWith(workDir)).toBe(true);
        expect(meta.cacheControl).toBe(WANTED);
    });

    it('passes an existing Content-Type back and does not invent one otherwise', async () => {
        serve({ ...baseHeaders(), 'content-type': 'application/octet-stream' });
        await stamp('config.json', { dryRun: false });
        expect(put.mock.calls[0][2].contentType).toBe('application/octet-stream');

        put.mockReset();
        serve(baseHeaders());
        await stamp('config.json', { dryRun: false });
        expect(put.mock.calls[0][2].contentType).toBeNull();
    });

    it('refuses to write when the bytes disagree with the ETag', async () => {
        serve({ ...baseHeaders(), etag: '"0000000000000000000000000000ffff"' });
        await expect(stamp('config.json', { dryRun: false })).rejects.toThrow(/does not match its ETag/);
        expect(put).not.toHaveBeenCalled();
    });

    it('refuses to write when the length disagrees', async () => {
        serve({ etag: BODY_ETAG, 'content-length': String(BODY.length + 10) });
        await expect(stamp('config.json', { dryRun: false })).rejects.toThrow(/refusing to write/);
        expect(put).not.toHaveBeenCalled();
    });

    it('warns instead of claiming verification when the ETag has no MD5', async () => {
        // A multipart ETag is legitimately changed by a single-part re-upload, so
        // it must neither gate the write nor fail after it.
        serve(
            { etag: '"00000000000000000000000000000000-3"', 'content-length': String(BODY.length) },
            { etag: '"11111111111111111111111111111111"', 'cache-control': WANTED }
        );
        const result = await stamp('config.json', { dryRun: false });
        expect(result.action).toBe('set');
        expect(result.etagUnchanged).toBe(false);
        expect(warnings.join('\n')).toMatch(/carries no MD5/);
        expect(put).toHaveBeenCalled();
    });

    it('fails when a single-part ETag changed, i.e. the content moved', async () => {
        serve(baseHeaders(), { etag: '"22222222222222222222222222222222"', 'cache-control': WANTED });
        await expect(stamp('config.json', { dryRun: false })).rejects.toThrow(/content was not preserved/);
    });

    it('names the object when the upload fails', async () => {
        serve(baseHeaders());
        put.mockImplementation(() => {
            throw new Error('wrangler put failed — bucket not found');
        });
        await expect(stamp('onnx/decoder_model_merged_quantized.onnx', { dryRun: false }))
            .rejects.toThrow(/decoder_model_merged_quantized\.onnx: wrangler put failed.*bucket not found/);
    });

    it('fails when a Content-Type does not read back', async () => {
        // wrangler replaces all httpMetadata, so a dropped Content-Type is a
        // silent metadata loss; the read-back is what catches it.
        serve(
            { ...baseHeaders(), 'content-type': 'application/octet-stream' },
            { 'content-type': 'binary/octet-stream', 'cache-control': WANTED }
        );
        await expect(stamp('config.json', { dryRun: false }))
            .rejects.toThrow(/Content-Type reads back as binary\/octet-stream/);
    });

    it('fails when Cache-Control does not read back', async () => {
        serve(baseHeaders(), { 'cache-control': 'public, max-age=60' });
        await expect(stamp('config.json', { dryRun: false })).rejects.toThrow(/Cache-Control reads back/);
    });
});

describe('run', () => {
    const RUN_BODY = 'run-model-bytes';
    const RUN_WANTED = cacheControlFor(DEFAULT_MAX_AGE_SECONDS);

    it('drives the whole loop through an injected put, never the real bucket', async () => {
        // The regression this protects: a loop that reached defaultPut here
        // really executed wrangler against production R2.
        const realFetch = global.fetch;
        const put = vi.fn();
        const body = Buffer.from(RUN_BODY);
        const digest = `"${createHash('md5').update(RUN_BODY).digest('hex')}"`;
        const fresh = { etag: digest, 'content-length': String(body.length) };
        let heads = 0;
        global.fetch = vi.fn(async (_url, init) => ({
            ok: true,
            status: 200,
            // First HEAD per object is the uncached "before"; the second reflects
            // the write. run() interleaves them, so count per-URL instead.
            headers: new Headers(init?.method === 'HEAD' && heads++ % 2 === 0
                ? fresh
                : { ...fresh, 'cache-control': RUN_WANTED }),
            arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        }));
        const workDir = mkdtempSync(path.join(tmpdir(), 'run-test-'));
        try {
            const results = await run({
                maxAge: DEFAULT_MAX_AGE_SECONDS,
                dryRun: false,
                files: ['config.json', 'onnx/decoder_model_merged_quantized.onnx'],
                put,
                log: () => {},
                warn: () => {},
            });
            expect(results.map((r) => r.action)).toEqual(['set', 'set']);
            expect(put).toHaveBeenCalledTimes(2);
        } finally {
            global.fetch = realFetch;
            rmSync(workDir, { recursive: true, force: true });
        }
    });

    it('passes the injected put down to every stampOne call', () => {
        // If run() stopped threading `put`, stampOne would fall back to
        // defaultPut and hit the real bucket even though the caller supplied one.
        const at = SCRIPT.indexOf('export async function run(');
        expect(SCRIPT.slice(at, SCRIPT.indexOf('} = {}', at))).toContain('put = defaultPut');
        expect(SCRIPT).toMatch(/stampOne\(file, \{[^}]*\bput\b[^}]*\}\)/);
    });
});

describe('buildPutArgs', () => {
    const KEY = `whisper/${MODEL_ID}/onnx/encoder_model_quantized.onnx`;

    it('is one {bucket}/{key} positional plus --file and --cache-control', () => {
        expect(buildPutArgs(KEY, '/tmp/x.onnx', {
            cacheControl: 'public, max-age=31536000', contentType: null,
        })).toEqual([
            'r2', 'object', 'put',
            // 'uff' is spelled out on purpose: asserting `${R2_BUCKET}` here
            // would only compare the module to itself.
            `uff/${KEY}`,
            '--file', '/tmp/x.onnx',
            '--cache-control', 'public, max-age=31536000',
        ]);
    });

    it('passes an existing Content-Type back rather than dropping it', () => {
        const args = buildPutArgs(KEY, '/tmp/x.onnx', {
            cacheControl: 'public, max-age=1', contentType: 'application/octet-stream',
        });
        expect(args).toContain('--content-type');
        expect(args[args.indexOf('--content-type') + 1]).toBe('application/octet-stream');
    });

    it('invents no Content-Type when the object has none', () => {
        const args = buildPutArgs(KEY, '/tmp/x.onnx', {
            cacheControl: 'public, max-age=1', contentType: null,
        });
        expect(args).not.toContain('--content-type');
    });
});

describe('defaultPut', () => {
    /** Source slice of one exported arrow function, header comment excluded. */
    function bodyOf(decl) {
        const at = SCRIPT.indexOf(decl);
        expect(at, `${decl} must exist`).toBeGreaterThan(-1);
        const brace = SCRIPT.indexOf('{', at);
        return SCRIPT.slice(brace, SCRIPT.indexOf('\n};', brace));
    }

    it('is the writer stampOne falls back to', () => {
        // Without this default a caller that omits `put` would have no writer at
        // all, and every injection test would still pass.
        const at = SCRIPT.indexOf('export async function stampOne');
        expect(SCRIPT.slice(at, SCRIPT.indexOf(') {', at))).toContain('put = defaultPut');
        expect(defaultPut).toBeTypeOf('function');
    });

    it('is the only caller of execFileSync, and goes through buildPutArgs', () => {
        const body = bodyOf('export const defaultPut = (key, local, meta)');
        expect(body).toContain('execFileSync');
        expect(body).toContain('buildPutArgs');
    });

    it('refuses outright while UFF_NO_R2_WRITES is set', () => {
        // The backstop behind the injection: even a fall-through to the default
        // writer raises instead of touching R2.
        expect(process.env.UFF_NO_R2_WRITES).toBe('1');
        expect(() => defaultPut('whisper/x/config.json', '/tmp/x', {
            cacheControl: 'public, max-age=1', contentType: null,
        })).toThrow(/refusing to write/);
    });

    it('blocks on any set value, including an empty string', () => {
        // There is deliberately no "off" value, so a stray `UFF_NO_R2_WRITES=`
        // cannot be mistaken for a disabled stop. A truthiness check would let
        // the empty string through and re-open the hole.
        const saved = process.env.UFF_NO_R2_WRITES;
        try {
            process.env.UFF_NO_R2_WRITES = '';
            expect(() => defaultPut('whisper/x/config.json', '/tmp/x', {
                cacheControl: 'public, max-age=1', contentType: null,
            })).toThrow(/refusing to write/);
        } finally {
            if (saved === undefined) delete process.env.UFF_NO_R2_WRITES;
            else process.env.UFF_NO_R2_WRITES = saved;
        }
    });

    it('keeps wrangler\'s stderr, which is the actionable part', () => {
        // main() prints only e.message, so a bare "Command failed" here would
        // hide why the upload failed.
        const body = bodyOf('export const defaultPut = (key, local, meta)');
        expect(body).toContain('e.stderr');
        expect(body).toMatch(/wrangler put failed/);
    });
});


describe('verify-whisper-model.sh', () => {
    /** The `file|bytes|etag` rows of the verifier's table. */
    function tableRows() {
        return VERIFIER.split('\n')
            // The first row carries the `FILES='` opener and the last a closing
            // quote; strip both or two objects would silently go unchecked.
            .map((l) => l.trim().replace(/^FILES='/, '').replace(/'$/, ''))
            .filter((l) => /^[\w./-]+\|\d+\|[0-9a-f]{32}$/.test(l))
            .map((l) => l.split('|'));
    }

    it('covers exactly the files the stamper writes', () => {
        // Without this the verifier could keep checking seven objects while the
        // stamper handles an eighth — precisely the "checked some, not all"
        // failure it exists to prevent, and it would be silent.
        expect(tableRows().map((r) => r[0])).toEqual(MODEL_FILES);
    });

    it('does not keep a second copy of the model origin', () => {
        // The stamper single-sources the host through whisper-model-origin.js;
        // the shell script must ask it rather than repeat the literal, or a moved
        // CDN would leave the verifier checking a path nothing serves.
        expect(VERIFIER).toContain('m.MODEL_BASE');
        expect(VERIFIER).not.toContain('https://r2.ultrafastfluency.com');
    });

    it('records a size and an MD5 ETag for every row', () => {
        for (const [file, bytes, etag] of tableRows()) {
            expect(Number(bytes), `${file} size`).toBeGreaterThan(0);
            expect(etag, `${file} etag`).toMatch(/^[0-9a-f]{32}$/);
        }
        expect(tableRows().length).toBeGreaterThan(1);
    });

    it('fails loudly rather than reporting a bad object as healthy', () => {
        // curl -fsI so a 404/5xx cannot be read as "empty headers, therefore
        // mismatched" without saying the request itself failed.
        expect(VERIFIER).toContain('curl -fsI');
        expect(VERIFIER).toMatch(/request failed/);
        // And it must not exit 0 on problems.
        expect(VERIFIER).toMatch(/exit \$fail/);
    });

    it('ends with a newline', () => {
        expect(VERIFIER.endsWith('\n')).toBe(true);
    });
});
