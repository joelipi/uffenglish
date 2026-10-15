// Guard: the operator-only recording studio (public/recorder.html) is vendored
// static HTML kept deliberately unlinked from the React app so end users never
// reach it. This test proves the page is present and self-contained, that it
// declares noindex on the path Cloudflare actually serves, and that nothing on
// the end-user app surface (src/** and index.html) references it. If someone
// later wires it into the app UI, this fails on purpose — the studio is meant
// to stay reachable only by its URL.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGE_REL = 'public/recorder.html';
const PAGE_PATH = path.join(REPO_ROOT, PAGE_REL);
// Cloudflare Pages 308-redirects /recorder.html to the extensionless /recorder,
// which is the URL that actually serves the page — so both forms are "the link".
const PAGE_URL_PATH = '/recorder';
const PAGE_URL_PATH_HTML = '/recorder.html';
const HEADERS_PATH = path.join(REPO_ROOT, 'public/_headers');
const INDEX_PATH = path.join(REPO_ROOT, 'index.html');
const SELF = fileURLToPath(import.meta.url);

// Matches a link/redirect to the studio in either URL form, without matching the
// unrelated bare word "recorder" (e.g. `MediaRecorder`) or `/recorders`.
const REFERENCE_PATTERN = /\/recorder(?![\w.-])|recorder\.html/;

const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.html', '.json']);

function scanDirForPattern(root, pattern, exclude = new Set()) {
    let scanned = 0;
    const hits = [];
    const walk = (dir) => {
        // Deliberately not swallowed: an unreadable tree must fail the guard
        // rather than make "no references" pass vacuously.
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!TEXT_EXTENSIONS.has(path.extname(entry.name)) || exclude.has(full)) continue;
            scanned++;
            if (pattern.test(fs.readFileSync(full, 'utf8'))) hits.push(full);
        }
    };
    walk(root);
    return { hits, scanned };
}

function headerRule(content, selector) {
    return content
        .split(/\n\s*\n/)
        .find((block) => block.split('\n')[0].trim() === selector) || '';
}

