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
