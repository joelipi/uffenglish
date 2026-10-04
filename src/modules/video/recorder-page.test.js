// Guard: the operator-only recording studio (public/recorder.html) is vendored
// static HTML kept deliberately unlinked from the React app so end users never
// reach it. This test proves the page is present and self-contained, that it
// declares noindex, and that nothing on the end-user app surface (src/** and
// index.html) references it. If someone later wires it into the app UI, this
// fails on purpose — the studio is meant to stay reachable only by its URL.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGE_REL = 'public/recorder.html';
const PAGE_PATH = path.join(REPO_ROOT, PAGE_REL);
const PAGE_URL_PATH = '/recorder.html'; // public/ is served from the site root
const HEADERS_PATH = path.join(REPO_ROOT, 'public/_headers');
const INDEX_PATH = path.join(REPO_ROOT, 'index.html');
const SELF = fileURLToPath(import.meta.url);
const TOKEN = 'recorder.html';

const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.html', '.json']);

function scanDirForToken(dir, token, exclude = new Set()) {
    const hits = [];
    const walk = (current) => {
        let entries;
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!TEXT_EXTENSIONS.has(path.extname(entry.name)) || exclude.has(full)) continue;
            let content;
            try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
            if (content.includes(token)) hits.push(full);
        }
    };
    walk(dir);
    return hits;
}

describe('operator-only recorder page stays hidden', () => {
    it('detects a link in the app surface (guard is functional)', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uff-recorder-guard-'));
        const nested = path.join(tmp, 'components');
        fs.mkdirSync(nested, { recursive: true });
        const linked = path.join(nested, 'nav.jsx');
        fs.writeFileSync(linked, '<a href="/recorder.html">Studio</a>');
        try {
            expect(scanDirForToken(tmp, TOKEN)).toContain(linked);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('ships the recorder as a self-contained static page', () => {
        const page = fs.readFileSync(PAGE_PATH, 'utf8');
        expect(page).toContain('id="dom-btn-record"');
        expect(page).toContain('new MediaRecorder(');
        expect(page).toContain('navigator.mediaDevices.getUserMedia(');
    });

    it('declares noindex on the page and in deploy headers', () => {
        expect(fs.readFileSync(PAGE_PATH, 'utf8')).toContain(
            '<meta name="robots" content="noindex, nofollow">'
        );

        const headers = fs.readFileSync(HEADERS_PATH, 'utf8');
        const start = headers.indexOf(PAGE_URL_PATH);
        expect(start).toBeGreaterThanOrEqual(0);
        const nextRule = headers.indexOf('\n\n', start);
        const block = headers.slice(start, nextRule === -1 ? headers.length : nextRule);
        expect(block).toContain('X-Robots-Tag: noindex, nofollow');
    });

    it('is not referenced anywhere on the end-user app surface', () => {
        expect(scanDirForToken(path.join(REPO_ROOT, 'src'), TOKEN, new Set([SELF]))).toEqual([]);
        expect(fs.readFileSync(INDEX_PATH, 'utf8')).not.toContain(TOKEN);
    });
});