describe('operator-only recorder page stays hidden', () => {
    it('detects both link forms but ignores a bare "Recorder" word (guard is functional)', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uff-recorder-guard-'));
        const nested = path.join(tmp, 'components');
        fs.mkdirSync(nested, { recursive: true });
        const extensionless = path.join(nested, 'nav.jsx');
        const withHtml = path.join(nested, 'footer.jsx');
        const negative = path.join(nested, 'recorder-hook.js');
        fs.writeFileSync(extensionless, '<a href="/recorder">Studio</a>');
        fs.writeFileSync(withHtml, "window.location = '/recorder.html';");
        fs.writeFileSync(negative, 'const r = new MediaRecorder(stream);');
        try {
            const { hits } = scanDirForPattern(tmp, REFERENCE_PATTERN);
            expect(hits).toContain(extensionless);
            expect(hits).toContain(withHtml);
            expect(hits).not.toContain(negative);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('ships the recorder as a fully self-contained page', () => {
        const page = fs.readFileSync(PAGE_PATH, 'utf8');
        expect(page).toContain('id="dom-btn-record"');
        expect(page).toContain('new MediaRecorder(');
        expect(page).toContain('navigator.mediaDevices.getUserMedia(');
        expect(page).not.toMatch(/<script[^>]+src=/i);
        expect(page).not.toMatch(/<link[^>]+href=/i);
    });

    it('declares noindex on the page and on the served path', () => {
        expect(fs.readFileSync(PAGE_PATH, 'utf8')).toContain(
            '<meta name="robots" content="noindex, nofollow">'
        );

        const headers = fs.readFileSync(HEADERS_PATH, 'utf8');
        expect(headerRule(headers, PAGE_URL_PATH)).toContain('X-Robots-Tag: noindex, nofollow');
        expect(headerRule(headers, PAGE_URL_PATH_HTML)).toContain('X-Robots-Tag: noindex, nofollow');
    });

    it('is not referenced anywhere on the end-user app surface', () => {
        const src = scanDirForPattern(path.join(REPO_ROOT, 'src'), REFERENCE_PATTERN, new Set([SELF]));
        expect(src.scanned).toBeGreaterThan(0);
        expect(src.hits).toEqual([]);
        expect(fs.readFileSync(INDEX_PATH, 'utf8')).not.toMatch(REFERENCE_PATTERN);
    });
});

// Story 040, Task 6: the recorder uploads takes, triggers a cloud render and
// polls its status, all through the operator-key-protected pipeline Functions.
describe('recorder page — cloud pipeline controls', () => {
    const page = () => fs.readFileSync(PAGE_PATH, 'utf8');

    it('references every pipeline endpoint and the operator-key plumbing', () => {
        const html = page();
        for (const token of [
            "'/api/pipeline/upload-raw'",
            "'/api/pipeline/render'",
            "'/api/pipeline/status'",
            "'x-operator-key'",
            'id="dom-operator-key"',
            'global_last_final_blob',
        ]) {
            expect(html, token).toContain(token);
        }
    });

    it('stores the recorded Blob, not just the object URL', () => {
        const html = page();
        expect(html).toMatch(/global_last_final_blob\s*=\s*final_video_blob/);
    });

    it('only records rows that have a filename (skips non-take rows)', () => {
        // Sheet rows that carry config/branching metadata only (e.g. a
        // `branching` step whose video is a friend's UGC clip) have no take and
        // must not enter the recorder's take list.
        const html = page();
        const start = html.indexOf('global_script_phrases = [];');
        const end = html.indexOf('global_script_phrases.sort');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const loop = html.slice(start, end);
        expect(loop).toContain('entry_object.filename');
        expect(loop).toContain('continue;');
    });

    it('uploads on Accept and only advances on success', () => {
        const html = page();
        // The upload fetch is inside the Accept handler and advanceAfterAccept is
        // called from the success path, not before the request.
        const accept = html.slice(html.indexOf('node_btn_accept.onclick'));
        expect(accept.indexOf("fetch('/api/pipeline/upload-raw'")).toBeGreaterThan(-1);
        expect(accept.indexOf('advanceAfterAccept();')).toBeGreaterThan(
            accept.indexOf("fetch('/api/pipeline/upload-raw'")
        );
        // The failure path keeps the take (`return` without advancing).
        expect(accept).toContain('take kept for retry');
    });

    it('keeps a save-to-device fallback via <a download>', () => {
        const html = page();
        expect(html).toContain('id="dom-btn-download"');
        expect(html).toMatch(/hidden_link\.download\s*=/);
    });

    it('starts a render and polls status until done/error', () => {
        const html = page();
        const render = html.slice(html.indexOf("fetch('/api/pipeline/render'"));
        expect(render).toContain("pollRenderStatus(");
        expect(render).toMatch(/status\.status === 'done' \|\| status\.status === 'error'/);
        expect(render).toContain("'/api/pipeline/status'");
    });

    it('never hardcodes a literal operator key', () => {
        // Fails if the page ships something like `operator_key: 'abc123'`.
        expect(page()).not.toMatch(/(operator[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i);
    });
});

// Story 061: takes auto-stop after 10 seconds instead of 7. The budget lives
// in one interval inside triggerStartRecording(), so the assertions slice
// exactly that block: from the `THE RECORDING DURATION TIMER` comment above it
// to the next `executeStopRecording`, which is the auto-stop call the interval
// itself makes. Slicing to EOF would let a block appended later silently join
// this guard, and a whole-file `toContain('10000')` would stay green even with
// the real budget deleted, so both are avoided deliberately.
describe('recorder page — recording duration cap', () => {
    const page = () => fs.readFileSync(PAGE_PATH, 'utf8');

    const timerBlock = () => {
        const html = page();
        // The comment is the first line of the block, so anchor there: a
        // deleted or renamed marker yields -1 and fails loudly instead of
        // silently producing an empty slice.
        const start = html.indexOf('THE RECORDING DURATION TIMER');
        const assignment = html.indexOf('global_record_duration_timer = setInterval', start);
        const end = html.indexOf('executeStopRecording', assignment);
        expect(start, 'duration timer comment').toBeGreaterThan(-1);
        expect(assignment, 'duration timer assignment').toBeGreaterThan(start);
        expect(end, 'auto-stop call').toBeGreaterThan(assignment);
        return html.slice(start, end);
    };

    it('auto-stops a take after 10 seconds', () => {
        const block = timerBlock();
        // The budget drives the countdown overlay (`remaining_ms / 1000`) and
        // the auto-stop trigger (`remaining_ms <= 0`), both left untouched.
        expect(block).toContain('THE RECORDING DURATION TIMER (10 SECONDS)');
        expect(block).toContain('var remaining_ms = 10000 - diff;');
        expect(block).toMatch(/remaining_ms <= 0/);
        expect(block).toContain('(remaining_ms / 1000).toFixed(1)');
        expect(block).toContain('Max duration (10s) reached.');
    });

    it('carries no 7-second budget inside the timer block', () => {
        const block = timerBlock();
        expect(block).not.toContain('7000');
        expect(block).not.toContain('7 SECONDS');
        expect(block).not.toContain('(7s)');
    });

    it('keeps manual stop working: STOP clears the timer and stops the recorder', () => {
        // The longer cap must not strand the operator: pressing STOP before
        // 10s still stops the take and must clear the interval so no
        // auto-stop fires afterwards.
        const html = page();
        const start = html.indexOf('function executeStopRecording()');
        const end = html.indexOf('function generateFinalVideoBuffer()');
        expect(start, 'executeStopRecording function').toBeGreaterThan(-1);
        expect(end, 'next top-level function').toBeGreaterThan(start);
        const fn = html.slice(start, end);
        expect(fn).toContain('clearInterval(global_record_duration_timer)');
        expect(fn).toContain('global_recorder_obj.stop()');
    });
});

// Story 065, Task 2: the recorder loads the committed master CSV same-origin —
// no Google Sheets fetch, no publish lag. The loader slice runs from
// `loadScriptDataFromSheets` to the next top-level handler
// (`node_btn_record.onclick`); slicing to EOF would let a block appended later
// silently join this guard.
describe('recorder page — same-origin master CSV', () => {
    const page = () => fs.readFileSync(PAGE_PATH, 'utf8');

    const loaderSlice = () => {
        const html = page();
        const start = html.indexOf('async function loadScriptDataFromSheets()');
        const end = html.indexOf('node_btn_record.onclick');
        expect(start, 'loadScriptDataFromSheets function').toBeGreaterThan(-1);
        expect(end, 'next top-level handler').toBeGreaterThan(start);
        return html.slice(start, end);
    };

    const assertLoaderContract = (slice) => {
        expect(slice).toContain("var spreadsheet_url = 'wouldyourather.master.csv'");
        expect(slice).not.toContain('docs.google.com');
        expect(slice).not.toContain('2PACX');
        expect(slice).not.toContain('gid=');
        expect(slice).not.toMatch(/spreadsheet_url = 'https?:/);
        // The cache-buster rides a `?t=` query: the committed path has no query
        // string of its own, so the old `&t=` form would 404 as part of the path.
        expect(slice).toContain('"?t=" + Date.now()');
        // The offline path survives the URL swap: a failed fetch logs and
        // returns instead of throwing.
        expect(slice).toContain('CSV FETCH FAILED');
    };

    it('fetches a relative committed path with no Google reference', () => {
        expect(() => assertLoaderContract(loaderSlice())).not.toThrow();
    });

    it('the guard can fail on each pinned token', () => {
        const good = loaderSlice();
        // Presence tokens: removing the relative URL trips the guard.
        const noUrl = good.replace(
            "var spreadsheet_url = 'wouldyourather.master.csv'",
            "var spreadsheet_url = 'other.csv'"
        );
        expect(noUrl).not.toBe(good);
        expect(() => assertLoaderContract(noUrl)).toThrow();
        // Absence tokens: re-adding a Google reference trips the guard.
        for (const injected of [
            "var spreadsheet_url = 'https://docs.google.com/spreadsheets/d/e/2PACX/pub?gid=1&output=csv';",
            '// fallback: docs.google.com',
        ]) {
            expect(() => assertLoaderContract(good + injected), injected).toThrow();
        }
    });

    it('the relative URL resolves to the committed CSV from both served paths', async () => {
        const html = page();
        const match = /var spreadsheet_url = '([^']+)'/.exec(
            html.slice(html.indexOf('async function loadScriptDataFromSheets()'))
        );
        expect(match, 'spreadsheet_url literal').not.toBeNull();
        const literal = match[1];
        expect(literal.startsWith('http')).toBe(false);
        // Pages serves the page at both /recorder.html and /recorder; the
        // relative fetch must land on /wouldyourather.master.csv either way.
        for (const base of ['http://x/recorder.html', 'http://x/recorder']) {
            expect(new URL(literal, base).pathname).toBe('/wouldyourather.master.csv');
        }
    });

    it('the served CSV parses to the bridge take count through the blank-filename filter', async () => {
        // Serves public/ over HTTP and runs the page's own loading contract:
        // same-origin fetch + cache-buster, RFC-4180 parse, skip rows with a
        // blank filename. Proves the wiring end to end without a browser.
        const { createServer } = await import('node:http');
        const server = createServer((req, res) => {
            const urlPath = new URL(req.url, 'http://x').pathname;
            const file = path.join(REPO_ROOT, 'public', decodeURIComponent(urlPath));
            fs.readFile(file, (err, data) => {
                if (err) { res.statusCode = 404; res.end('nope'); return; }
                res.statusCode = 200;
                res.end(data);
            });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const port = server.address().port;
            const csv = await fetch(`http://127.0.0.1:${port}/wouldyourather.master.csv?t=${Date.now()}`)
                .then((r) => {
                    expect(r.status).toBe(200);
                    return r.text();
                });
            const { parseCsv } = await import('../../../scripts/lib/sheet-config-utils.js');
            const { rows } = parseCsv(csv);
            const takes = rows.filter((r) => String(r.filename || '').trim() !== '');
            // The committed store matches the bridge expansion exactly (pinned
            // by generate-master-csv.test.js); the recorder sees every take.
            const { parseSourceConfig, sourceToRows } = await import('../../../scripts/lib/source-bridge-utils.js');
            const sourceText = fs.readFileSync(path.join(REPO_ROOT, 'wouldyourather.source.txt'), 'utf8');
            const expected = sourceToRows(parseSourceConfig(sourceText))
                .filter((r) => String(r.filename || '').trim() !== '').length;
            expect(expected).toBeGreaterThan(0);
            expect(takes.length).toBe(expected);
        } finally {
            server.close();
        }
    });

    // Boots the REAL page script in an isolated DOM (scripts run inside the
    // window via `runScripts: 'dangerously'`, with fetch stubbed in
    // `beforeParse`): `window.onload` runs the actual `loadScriptDataFromSheets`
    // (parse + filter + sort + display sync), and the camera init degrades
    // inside its own try/catch (no media devices here) without touching the
    // take list. NOTE: `window.eval(script)` does NOT work here — it is an
    // indirect eval and runs in the test's own global, where the page's
    // elements don't exist.
    const bootPage = async (fetchImpl) => {
        const { JSDOM } = await import('jsdom');
        const html = page();
        const fetchedUrls = [];
        const dom = new JSDOM(html, {
            url: 'http://127.0.0.1:9/recorder.html',
            runScripts: 'dangerously',
            beforeParse(pageWindow) {
                pageWindow.fetch = async (url) => {
                    fetchedUrls.push(String(url));
                    return fetchImpl(String(url));
                };
            },
        });
        const { window: win } = dom;
        expect(typeof win.onload, 'boot handler').toBe('function');
        expect(win.global_script_phrases, 'take list starts empty').toEqual([]);
        // The window `load` event (fired by the DOM itself after parse) boots
        // the page exactly once — do NOT call win.onload() manually here,
        // or the CSV is fetched twice.
        await new Promise((resolve) => {
            if (win.document.readyState === 'complete') resolve();
            else win.addEventListener('load', () => resolve(), { once: true });
        });
        return { win, dom, fetchedUrls };
    };

    const waitFor = async (cond, what) => {
        const deadline = Date.now() + 5000;
        while (!cond()) {
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
            await new Promise((r) => setTimeout(r, 25));
        }
    };

    it('loads 108 takes through the real page script with no Google fetch', async () => {
        const csv = fs.readFileSync(path.join(REPO_ROOT, 'public/wouldyourather.master.csv'), 'utf8');
        const { win, dom, fetchedUrls } = await bootPage(async () => ({ ok: true, text: async () => csv }));
        try {
            await waitFor(() => win.global_script_phrases.length > 0, 'take list');
            // The acceptance count: every filename-bearing row becomes a take.
            expect(win.global_script_phrases.length).toBe(108);
            expect(win.global_script_phrases.every((e) => String(e.filename || '').trim() !== '')).toBe(true);
            // One same-origin fetch for the committed CSV — never Google.
            expect(fetchedUrls).toHaveLength(1);
            expect(fetchedUrls[0]).toContain('wouldyourather.master.csv');
            expect(fetchedUrls[0]).toContain('?t=');
            expect(fetchedUrls[0]).not.toContain('docs.google');
            // The display synced to the first take (loader ran to completion).
            expect(win.document.getElementById('dom-progress-count').textContent).toContain('/ 108');
        } finally {
            win.close();
        }
    });

    it('logs CSV FETCH FAILED without throwing when the fetch fails', async () => {
        const { win, dom } = await bootPage(async () => { throw new Error('offline'); });
        try {
            await waitFor(
                () => win.document.getElementById('dom-debug-log').textContent.includes('CSV FETCH FAILED'),
                'fetch-failure log'
            );
            // No partial state: the take list stays empty.
            expect(win.global_script_phrases.length).toBe(0);
        } finally {
            win.close();
        }
    });
});

// The countdown overlay must actually paint: `contain: strict` (shipped in the
// original vendored copy) collapses the auto-sized box to 0x0 and clips the
// digits, so the timer runs invisibly. Guard the rule block (from the selector
// to its closing brace) and drive one real pre-roll second.
describe('recorder page — countdown overlay paints', () => {
    const page = () => fs.readFileSync(PAGE_PATH, 'utf8');

    const overlayRule = () => {
        const html = page();
        const start = html.indexOf('.huge-countdown-overlay {');
        expect(start, 'overlay rule').toBeGreaterThan(-1);
        const end = html.indexOf('}', start);
        expect(end, 'rule closing brace').toBeGreaterThan(start);
        return html.slice(start, end);
    };

    const assertOverlayContract = (rule) => {
        expect(rule).toContain('translate(-50%, -50%)');
        expect(rule).toContain('display: none');
        expect(rule).not.toContain('contain: strict');
        expect(rule).not.toContain('contain: paint');
        expect(rule).not.toContain('contain: size');
    };

    it('centers without clipping containment', () => {
        expect(() => assertOverlayContract(overlayRule())).not.toThrow();
    });

    it('the guard can fail on each pinned token', () => {
        const good = overlayRule();
        expect(() => assertOverlayContract(
            good.replace('translate(-50%, -50%)', 'translateZ(0)')
        )).toThrow();
        for (const injected of [
            'contain: strict;',
            'contain: paint;',
            'contain: size;',
        ]) {
            expect(() => assertOverlayContract(`${good}\n${injected}`), injected).toThrow();
        }
    });

    it('pre-roll shows the countdown digit on the overlay', async () => {
        const { JSDOM } = await import('jsdom');
        const html = page();
        const csv = fs.readFileSync(path.join(REPO_ROOT, 'public/wouldyourather.master.csv'), 'utf8');
        const dom = new JSDOM(html, {
            url: 'http://127.0.0.1:9/recorder.html',
            runScripts: 'dangerously',
            beforeParse(pageWindow) {
                pageWindow.fetch = async () => ({ ok: true, text: async () => csv });
            },
        });
        try {
            const { window: win } = dom;
            await new Promise((resolve) => {
                if (win.document.readyState === 'complete') resolve();
                else win.addEventListener('load', () => resolve(), { once: true });
            });
            expect(typeof win.startPreRollSequence, 'pre-roll entry').toBe('function');
            win.startPreRollSequence();
            // One real timer tick (1s countdown): the overlay must be up with
            // a digit, not display:none with a stale "4".
            await new Promise((r) => setTimeout(r, 1200));
            const overlay = win.document.getElementById('dom-huge-countdown');
            expect(overlay.style.display).toBe('block');
            expect(overlay.textContent).toMatch(/^[1-3]$/);
            expect(win.document.getElementById('dom-btn-record').textContent).toContain('WAIT');
        } finally {
            const { window: win } = dom;
            if (win.global_countdown_timer) win.clearInterval(win.global_countdown_timer);
            win.close();
        }
    });
});
