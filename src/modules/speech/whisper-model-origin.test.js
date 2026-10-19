import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WHISPER_MODEL_BASE_URL, WHISPER_MODEL_ORIGIN, WHISPER_MODEL_PATH } from './whisper-model-origin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const read = (...segments) => readFileSync(path.join(ROOT, ...segments), 'utf8');

const INDEX_HTML = read('index.html');
// Transformers.js engine (default, non-PWA).
const DEMO_WORKER = read('src', 'workers', 'whisper', 'whisper-worker-demo.js');
// sherpa-onnx engine (PWA mode). Constructed without `{ type: 'module' }`, so it
// is a CLASSIC worker and cannot `import` the origin module — these assertions
// are what keep its literal in step.
const PWA_WORKER = read('src', 'workers', 'whisper', 'whisper-worker-web.js');
// The module that arms the preload at module scope — the reason the head hint
// matters.
const SPEECH = read('src', 'modules', 'speech', 'speech.js');

describe('whisper model origin', () => {
    it('is the R2 host both engines fetch models from', () => {
        expect(WHISPER_MODEL_ORIGIN).toBe('https://r2.ultrafastfluency.com');
        expect(WHISPER_MODEL_BASE_URL).toBe(`${WHISPER_MODEL_ORIGIN}/${WHISPER_MODEL_PATH}`);
    });

    it('index.html preconnects that origin with crossorigin', () => {
        // The model files are fetched with CORS, so the warm-up connection has
        // to be opened in CORS mode or the handshake is not reused.
        expect(INDEX_HTML).toContain(
            `<link rel="preconnect" href="${WHISPER_MODEL_ORIGIN}" crossorigin>`
        );
    });

    it('the preconnect is in <head>, ahead of the app boot chain', () => {
        const hint = INDEX_HTML.indexOf(`<link rel="preconnect" href="${WHISPER_MODEL_ORIGIN}"`);
        const headEnd = INDEX_HTML.indexOf('</head>');
        const entryScript = INDEX_HTML.indexOf('<script type="module"');
        expect(hint).toBeGreaterThan(-1);
        expect(hint).toBeLessThan(headEnd);
        // Before the module script, which is what eventually evaluates speech.js.
        expect(hint).toBeLessThan(entryScript);
    });

    it('has exactly one preconnect for the model origin', () => {
        const hints = INDEX_HTML.match(/<link rel="preconnect"[^>]*>/g) ?? [];
        const modelHints = hints.filter((tag) => tag.includes(WHISPER_MODEL_ORIGIN));
        expect(modelHints).toHaveLength(1);
    });

    it('the Transformers.js worker points env.remoteHost at that origin', () => {
        expect(DEMO_WORKER).toMatch(
            new RegExp(`env\\.remoteHost\\s*=\\s*'${WHISPER_MODEL_ORIGIN}'`)
        );
        // `whisper/{model}/` — the path without its trailing slash, then the
        // template. Built from the constant rather than string-chopped so a path
        // that gains a directory cannot silently break the expectation.
        const template = `${WHISPER_MODEL_PATH}\\{model\\}/`;
        expect(DEMO_WORKER).toMatch(
            new RegExp(`env\\.remotePathTemplate\\s*=\\s*'${template}'`)
        );
    });

    it('the Transformers.js worker hardcodes no other model host', () => {
        // The pre-cached model URL is built by string interpolation, so it is
        // matched directly rather than through env.
        const hosts = [
            ...DEMO_WORKER.matchAll(/https?:\/\/[a-z0-9.-]+/gi),
        ].map((m) => m[0]);
        expect(hosts.length).toBeGreaterThan(0);
        for (const host of hosts) expect(host).toBe(WHISPER_MODEL_ORIGIN);
    });

    it('the sherpa-onnx worker uses that base URL', () => {
        expect(PWA_WORKER).toContain(
            `const WHISPER_BASE_PATH = '${WHISPER_MODEL_BASE_URL}'`
        );
    });

    it('speech.js arms the engine preload at module scope', () => {
        // The preload must not sit behind a click or a route change: the head
        // hint only buys anything if the fetch starts during boot.
        //
        // Module-scope statements in this file are unindented, while the call
        // inside `rebindWorker`/the worker-recreate path is indented — so
        // anchoring at column 0 distinguishes the two. A `^\s*` pattern would
        // match the indented one as well and pass even with the module-scope
        // call deleted.
        const moduleScopeCalls = [...SPEECH.matchAll(/^whisperAdapter\.preloadWhisperEngine\(\);/gm)];
        expect(moduleScopeCalls).toHaveLength(1);

        // Guard the premise that there really is an indented (in-function) call,
        // so the column-0 anchor stays meaningful if this file is restructured.
        expect(SPEECH).toMatch(/\n\s+whisperAdapter\.preloadWhisperEngine\(\);/);
    });
});

describe('the demo worker does not re-download the model itself', () => {
    // It used to pre-fetch the two ONNX graphs into its own Cache API bucket.
    // Transformers.js opens `transformers-cache`, so nothing ever read that
    // bucket: every cold load pulled ~41 MB twice, sequentially, and buffered
    // 29 MB of decoder in JS heap on the way. Phone bandwidth and heap for
    // nothing. pipeline() now does the one fetch-and-cache pass itself.

    // Comments stripped so the explanatory comment naming the removed
    // identifiers cannot satisfy a "must not contain" assertion. Stripping
    // comments is safe here because these are bare-identifier checks; the
    // line-comment pattern requires the `//` NOT to follow a colon, so the
    // `//` in `https://r2.ultrafastfluency.com` survives.
    const code = DEMO_WORKER
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    it('lets Transformers.js own the cache', () => {
        expect(code).toMatch(/env\.useBrowserCache\s*=\s*true/);
    });

    it('opens no Cache API bucket of its own', () => {
        // `caches.open(<anything>)` here would mean a bucket nothing reads.
        expect([...code.matchAll(/caches\.open\(/g)]).toEqual([]);
        // Nor may it hard-code the library's bucket name and write into it
        // under a key scheme of its own.
        expect(code).not.toContain('transformers-cache');
    });

    it('does not fetch the ONNX graphs by hand', () => {
        for (const file of ['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx']) {
            expect(code).not.toContain(file);
        }
    });

    it('does not buffer a whole model file into JS memory', () => {
        // `response.arrayBuffer()` on a ~29 MB response is the heap spike that
        // went away with the duplicate pre-cache.
        expect(code).not.toContain('arrayBuffer');
    });

    it('still boots the pipeline from the model origin', () => {
        expect(code).toContain('automatic-speech-recognition');
        expect(code).toContain('onnx-community/whisper-tiny.en');
    });
});
