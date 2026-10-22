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
import { execFileSync } from 'node:child_process';
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
        // Story 076: the page derives the path from the course id, so a new
        // course needs no edit here.
        expect(slice).toContain("var spreadsheet_url = course + '.master.csv'");
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
            "var spreadsheet_url = course + '.master.csv'",
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

    it('takes the course from the picker, never from a baked-in default', () => {
        // The course decides which master CSV the page reads AND which course
        // every render request names, so it comes from the picker (or ?course=)
        // and no course is named in the page.
        const html = page();
        expect(html).toContain("get('course')");
        expect(html).not.toContain("|| 'wouldyourather'");
        expect(html).toContain('NO COURSE');
    });

    it('offers the courses from the committed index, with no course named', () => {
        const html = page();
        // The list is data (public/courses.json), regenerated from the repo's
        // *.source.txt files by scripts/generate-course-index.mjs.
        expect(html).toContain("id=\"dom-select-course\"");
        expect(html).toContain("fetch(courseIndexUrl()");
        expect(html).not.toContain('wouldyourather.master.csv');
        const index = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/courses.json'), 'utf8'));
        expect(Array.isArray(index.courses)).toBe(true);
        expect(index.courses.length).toBeGreaterThan(0);
        for (const course of index.courses) {
            expect(course, 'course id').toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
        }
    });

    it('every render request carries the course', () => {
        const html = page();
        const posts = [...html.matchAll(/body: JSON\.stringify\(\{ files: ([^}]+)\}/g)].map((m) => m[0]);
        expect(posts.length).toBeGreaterThan(0);
        for (const post of posts) expect(post).toContain('course: global_recorder_course');
    });

    it('the relative URL resolves to the committed CSV from both served paths', async () => {
        const html = page();
        const match = /var spreadsheet_url = course \+ '([^']+)'/.exec(
            html.slice(html.indexOf('async function loadScriptDataFromSheets()'))
        );
        expect(match, 'spreadsheet_url expression').not.toBeNull();
        const suffix = match[1];
        // Pages serves the page at both /recorder.html and /recorder; the
        // relative fetch must land on /<course>.master.csv either way.
        for (const base of ['http://x/recorder.html', 'http://x/recorder']) {
            for (const course of ['wouldyourather', 'othercourse']) {
                expect(new URL(course + suffix, base).pathname).toBe(`/${course}.master.csv`);
            }
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
            url: 'http://127.0.0.1:9/recorder.html?course=wouldyourather',
            runScripts: 'dangerously',
            beforeParse(pageWindow) {
                pageWindow.fetch = async (url) => {
                    fetchedUrls.push(String(url));
                    if (String(url).indexOf('courses.json') !== -1) {
                        return {
                            ok: true,
                            text: async () => JSON.stringify({ courses: ['wouldyourather'] }),
                        };
                    }
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
            // The studio reads the course index, then that course's master CSV.
            expect(fetchedUrls).toHaveLength(2);
            expect(fetchedUrls[0]).toContain('courses.json');
            expect(fetchedUrls[1]).toContain('wouldyourather.master.csv');
            // The picker is filled from the index and selects the course.
            const picker = win.document.getElementById('dom-select-course');
            expect(picker, 'course picker').not.toBeNull();
            expect([...picker.options].map((o) => o.value)).toEqual(['wouldyourather']);
            expect(picker.value).toBe('wouldyourather');
            for (const url of fetchedUrls) {
                expect(url).toContain('?t=');
                expect(url).not.toContain('docs.google');
            }
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
            url: 'http://127.0.0.1:9/recorder.html?course=wouldyourather',
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

// Story 066: lesson-level auto-render. The harness below boots the REAL page
// with a stubbed fetch and drives REAL accept-clicks (fake Blob + operator
// key), so every assertion below exercises production code paths, not
// re-implementations.
describe('recorder page — lesson auto-render', () => {
    // Closes a booted test page, stopping its 5s render poller first so no
    // tick fires into a closed window after the test ends.
    const closeAuto = (win) => {
        try {
            if (win.global_render_poll_timer) win.clearInterval(win.global_render_poll_timer);
        } catch (e) { /* already closed */ }
        win.close();
    };

    const AUTO_CSV = [
        'course_id,lesson_id,filename,phrase,character,order,response_type,video_file',
        'crs,a,a01,Q-a1?,Teacher,1,friendClosedResponse,crs-a-01',
        'crs,a,a02,Q-a2?,Teacher,2,friendClosedResponse,crs-a-01',
        'crs,a,,BRANCH?,Teacher,3,branching,{friendCode}crs-a-01',
        'crs,,noid01,Q-noid?,Teacher,4,friendClosedResponse,crs-x-01',
        'crs,b,b01,Q-b1?,Teacher,1,friendClosedResponse,crs-b-01',
        'crs,b,b02,Q-b2?,Teacher,2,friendClosedResponse,crs-b-01',
    ].join('\n');
    // Sorted by (character, filename): a01(0), a02(1), b01(2), b02(3), noid01(4).
    const IDX = { a01: 0, a02: 1, b01: 2, b02: 3, noid01: 4 };

    const flush = async (n = 10) => {
        for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
    };

    // Stub fetch with per-endpoint control. Upload/render resolve immediately
    // unless told otherwise; status answers from statusFor(jobId, callCount).
    // failUpload also accepts an array of 1-based upload call numbers to fail.
    function makePipelineStub({ failUpload = null, failRender = null, deferRender = false, statusFor = null } = {}) {
        const calls = { upload: [], render: [], status: [] };
        const renderResolvers = [];
        const uploadMode = () => Array.isArray(failUpload)
            ? (failUpload.includes(calls.upload.length) ? 'reject' : null)
            : failUpload;
        const impl = async (url, opts = {}) => {
            const u = String(url);
            if (u.includes('/api/pipeline/upload-raw')) {
                calls.upload.push(opts.headers && opts.headers['x-filename']);
                const mode = uploadMode();
                if (mode === 'reject') throw new Error('offline');
                if (mode === 'http') return { ok: false, status: 401 };
                return { ok: true };
            }
            if (u.includes('/api/pipeline/render')) {
                const body = JSON.parse(opts.body);
                const job = 'job-' + (calls.render.length + 1);
                calls.render.push({ files: body.files, key: opts.headers && opts.headers['x-operator-key'], job });
                if (failRender === 'reject') throw new Error('boom');
                if (failRender === 'http') return { ok: false, status: 500 };
                if (deferRender) {
                    return new Promise((resolve) => renderResolvers.push(
                        () => resolve({ ok: true, json: async () => ({ jobId: job }) })));
                }
                return { ok: true, json: async () => ({ jobId: job }) };
            }
            if (u.includes('/api/pipeline/status')) {
                calls.status.push(u);
                const id = new URL(u, 'http://x').searchParams.get('id');
                const s = statusFor ? statusFor(id, calls.status.length) : { status: 'running', stage: 'stage1' };
                return { ok: true, json: async () => s };
            }
            return { ok: true, text: async () => AUTO_CSV };
        };
        impl.calls = calls;
        impl.resolveRenders = () => { renderResolvers.splice(0).forEach((r) => r()); };
        return impl;
    }

    const bootAuto = async (stub, seedStorage = null) => {
        const { JSDOM } = await import('jsdom');
        const html = fs.readFileSync(PAGE_PATH, 'utf8');
        const dom = new JSDOM(html, {
            url: 'http://127.0.0.1:9/recorder.html?course=wouldyourather',
            runScripts: 'dangerously',
            beforeParse(pageWindow) {
                pageWindow.fetch = stub;
                for (const [k, v] of Object.entries(seedStorage || {})) {
                    pageWindow.sessionStorage.setItem(k, v);
                }
            },
        });
        const { window: win } = dom;
        await new Promise((resolve) => {
            if (win.document.readyState === 'complete') resolve();
            else win.addEventListener('load', () => resolve(), { once: true });
        });
        await waitForTakes(win);
        return { win, dom };
    };

    const waitForTakes = async (win) => {
        const deadline = Date.now() + 5000;
        while (win.global_script_phrases.length === 0) {
            if (Date.now() > deadline) throw new Error('timed out waiting for take list');
            await new Promise((r) => setTimeout(r, 25));
        }
    };

    const uploadTake = async (win, index) => {
        win.global_current_index = index;
        win.global_last_final_blob = new win.Blob(['bytes'], { type: 'video/mp4' });
        win.document.getElementById('dom-operator-key').value = 'K';
        win.document.getElementById('dom-btn-accept').click();
        await flush();
    };

    const debugLog = (win) => win.document.getElementById('dom-debug-log').textContent;
    const storedSet = (win, key) => {
        const raw = win.sessionStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    };

    it('uploads without rendering until the lesson completes', async () => {
        const stub = makePipelineStub();
        const { win } = await bootAuto(stub);
        try {
            await uploadTake(win, IDX.a01);
            expect(stub.calls.upload).toEqual(['a01']);
            expect(stub.calls.render).toEqual([]);
            expect(win.global_current_index).toBe(IDX.a02);
        } finally { closeAuto(win); }
    });

    it('auto-POSTs exactly the finished lesson files with the operator key', async () => {
        const stub = makePipelineStub();
        const { win } = await bootAuto(stub);
        try {
            await uploadTake(win, IDX.a01);
            await uploadTake(win, IDX.a02);
            expect(stub.calls.render).toHaveLength(1);
            expect(stub.calls.render[0].files).toEqual(['a01', 'a02']);
            expect(stub.calls.render[0].key).toBe('K');
        } finally { closeAuto(win); }
    });

    it('a blank-lesson_id take uploads and advances but never triggers', async () => {
        const stub = makePipelineStub();
        const { win } = await bootAuto(stub);
        try {
            await uploadTake(win, IDX.noid01);
            expect(stub.calls.upload).toEqual(['noid01']);
            expect(stub.calls.render).toEqual([]);
            expect(debugLog(win)).toContain('NO LESSON ID');
        } finally { closeAuto(win); }
    });

    it('offline and 401 uploads keep the take and never render', async () => {
        for (const failUpload of ['reject', 'http']) {
            const stub = makePipelineStub({ failUpload });
            const { win } = await bootAuto(stub);
            try {
                await uploadTake(win, IDX.a01);
                // The take was kept for retry: the failure path re-enables
                // Accept, shows TAKE KEPT, and never advances past the take.
                expect(win.document.getElementById('dom-btn-accept').disabled).toBe(false);
                expect(win.document.getElementById('dom-status-bar').textContent).toContain('TAKE KEPT');
                expect(win.global_current_index).toBe(IDX.a01);
                await uploadTake(win, IDX.a02);
                expect(stub.calls.render).toEqual([]);
            } finally { closeAuto(win); }
        }
    });

    it('a failed render POST advances the take but leaves the lesson unrendered', async () => {
        for (const failRender of ['reject', 'http']) {
            const stub = makePipelineStub({ failRender });
            const { win } = await bootAuto(stub);
            try {
                await uploadTake(win, IDX.a01);
                await uploadTake(win, IDX.a02);
                expect(win.global_current_index).toBe(IDX.b01);
                expect(storedSet(win, 'uff_rendered_lessons') || []).not.toContain('crs\0a');
                expect(debugLog(win)).toContain('LESSON RENDER FAILED');
            } finally { closeAuto(win); }
        }
    });

    it('completing the same lesson twice POSTs exactly once', async () => {
        // Direct re-invocation is the faithful double-fire simulation: the
        // Accept button is disabled during upload, so the real double-fire
        // path is re-entrant completion checks, not double-clicks. A genuine
        // re-upload (new upload POST) re-renders by design — see the re-take
        // test — so this drives the check without a new upload.
        const stub = makePipelineStub({ deferRender: true });
        const { win } = await bootAuto(stub);
        try {
            await uploadTake(win, IDX.a01);
            await uploadTake(win, IDX.a02);
            // The render POST is still pending; re-invoke the completion check
            // directly (a second upload would be a re-take, which re-renders by
            // design — see the re-take test). The synchronous test-and-add must
            // hold exactly one POST.
            win.maybeAutoRenderLesson('a02');
            win.maybeAutoRenderLesson('a01');
            await flush();
            stub.resolveRenders();
            await flush();
            const aRenders = stub.calls.render.filter((c) => c.files.includes('a01'));
            expect(aRenders).toHaveLength(1);
        } finally { closeAuto(win); }
    });

    it('renders each lesson once across lessons (no re-POST of finished lessons)', async () => {
        const stub = makePipelineStub();
        const { win } = await bootAuto(stub);
        try {
            await uploadTake(win, IDX.a01);
            await uploadTake(win, IDX.a02);
            await uploadTake(win, IDX.b01);
            await uploadTake(win, IDX.b02);
            expect(stub.calls.render.map((c) => c.files)).toEqual([['a01', 'a02'], ['b01', 'b02']]);
            expect(debugLog(win)).toContain('LESSON a render job started: job-1');
            expect(debugLog(win)).toContain('LESSON b render job started: job-2');
        } finally { closeAuto(win); }
    });

    it('honors a persisted rendered set across reload (only new lessons render)', async () => {
        const stub = makePipelineStub();
        const { win } = await bootAuto(stub, {
            uff_rendered_lessons: JSON.stringify(['crs\0a']),
            uff_uploaded_takes: JSON.stringify(['a01', 'a02']),
        });
        try {
            await uploadTake(win, IDX.b01);
            await uploadTake(win, IDX.b02);
            expect(stub.calls.render.map((c) => c.files)).toEqual([['b01', 'b02']]);
        } finally { closeAuto(win); }
    });

    it('treats corrupt sessionStorage sets as empty without throwing on boot', async () => {
        const stub = makePipelineStub();
        const { win } = await bootAuto(stub, {
            uff_rendered_lessons: '{nope',
            uff_uploaded_takes: '[broken',
        });
        try {
            expect(win.global_script_phrases.length).toBe(5);
            await uploadTake(win, IDX.a01);
            await uploadTake(win, IDX.a02);
            expect(stub.calls.render.map((c) => c.files)).toEqual([['a01', 'a02']]);
        } finally { closeAuto(win); }
    });

    it('a re-take into a finished lesson re-renders exactly that lesson', async () => {
        const stub = makePipelineStub();
        const { win } = await bootAuto(stub);
        try {
            await uploadTake(win, IDX.a01);
            await uploadTake(win, IDX.a02);
            expect(stub.calls.render).toHaveLength(1);
            await uploadTake(win, IDX.a01);
            expect(stub.calls.render.map((c) => c.files)).toEqual([['a01', 'a02'], ['a01', 'a02']]);
            // The uploaded set stays a set: re-uploads never duplicate entries.
            expect(JSON.parse(win.sessionStorage.getItem('uff_uploaded_takes'))).toEqual(['a01', 'a02']);
        } finally { closeAuto(win); }
    });

    it('a failed re-upload does not de-render the finished lesson', async () => {
        const stub = makePipelineStub({ failUpload: [3] });
        const { win } = await bootAuto(stub);
        try {
            await uploadTake(win, IDX.a01);
            await uploadTake(win, IDX.a02);
            expect(stub.calls.render).toHaveLength(1);
            await uploadTake(win, IDX.a01);
            expect(stub.calls.upload).toEqual(['a01', 'a02', 'a01']);
            expect(stub.calls.render).toHaveLength(1);
            expect(JSON.parse(win.sessionStorage.getItem('uff_rendered_lessons'))).toEqual(['crs\0a']);
        } finally { closeAuto(win); }
    });

    it('unchecked auto-render uploads and advances with zero POSTs and untouched sets', async () => {
        const stub = makePipelineStub();
        const { win } = await bootAuto(stub);
        try {
            win.document.getElementById('dom-check-auto-render').checked = false;
            await uploadTake(win, IDX.a01);
            await uploadTake(win, IDX.a02);
            expect(stub.calls.render).toEqual([]);
            expect(win.global_current_index).toBe(IDX.b01);
            expect(win.sessionStorage.getItem('uff_uploaded_takes')).toBeNull();
            expect(win.sessionStorage.getItem('uff_rendered_lessons')).toBeNull();
        } finally { closeAuto(win); }
    });

    it('checkbox exists beside auto-advance, checked by default with its label', async () => {
        const stub = makePipelineStub();
        const { win } = await bootAuto(stub);
        try {
            const box = win.document.getElementById('dom-check-auto-render');
            expect(box).not.toBeNull();
            expect(box.checked).toBe(true);
            expect(box.type).toBe('checkbox');
            const label = win.document.querySelector('label[for="dom-check-auto-render"]');
            expect(label.textContent).toBe('auto-render finished lessons');
            expect(win.document.getElementById('dom-check-auto')).not.toBeNull();
        } finally { closeAuto(win); }
    });

    it('polls every unfinished job each tick and drops finished ones', async () => {
        const seen = {};
        const stub = makePipelineStub({
            statusFor: (id) => {
                seen[id] = (seen[id] || 0) + 1;
                if (id === 'job-1' && seen[id] >= 3) return { status: 'done', stage: '-' };
                return { status: 'running', stage: 's1' };
            },
        });
        const { win } = await bootAuto(stub);
        try {
            await uploadTake(win, IDX.a01);
            await uploadTake(win, IDX.a02);
            await uploadTake(win, IDX.b01);
            await uploadTake(win, IDX.b02);
            await flush();
            stub.calls.status.length = 0;
            win.pollUnfinishedRenderJobs();
            await flush();
            const tick1 = stub.calls.status.map((u) => new URL(u, 'http://x').searchParams.get('id')).sort();
            expect(tick1).toEqual(['job-1', 'job-2']);
            const line = win.document.getElementById('dom-render-status').textContent;
            expect(line).toContain('LESSON a');
            expect(line).toContain('LESSON b');
            stub.calls.status.length = 0;
            win.pollUnfinishedRenderJobs();
            await flush();
            const tick2 = stub.calls.status.map((u) => new URL(u, 'http://x').searchParams.get('id'));
            expect(tick2).toEqual(['job-2']);
        } finally { closeAuto(win); }
    });

    it('manual START RENDER still POSTs the full list as one job', async () => {
        const stub = makePipelineStub({
            statusFor: () => ({ status: 'done', stage: '-' }),
        });
        const { win } = await bootAuto(stub);
        try {
            win.document.getElementById('dom-operator-key').value = 'K';
            win.document.getElementById('dom-btn-render').click();
            await flush();
            expect(stub.calls.render).toHaveLength(1);
            expect(stub.calls.render[0].files).toEqual(['a01', 'a02', 'b01', 'b02', 'noid01']);
            win.pollUnfinishedRenderJobs();
            await flush();
            expect(win.document.getElementById('dom-render-status').textContent).toContain('LESSON full: done');
            stub.calls.status.length = 0;
            win.pollUnfinishedRenderJobs();
            await flush();
            expect(stub.calls.status).toEqual([]);
        } finally { closeAuto(win); }
    });
});

// Story 066, Task 4: the auto-render relies on server contracts that must stay
// exactly as they are — no server change in this story. Each guard slices the
// owning function (raw text, never comment-stripped) and is proven failable
// by mutation. A failing guard means stop and report, never expand scope.
describe('recorder auto-render — zero server changes', () => {
    const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const sliceBetween = (text, startMarker, endMarker) => {
        const start = text.indexOf(startMarker);
        if (start === -1) throw new Error('slice start not found: ' + startMarker);
        const end = text.indexOf(endMarker, start + startMarker.length);
        if (end === -1) throw new Error('slice end not found: ' + endMarker);
        return text.slice(start, end);
    };

    it('render.js accepts any non-empty valid-slug array (no course-size check)', () => {
        const text = read('functions/api/pipeline/render.js');
        const slice = sliceBetween(text, 'onRequestPost', 'crypto.randomUUID()');
        expect(slice).toContain('Array.isArray(files)');
        expect(slice).toContain('files.length === 0');
        expect(slice).toContain('files.every(isValidPipelineSlug)');
        expect(slice).not.toMatch(/files\.length\s*!==/);
        expect(slice).not.toMatch(/files\.length\s*===\s*[1-9]/);
        expect(slice).not.toContain('new Set(files)');
    });

    it('orchestrator scopes every stage and the publish plan via only=files', () => {
        const text = read('docs/video-pipeline/modal_app.py');
        const slice = sliceBetween(text, 'def orchestrator(spec', '\ndef _publish(');
        for (const callee of ['run_silence_removal', 'run_background_removal', 'process_video_batch', 'plan_publish']) {
            expect(slice, callee).toContain(callee);
        }
        expect((slice.match(/only=files/g) || []).length).toBe(5);
    });

    it('select_rows filters by membership and plan_publish dedups first-wins', () => {
        const text = read('docs/video-pipeline/pipeline_lib.py');
        const select = sliceBetween(text, 'def select_rows', 'def plan_publish');
        expect(select).toContain('allowed = set(only)');
        expect(select).toContain('in allowed');
        const plan = sliceBetween(text, 'def plan_publish', 'def intro_poster_slugs');
        expect(plan).toContain('seen = set()');
        expect(plan).toContain('slug in seen');
    });

    it('SRT merge never clears a blank cell', () => {
        const text = read('scripts/write-srt-to-csv.mjs');
        const slice = sliceBetween(text, '#!/usr/bin/env node', 'Usage:');
        expect(slice).toContain('a group whose `srt` is blank is not cleared');
    });

    it('translation fills blanks only', () => {
        const text = read('scripts/lib/sheet-translate-utils.js');
        const slice = sliceBetween(text, '// scripts/lib/sheet-translate-utils.js', "import { parseSrt");
        expect(slice).toContain('Translation ONLY fills blanks');
    });

    it('config generation skips incomplete courses whole and non-fatally', () => {
        const text = read('scripts/generate-config-from-sheet.mjs');
        expect(text).toContain('SKIPPED WHOLE');
        expect(text).toContain('missing required column(s)');
        expect(text).toContain('non-fatal');
    });

    it('each server guard fails when its pinned token is mutated', () => {
        const render = read('functions/api/pipeline/render.js');
        expect(() => {
            const slice = sliceBetween(render, 'onRequestPost', 'crypto.randomUUID()') + '\nif (files.length !== 108) return bad;';
            expect(slice).not.toMatch(/files\.length\s*!==/);
        }).toThrow();
        const modal = read('docs/video-pipeline/modal_app.py');
        expect(() => {
            const slice = sliceBetween(modal, 'def orchestrator(spec', '\ndef _publish(').replace('only=files', 'only=all');
            expect((slice.match(/only=files/g) || []).length).toBe(5);
        }).toThrow();
        const lib = read('docs/video-pipeline/pipeline_lib.py');
        expect(() => {
            const slice = sliceBetween(lib, 'def select_rows', 'def plan_publish').replace('allowed = set(only)', 'allowed = everything()');
            expect(slice).toContain('allowed = set(only)');
        }).toThrow();
        const srt = read('scripts/write-srt-to-csv.mjs');
        expect(() => {
            const slice = sliceBetween(srt, '#!/usr/bin/env node', 'Usage:').replace('is not cleared', 'is cleared');
            expect(slice).toContain('a group whose `srt` is blank is not cleared');
        }).toThrow();
        const tr = read('scripts/lib/sheet-translate-utils.js');
        expect(() => {
            const slice = sliceBetween(tr, '// scripts/lib/sheet-translate-utils.js', "import { parseSrt").replace('Translation ONLY fills blanks', 'Translation fills everything');
            expect(slice).toContain('Translation ONLY fills blanks');
        }).toThrow();
        const gen = read('scripts/generate-config-from-sheet.mjs');
        expect(() => {
            expect(gen.replace('SKIPPED WHOLE', 'SKIPPED')).toContain('SKIPPED WHOLE');
        }).toThrow();
    });

    it('implementation diff touches only the allowlist (tracked) and adds no stray files (untracked)', () => {
        const tracked = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' })
            .split('\n').map((l) => l.trim()).filter(Boolean);
        // Each story's set of authorized paths. 066 scoped the recorder
        // feature; 068 works on the render's overlay + social publish.
        const allowlist = [
            // wouldyourather: stale lesson titles + stray SRT batch markers.
            'wouldyourather.source.txt',
            'src/config/wouldyourather.json',
            'src/config/wouldyourather-test.json',
            'src/config/wouldyourather.test.js',
            'src/config/ababab-generated-contract.test.js',
            // Story 066 (recorder auto-render).
            'public/recorder.html',
            'public/courses.json',
            'scripts/generate-course-index.mjs',
            'scripts/generate-course-index.test.js',
            '.github/workflows/source-to-csv.yml',
            'scripts/source-to-csv-workflow.test.js',
            'src/modules/video/recorder-page.test.js',
            'scripts/translate-master-csv.mjs',
            'scripts/sync-srt-workflow.test.js',
            'scripts/translate-master-workflow.test.js',
            'scripts/translate-master-csv.test.js',
            'scripts/lib/gemini.js',
            'scripts/lib/gemini.test.js',
            'docs/product.md',
            'docs/turnstile-signup-gate.md',
            'docs/email-validation.md',
            'stories/066-recorder-auto-render-lessons/story.md',
            // Story 068 (title pill + social publish).
            'stories/068-title-pill-social-publish/story.md',
            'docs/video-pipeline/video_pipeline.py',
            'docs/video-pipeline/pipeline_lib.py',
            'docs/video-pipeline/modal_app.py',
            'docs/video-pipeline/authoring-sheet.md',
            'docs/video-pipeline/tests/test_pipeline_lib.py',
            'docs/video-pipeline/tests/test_pipeline_parity.py',
            'docs/video-pipeline/tests/test_pipeline_source.py',
            'docs/video-pipeline/tests/test_modal_app_source.py',
            'src/modules/video/pipeline-keys.js',
            'src/modules/video/pipeline-keys.test.js',
            'src/modules/video/video-header-logic.test.js',
            // wouldyourather config regeneration (bridge hero + config bump).
            'public/wouldyourather.master.csv',
            'src/generated/poster-lqips.js',
            'src/generated/poster-lqips.test.js',
            'scripts/lib/sheet-config-utils.js',
            'scripts/lib/sheet-config-utils.test.js',
            'scripts/lib/source-bridge-utils.js',
            'scripts/lib/source-bridge-utils.test.js',
            'scripts/lib/poster-utils.test.js',
            'scripts/verify-thumbnails.test.js',
            'src/modules/video/model-config.test.js',
            'src/modules/courses/friend-courses-logic.js',
            'src/modules/courses/friend-course-configs.test.js',
            'scripts/generate-config-from-sheet.mjs',
            'scripts/generate-config-from-sheet.test.js',
            'scripts/generate-sheet-from-source.mjs',
            'docs/video-pipeline/trigger_app.py',
            'functions/api/pipeline/render.js',
            'functions/api/pipeline/render.test.js',
            'src/modules/courses/friend-courses-logic.test.js',
            // Zoho CPaaS email migration.
            '.env.example',
            'docs/auth-emails.md',
            'docs/email-confirmation.md',
            'docs/email-setup.md',
            'functions/api/auth-email-hook.js',
            'functions/api/auth-email-hook.test.js',
            'functions/api/resend-send.js',
            'functions/api/welcome-email.js',
            'functions/api/welcome-email.test.js',
            'functions/api/zoho-send.js',
            'wrangler.toml',
            'src/assets/css/app.css',
            'src/components/video-header-blur.test.js',
            'src/modules/bilingual/config-normalizer.js',
            'src/modules/lesson/branch-choice-wiring.test.js',
            // Branching headline visibility (this change).
            'src/components/LessonContainer.jsx',
            'src/components/SimpleVideoPlayer.web.jsx',
            // Branching step button sizing/layout (this change).
            'src/components/widgets/BranchChoiceButtons.jsx',
            'src/components/widgets/BranchChoiceButtons.test.jsx',
            'src/components/widgets/SuccessButtons.jsx',
            'src/components/widgets/ViewAndContinueButtons.jsx',
            'src/components/widgets/ResponseDecisionButtons.jsx',
            'src/modules/lesson/branch-choice-logic.js',
            'src/modules/lesson/branch-choice-logic.test.js',
// Signup profile-write race (geo upsert vs signup insert) + the
            // non-destructive repair for rows that are missing an identity.
            'supabase/migrations/009_create_profile_on_signup.sql',
            'src/components/auth/SignupForm.jsx',
            'src/components/auth/SignupForm.profile-write.test.jsx',
            'src/components/auth/SignupForm.turnstile.test.jsx',
            'src/components/auth/SignupForm.email-validation.test.jsx',
            'src/components/auth/signup-chain-wait.js',
            'src/components/auth/SignupForm.guest-lesson-credit.test.jsx',
            'src/components/auth/signup-welcome-email-wiring.test.js',
            'src/modules/api/api.js',
            'src/modules/utils/short-id.js',
            'src/modules/user/user-profile.js',
            'src/modules/user/profile-repair-logic.js',
            'src/modules/user/profile-repair-logic.test.js',
            'src/modules/user/profile-repair.test.js',
            // Home top bar: the logo must not push the bell out of the frame.
            'src/components/homescreen/HomeScreen.jsx',
            'tests/home-bell-desktop-fit.spec.js',
            'stories/070-lazy-signup-funnel/story.md',
            'stories/071-real-404-page/story.md',
            'AGENTS.md',
            'src/components/courses/CourseListings.jsx',
            'src/components/courses/CourseListingsContainer.jsx',
            'src/components/courses/CourseListings.test.jsx',
            'src/components/courses/course-listings-source.test.js',
            'src/components/modals/GuestLoginModal.web.jsx',
            'src/components/modals/SaveClipsSignupForm.jsx',
            'src/components/modals/SaveClipsLoginForm.jsx',
            'src/components/modals/SaveClipsModal.web.jsx',
            'src/components/auth/LoginForm.jsx',
            'src/components/profile/UserProfile.jsx',
            'src/data/strings.js',
            'src/data/strings-friend-practice.test.js',
            // Last chain lesson: terminal share copy (burnt card, success CTA,
            // share text) — all derived from config order.
            'src/components/widgets/SuccessScreen.jsx',
            'src/modules/video/video-share.web.js',
            'src/modules/video/video-share-message.test.js',
            'src/modules/video/video-processor-share-cta.test.js',
            'src/modules/courses/guest-viewer-logic.js',
            'src/modules/courses/guest-viewer-logic.test.js',
            // Course end: profile "Lesson N of 7" labels, the closing
            // lesson's code-owned goodbye block, and generic lesson titles.
            'src/data/strings.test.js',
            'src/routes/LoginRoute.jsx',
            'src/routes/SignupRoute.jsx',
            'src/routes/SignupRoute.test.jsx',
            'src/routes/home-navigation-wiring.test.js',
            'src/routes/lazy-signup.test.js',
            'src/routes/routes.test.js',
            'tests/hide-signup-skip-button.spec.js',
            // Desktop frame regression: the landing page must not be clipped.
            'tests/landing-frame-desktop.spec.js',
'src/components/LessonContainer.jsx',
            // Story 072 (frozen speech capture): the 9:16 camera composite, the
            // frozen-take detector, and the 3-2-1 pre-roll countdown that holds
            // back the localized speak overlay.
            'src/components/widgets/WebcamPreview.jsx',
            'src/components/widgets/MicStatusText.jsx',
            'src/components/widgets/recording-countdown-wiring.test.js',
            'src/modules/speech/speech-orchestrator.js',
            'src/modules/speech/speech-orchestrator.test.js',
            'src/modules/store/store.js',
            'src/modules/speech/speech.web.js',
            'src/modules/speech/portrait-capture-logic.js',
            'src/modules/speech/portrait-capture-logic.test.js',
            'src/modules/speech/portrait-capture-guards.test.js',
            'src/modules/lesson/step-executor-webonly.js',
            'playwright.config.js',
            'tests/composite-freeze-guard.spec.js',
            'stories/072-fix-frozen-speech-capture/story.md',
            'docs/learnings.md',
            // Story 074 (single-press re-record): the pure restart decision plus
            // its unit and source-guard tests, and the store table's transition
            // case. No recorder-page code involved — listed per this file's
            // per-story convention.
            'src/modules/speech/rerecord-logic.js',
            'src/modules/speech/rerecord-logic.test.js',
            'src/modules/speech/rerecord-wiring.test.js',
            'src/modules/store/store.test.js',
            'stories/074-rerecord-single-press/story.md',
            // Story 075 (Android silent lesson-video start): the audio guard
            // that repairs a muted clip, the pure audibility rules, the wiring
            // guards, and the capture release at the step boundary. Listed per
            // this file's per-story convention.
            'src/modules/video/audio-playback-logic.js',
            'src/modules/video/audio-playback-logic.test.js',
            'src/modules/video/audio-guard.js',
            'src/modules/video/audio-guard.test.js',
            'src/modules/video/audio-guard-wiring.test.js',
            'src/components/InteractiveVideoPlayer.web.jsx',
            'src/components/step-loader.web.js',
            'src/components/PlaybackVideo.jsx',
            'src/modules/speech/capture-release-logic.js',
            'src/modules/speech/capture-release-logic.test.js',
            'src/modules/speech/capture-release-wiring.test.js',
            'tests/audio-guard-repairs-muted-video.spec.js',
            'tests/playback-video-audio-guard.spec.js',
            'stories/075-fix-android-silent-video-start/story.md',
            // Shared app header: every inside page of the app renders the same
            // header (the brand bar + menu drawer), mounted once by the app
            // shell. The public landing page, the lesson player and the public
            // share-code profile keep their own chrome.
            'src/components/layout/AppHeader.web.jsx',
            'src/components/layout/AppHeader.test.jsx',
            'src/modules/navigation/app-menu-logic.js',
            'src/modules/navigation/app-menu-logic.test.js',
            'src/routes/AppShellLayout.jsx',
            'src/routes/app-shell-header.test.jsx',
            'src/routes/routes.jsx',
            'src/routes/friends-navigation-wiring.test.js',
            'src/components/homescreen/HomeScreen.test.jsx',
            'src/components/friends/Friends.jsx',
            'src/components/legal/LegalPage.jsx',
            'src/components/legal/legal-wiring.test.js',
            'src/components/notifications/push-optin-wiring.test.jsx',
            'src/components/pwa/pwa-install-wiring.test.jsx',
            'src/modules/notifications/notification-wiring.test.js',
            // Story 075 (ABABAB pattern through every lesson): the hand-written
            // model config for the wouldyourather friend course, its backup of
            // the pre-rewrite state, and the story itself.
            'src/config/wouldyourather-test.test.js',
            'stories/075-ababab-pattern-all-lessons/story.md',
            'stories/075-ababab-pattern-all-lessons/wouldyourather-test.before.json',
            'stories/075-ababab-pattern-all-lessons/lesson-c.proposed.json',
            'stories/075-ababab-pattern-all-lessons/lesson-c.review.json',
            'stories/075-ababab-pattern-all-lessons/wouldyourather-test.review.json',
            '.github/workflows/sync-srt.yml',
            '.github/workflows/translate-master.yml',
            'scripts/generate-master-csv.mjs',
            'scripts/generate-master-csv.test.js',
            'scripts/write-srt-to-csv.mjs',
            'stories/076-generate-ababab-config/story.md',
            'src/config/course-tags.test.js',
            'src/components/BilingualString.jsx',
            'src/components/courses/CourseTopicFilter.jsx',
            'src/components/courses/FriendCoursesView.jsx',
            'src/components/profile/FriendLessonLinksSection.jsx',
            'src/components/profile/PublicProfile.jsx',
            'src/components/profile/PublicProfile.test.jsx',
            'src/hooks/useFriendChainHeads.js',
            'src/modules/api/lesson-completion-migration.test.js',
            'src/modules/courses/course-tags-logic.js',
            'src/modules/courses/course-tags-logic.test.js',
            'src/modules/user/friend-lesson-link-logic.js',
            'src/modules/user/friend-lesson-link-logic.test.js',
            'src/modules/user/guest-modal-logic.js',
            'src/modules/user/guest-modal-logic.test.js',
            'src/modules/user/lesson-completion-write.test.js',
            'src/modules/user/user-profile.test.js',
            'stories/082-profile-counts-and-links/story.md',
            'supabase/migrations/012_record_lesson_completion.sql',
            'tests/topic-pages.spec.js',
            'src/components/PlaybackVideo.jsx',
            'src/components/courses/TagPage.jsx',
            'src/components/courses/TagPage.test.jsx',
            'src/components/courses/WelcomePage.jsx',
            'src/components/courses/WelcomePage.test.jsx',
            'src/components/layout/AppHeader.web.jsx',
            'src/components/profile/FriendLessonLinksSection.jsx',
            'src/components/profile/FriendLessonLinksSection.test.jsx',
            'src/components/profile/PublicProfile.jsx',
            'src/config/course-tags.test.js',
            'src/components/BilingualString.jsx',
            'src/components/courses/CourseTopicFilter.jsx',
            'src/components/courses/FriendCoursesView.jsx',
            'src/components/profile/FriendLessonLinksSection.jsx',
            'src/components/profile/PublicProfile.jsx',
            'src/components/profile/PublicProfile.test.jsx',
            'src/hooks/useFriendChainHeads.js',
            'src/modules/api/lesson-completion-migration.test.js',
            'src/modules/courses/course-tags-logic.js',
            'src/modules/courses/course-tags-logic.test.js',
            'src/modules/user/friend-lesson-link-logic.js',
            'src/modules/user/friend-lesson-link-logic.test.js',
            'src/modules/user/guest-modal-logic.js',
            'src/modules/user/guest-modal-logic.test.js',
            'src/modules/user/lesson-completion-write.test.js',
            'src/modules/user/user-profile.test.js',
            'stories/082-profile-counts-and-links/story.md',
            'supabase/migrations/012_record_lesson_completion.sql',
            'tests/topic-pages.spec.js',
            'src/hooks/use-guest-modal-guard-public-route.test.js',
            'src/hooks/use-guest-modal-guard.js',
            'src/modules/api/friend-link-write-migration.test.js',
            'src/modules/bilingual/config-normalizer.test.js',
            'src/modules/courses/course-tag-labels.js',
            'src/modules/courses/course-tag-labels.test.js',
            'src/modules/speech/capture-release-logic.js',
            'src/modules/speech/capture-release-logic.test.js',
            'src/modules/speech/capture-release-wiring.test.js',
            'src/modules/user/friend-lesson-link-logic.js',
            'src/modules/user/friend-lesson-link-logic.test.js',
            'src/modules/user/friend-lesson-link-wiring.test.js',
            'src/modules/user/guest-modal-logic.js',
            'src/modules/user/guest-modal-logic.test.js',
            'src/modules/video/audio-guard-wiring.test.js',
            'src/modules/video/video-processor-logic.js',
            'src/modules/video/video-processor-logic.test.js',
            'src/modules/video/video-processor.web.js',
            'src/routes/AppShellLayout.jsx',
            'src/routes/AuthLayout.jsx',
            'src/routes/NotFoundRoute.jsx',
            'src/routes/app-shell-header.test.jsx',
            'src/routes/not-found-routing.test.jsx',
            'src/routes/routes.jsx',
            'stories/075-fix-android-silent-video-start/story.md',
            'stories/078-record-friend-link-server-side/story.md',
            'stories/079-friend-video-key-inviter/story.md',
            'stories/080-profile-guest-note-plain-text/story.md',
            'stories/081-app-header-every-page/story.md',
            'supabase/migrations/011_record_friend_link.sql',
            'tests/playback-video-audio-guard.spec.js',
            'tests/profile-visitor-lessons.spec.js',
            'tests/topic-pages.spec.js',
            'src/config/friend-lesson-link-config.test.js',
            'src/config/friend.json',
            'src/config/friend.test.js',
            'src/config/friendchain.json',
            'src/config/friendchain.test.js',
            'src/config/gt2.json',
            'src/config/t.json',
            'src/config/test-api.json',
            'src/config/test.json',
            'src/config/wouldrather.json',
            'src/config/wouldrather.test.js',
            'src/modules/user/friend-credit-logic.test.js',
            'stories/077-one-course-path-forward/story.md',
            'scripts/lib/video-optimize-utils.js',
            'src/modules/courses/course-reference-guard.test.js',
            'src/modules/video/video-source.js',
            'stories/077-one-course-path-forward/story.md',
            'tests/friend-courses.spec.js',
            'tests/notifications.spec.js',
            'scripts/lib/video-optimize-utils.js',
            'src/modules/video/video-source.js',
            'tests/answer-flow.spec.js',
            'tests/e2e-smoke.spec.js',
            'tests/friend-courses.spec.js',
            'tests/friend-first-question-overlay.spec.js',
            'tests/friend-lesson-link.spec.js',
            'tests/friend-lesson-modals.spec.js',
            'tests/friend-video-only.spec.js',
            'tests/landscape-warning.spec.js',
            'tests/lesson-g-video.spec.js',
            'tests/playback-video.spec.js',
            'tests/poster-check.spec.js',
            'tests/profile-visitor-lessons.spec.js',
            'tests/recording-persistence.spec.js',
            'tests/regression-guard.spec.js',
            'tests/success-concat-button.spec.js',
            'tests/success-screen.spec.js',
            'tests/topic-pages.spec.js',
            'tests/whisper-page-cache-lifecycle.spec.js',
            'tests/whisper-review.spec.js',
            // Story 077 (one course path forward): the retired course configs
            // and their per-config tests, the stale Playwright specs, and the
            // specs retargeted at the two reference courses.
            'src/config/model.json',
            'docs/reviews/course-tags-review.md',
            's "start without a friend',
            'src/components/courses/WelcomePage.jsx',
            'src/components/courses/WelcomePageContainer.jsx',
            'src/components/courses/WelcomePage.test.jsx',
            'src/components/courses/TagPage.jsx',
            'src/components/courses/TagPageContainer.jsx',
            'src/components/courses/TagPage.test.jsx',
            'src/components/courses/CourseMissionDropdown.jsx',
            'src/modules/courses/course-tags-logic.js',
            'src/modules/courses/course-tags-logic.test.js',
            'src/modules/courses/course-tags-wiring.test.js',
            'src/modules/user/guest-modal-logic.js',
            'src/routes/WelcomeRoute.jsx',
            'src/routes/TagRoute.jsx',
            'src/components/homescreen/HomeLandingContainer.jsx',
            'src/components/homescreen/HomeLandingContainer.test.jsx',
            'tests/topic-pages.spec.js',
            // The topic pages: the guest modal is suppressed on them (they are
            // public routes), they adopt the browser language silently, and
            // their topics are localized (English word first).
            'src/hooks/use-guest-modal-guard.js',
            'src/hooks/use-guest-modal-guard-public-route.test.js',
            'src/modules/user/guest-modal-logic.test.js',
            'src/modules/courses/course-tag-labels.js',
            'src/modules/courses/course-tag-labels.test.js',
            'src/config/course-tags.test.js',
            // Story 081 (the in-app inbox refreshes itself).
            'stories/081-notification-live-refresh/story.md',
            'src/modules/api/api.js',
            'src/modules/api/api.notifications-refresh.test.js',
            'src/modules/notifications/notification-refresh-logic.js',
            'src/modules/notifications/notification-refresh-logic.test.js',
            'tests/notifications.spec.js',
            // Story 085 (the inbox opens by itself when a notification arrives).
            'stories/085-notification-panel-auto-opens/story.md',
            'src/components/homescreen/NotificationsBell.web.jsx',
            'src/components/homescreen/NotificationsBell.web.test.jsx',
            'src/modules/notifications/notification-logic.js',
            'src/modules/notifications/notification-logic.test.js',
            // The friend-response notification copy (the inbox row and the
            // push body share one string).
            'stories/019-notify-share-link-video-created/story.md',
            'src/modules/notifications/push-copy.test.js',
            'src/components/BilingualString.jsx',
            'src/components/courses/CourseTopicFilter.jsx',
            'src/components/courses/FriendCoursesView.jsx',
            'src/components/profile/FriendLessonLinksSection.jsx',
            'src/components/profile/PublicProfile.jsx',
            'src/components/profile/PublicProfile.test.jsx',
            'src/hooks/useFriendChainHeads.js',
            'src/modules/api/lesson-completion-migration.test.js',
            'src/modules/courses/course-tags-logic.js',
            'src/modules/courses/course-tags-logic.test.js',
            'src/modules/user/friend-lesson-link-logic.js',
            'src/modules/user/friend-lesson-link-logic.test.js',
            'src/modules/user/guest-modal-logic.js',
            'src/modules/user/guest-modal-logic.test.js',
            'src/modules/user/lesson-completion-write.test.js',
            'src/modules/user/user-profile.test.js',
            'stories/082-profile-counts-and-links/story.md',
            'supabase/migrations/012_record_lesson_completion.sql',
            'tests/topic-pages.spec.js',
            'src/components/PlaybackVideo.jsx',
            'src/components/courses/TagPage.jsx',
            'src/components/courses/TagPage.test.jsx',
            'src/components/courses/WelcomePage.jsx',
            'src/components/courses/WelcomePage.test.jsx',
            'src/components/layout/AppHeader.web.jsx',
            'src/components/profile/FriendLessonLinksSection.test.jsx',
            'src/config/course-tags.test.js',
            'src/hooks/use-guest-modal-guard-public-route.test.js',
            'src/hooks/use-guest-modal-guard.js',
            'src/modules/api/friend-link-write-migration.test.js',
            'src/modules/bilingual/config-normalizer.test.js',
            'src/modules/courses/course-tag-labels.js',
            'src/modules/courses/course-tag-labels.test.js',
            'src/modules/speech/capture-release-logic.js',
            'src/modules/speech/capture-release-logic.test.js',
            'src/modules/speech/capture-release-wiring.test.js',
            'src/modules/user/friend-lesson-link-wiring.test.js',
            'src/modules/video/audio-guard-wiring.test.js',
            'src/modules/video/video-processor-logic.js',
            'src/modules/video/video-processor-logic.test.js',
            'src/modules/video/video-processor.web.js',
            'src/routes/AppShellLayout.jsx',
            'src/routes/AuthLayout.jsx',
            'src/routes/NotFoundRoute.jsx',
            'src/routes/app-shell-header.test.jsx',
            'src/routes/not-found-routing.test.jsx',
            'src/routes/routes.jsx',
            'stories/075-fix-android-silent-video-start/story.md',
            'stories/078-record-friend-link-server-side/story.md',
            'stories/079-friend-video-key-inviter/story.md',
            'stories/080-profile-guest-note-plain-text/story.md',
            'stories/081-app-header-every-page/story.md',
            'supabase/migrations/011_record_friend_link.sql',
            'tests/playback-video-audio-guard.spec.js',
            'tests/profile-visitor-lessons.spec.js',
            // The topic drop-down on the course lists (/home and /courses).
            'src/components/BilingualString.jsx',
            'src/components/courses/CourseTopicFilter.jsx',
            'src/components/courses/FriendCoursesView.jsx',
            'src/components/courses/CourseListings.test.jsx',
            'src/modules/courses/course-tags-logic.js',
            'src/modules/courses/course-tags-logic.test.js',
            'src/modules/courses/friend-courses-logic.js',
            'src/modules/courses/friend-courses-logic.test.js',
            // The localized course names: the config shape, the helpers, the
            // display, the normalizer and the generator that writes them.
            'src/modules/bilingual/bilingual-logic.js',
            'src/modules/user/friend-lesson-link-logic.js',
            'src/components/courses/TagPage.jsx',
            'src/assets/css/app.css',
            'src/config/model.json',
            'src/config/wouldyourather.json',
            'src/config/wouldyourather-test.json',
            // The chain's addressing: a chain clip is addressed by its
            // recorder, so every hop of the friend chain resolves.
            'src/modules/bilingual/config-normalizer.js',
            'src/modules/bilingual/config-normalizer.test.js',
            'src/modules/courses/friend-clip-chain.test.js',
            'src/modules/video/video-processor-logic.js',
            'src/modules/video/video-processor-logic.test.js',
            'src/modules/video/video-processor.web.js',
            'stories/083-friend-clip-addressing/story.md',
            // The caption run must survive a course retirement (a deleted
            // config is not a changed config).
            '.github/scripts/captions-changed.sh',
            'scripts/generate-captions.test.js',
            'stories/084-caption-run-survives-course-retirement/story.md',
            'src/assets/css/app.css',
            'src/components/auth/auth-links.test.js',
            'src/components/courses/CourseListings.jsx',
            'src/components/courses/CourseListings.test.jsx',
            'src/components/courses/CourseTopicFilter.jsx',
            'src/components/courses/FriendCoursesView.jsx',
            'src/components/courses/TagPage.jsx',
            'src/components/courses/TagPage.test.jsx',
            'src/components/courses/WelcomePage.jsx',
            'src/components/friends/Friends.jsx',
            'src/components/homescreen/HomeLanding.jsx',
            'src/components/homescreen/NotificationList.web.jsx',
            'src/components/homescreen/home-landing.css',
            'src/components/homescreen/homepage-landing-wiring.test.js',
            'src/components/layout/AppHeader.web.jsx',
            'src/components/legal/LegalDocument.jsx',
            'src/components/legal/LegalFooter.jsx',
            'src/components/legal/LegalPage.jsx',
            'src/components/modals/CriticalErrorModal.jsx',
            'src/components/profile/FriendLessonLinksSection.jsx',
            'src/components/profile/FriendLessonLinksSection.test.jsx',
            'src/components/profile/PublicProfile.jsx',
            'src/components/profile/PublicProfile.test.jsx',
            'src/components/profile/UserProfile.jsx',
            'src/routes/NotFoundRoute.jsx',
            'src/routes/home-navigation-wiring.test.js',
            // A dead course/lesson link (a retired course, a lesson id the
            // regenerated config no longer has) is a 404, not a technical
            // error: the shared not-found card, the pure rules that tell the
            // two apart, and the wiring that renders it.
            'src/components/NotFoundPage.jsx',
            'src/hooks/use-initialize-lesson-webonly.js',
            'src/modules/lesson/lesson-not-found-logic.js',
            'src/modules/lesson/lesson-not-found-logic.test.js',
            'src/modules/lesson/lesson-not-found-wiring.test.js',
            'src/routes/AppLayout.jsx',
            'tests/dead-lesson-link.spec.js',
            // An in-app link must stay on the host the page is served from: the
            // profile's lesson link was hard-coded to the apex, so every click
            // navigated the visitor off-site (a webview wrapper refuses a
            // cross-origin navigation outright).
            'src/modules/user/current-site-origin.webonly.js',
            'src/modules/user/current-site-origin.webonly.test.js',
            'src/components/profile/FriendLessonLinksSection.jsx',
            'src/components/profile/FriendLessonLinksSection.test.jsx',
            'src/components/homescreen/NotificationList.web.jsx',
            'src/components/homescreen/NotificationList.web.test.js',
            'src/modules/notifications/notification-logic.js',
            'src/modules/notifications/notification-logic.test.js',
            'src/modules/user/friend-lesson-link-wiring.test.js',
            'tests/friend-lesson-link.spec.js',
            // The profile's lesson link is a client-side navigation now (a
            // document load was the only thing in the app that could end in a
            // browser-level "This site can't be reached" page), so the share
            // code has to be captured on every location change.
            'src/App.jsx',
            'src/routes/RootLayout.jsx',
            'src/hooks/use-share-code.js',
            'src/hooks/use-share-code.test.jsx',
            'tests/notifications.spec.js',
            // Main's badge test mocks react-router-dom; the friend-practice
            // link is a <Link>, so the mock has to provide it.
            'src/components/profile/PublicProfile.test.jsx',
            // The two specs that were red on main (the removed back button and
            // the unreachable interactive phase in the generated course).
            'src/components/courses/CourseListings.jsx',
            'src/components/courses/CourseListingsContainer.jsx',
            'src/components/courses/CourseListings.test.jsx',
            'tests/friend-courses.spec.js',
            'tests/friend-first-question-overlay.spec.js',
            // Story 086 (Continue gated on the clip upload).
            'stories/086-gate-continue-button-on-upload/story.md',
            'src/modules/lesson/success-continue-logic.js',
            'src/modules/lesson/success-continue-logic.test.js',
            'src/components/widgets/SuccessButtons.jsx',
            'src/components/widgets/SuccessButtons.test.jsx',
            'src/components/widgets/clips-uploading-warning-wiring.test.js',
            'tests/success-concat-button.spec.js',
            // Pair-scoped "completed it together" ledger: a lesson done with
            // one friend must not badge on another friend's profile.
            'supabase/migrations/013_add_friend_completions.sql',
            'src/modules/api/friend-completions-migration.test.js',
            'src/modules/api/friend-completions-read.test.js',
            // Story 087: a capture with no audio (a connected Bluetooth input
            // delivered no frames) is reported and retried instead of being
            // sent to Whisper, and a transcription can never hang forever.
            'stories/087-no-audio-capture/story.md',
            'src/modules/speech/speech.core.js',
            'src/modules/speech/speech.core.test.js',
            'src/modules/speech/speech-orchestrator.js',
            'src/modules/speech/speech-orchestrator-no-audio.test.js',
            'src/modules/speech/no-audio-wiring.test.js',
            'src/workers/whisper/app-vad-asr-web.js',
            'src/workers/whisper/app-vad-asr-web.test.js',
            'src/modules/lesson/step-executor-webonly.js',
            'src/modules/lesson/no-audio-recovery-logic.js',
            'src/modules/lesson/no-audio-recovery-logic.test.js',
            'src/components/widgets/MicStatusText.jsx',
            'src/data/strings.js',
            'src/data/strings.test.js',
            'src/modules/speech/audio-resample-logic.js',
            'src/modules/speech/audio-resample-logic.test.js',
            // Friend-response walkthrough tutorial: a real screen recording of
            // lesson A's first friend-response step, replacing the text-on-screen
            // placeholder for tutorial-friendClosedResponse.mp4.
            'scripts/record-tutorial-walkthrough.mjs',
            'scripts/record-tutorial-walkthrough.test.js',
        ];
        for (const file of tracked) {
            expect(allowlist, file).toContain(file);
        }
        const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
        const untracked = porcelain.split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());
        expect(untracked).toEqual([]);
    });

    it('flags a stray untracked file instead of passing vacuously', () => {
        // git diff misses untracked files by design; the status assertion
        // above must catch them. Prove it with a real probe file (removed
        // afterwards so no other guard ever sees it).
        const probe = path.join(REPO_ROOT, '.probe-untracked-tmp');
        fs.writeFileSync(probe, 'x');
        try {
            const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
            const untracked = porcelain.split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());
            expect(untracked).toContain('.probe-untracked-tmp');
            expect(() => expect(untracked).toEqual([])).toThrow();
        } finally {
            fs.rmSync(probe, { force: true });
        }
    });
});

// Story 066, Task 3 AC5: the new page code stays vendored-style (var/function,
// existing seams, no modules) — pinned over raw-text slices, each proven
// failable by injection.
describe('recorder auto-render — vendored-style source guard', () => {
    const page = () => fs.readFileSync(PAGE_PATH, 'utf8');
    const sliceBetween = (text, startMarker, endMarker) => {
        const start = text.indexOf(startMarker);
        if (start === -1) throw new Error('slice start not found: ' + startMarker);
        const end = text.indexOf(endMarker, start + startMarker.length);
        if (end === -1) throw new Error('slice end not found: ' + endMarker);
        return text.slice(start, end);
    };

    it('checkbox markup carries the default-on box and its label', () => {
        const slice = sliceBetween(page(), 'id="dom-check-auto-render"', '</div>');
        expect(slice).toContain('checked');
        expect(slice).toContain('auto-render finished lessons');
    });

    it('maybeAutoRenderLesson uses the existing seams and no modules', () => {
        const slice = sliceBetween(page(), 'function maybeAutoRenderLesson', 'node_btn_accept.onclick = function()');
        expect(slice).toContain('appCoreLog');
        expect(slice).toContain('getOperatorKey');
        expect(slice).not.toContain('import');
        expect(slice).not.toContain('require(');
    });

    it('poller uses the status contract with no modules', () => {
        const slice = sliceBetween(page(), 'function pollOneRenderJob', 'function pollRenderStatus');
        expect(slice).toContain('/api/pipeline/status');
        expect(slice).toContain('getOperatorKey');
        expect(slice).toContain('pollUnfinishedRenderJobs');
        expect(slice).not.toContain('import');
        expect(slice).not.toContain('require(');
    });

    it('each style pin fails when mutated', () => {
        const html = page();
        const box = sliceBetween(html, 'id="dom-check-auto-render"', '</div>');
        expect(() => {
            // Delete the attribute (replacing with a same-length word keeps a
            // substring trap: 'unchecked' still contains 'checked').
            expect(box.split('checked').join('')).toContain('checked');
        }).toThrow();
        const fn = sliceBetween(html, 'function maybeAutoRenderLesson', 'node_btn_accept.onclick = function()');
        for (const injected of ['\nimport evil from "x";\n', '\nconst x = require("y");\n']) {
            expect(() => {
                expect(fn + injected).not.toContain('import');
                expect(fn + injected).not.toContain('require(');
            }, injected).toThrow();
        }
    });
});

// Story 066, Task 5 AC1: the product entry exists in the shipped format.
describe('story 066 product entry', () => {
    const PRODUCT = path.join(REPO_ROOT, 'docs/product.md');
    it('documents lesson-level auto-render with the story link', () => {
        const product = fs.readFileSync(PRODUCT, 'utf8');
        expect(product).toContain('Lesson-level auto-render in the recorder');
        expect(product).toContain('stories/066-recorder-auto-render-lessons/story.md');
    });

    it('the guard fails when the entry is removed', () => {
        const product = fs.readFileSync(PRODUCT, 'utf8');
        const mutated = product
            .split('Lesson-level auto-render in the recorder').join('REMOVED')
            .split('stories/066-recorder-auto-render-lessons/story.md').join('REMOVED');
        expect(mutated).not.toContain('Lesson-level auto-render in the recorder');
        expect(mutated).not.toContain('stories/066-recorder-auto-render-lessons/story.md');
        expect(() => {
            expect(mutated).toContain('Lesson-level auto-render in the recorder');
            expect(mutated).toContain('stories/066-recorder-auto-render-lessons/story.md');
        }).toThrow();
    });
});
