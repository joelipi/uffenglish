// Story 041, Task 7: the client never constructs or references a public raw
// URL. Raw takes/status markers/pipeline assets live in the private bucket, so
// r2.ultrafastfluency.com/raw must not appear on the client surface. The
// operator recorder uploads via POST /api/pipeline/upload-raw and polls
// GET /api/pipeline/status — same-origin, operator-key gated — and never knows
// a raw object's URL.
//
// The scan helper is exercised against a temporary fixture (guard can fail), per
// AGENTS.md. URL assertions run on the raw source (no comment stripping: `/\/\/.*$/`
// would read the `//` in `https://` as a comment and erase the URL).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const INDEX_PATH = path.join(REPO_ROOT, 'index.html');
const RECORDER_PATH = path.join(REPO_ROOT, 'public', 'recorder' + '.html');
const VIDEO_URL_PATH = path.join(SRC_DIR, 'modules/video/video-url.js');
const SELF = fileURLToPath(import.meta.url);

// A public CDN URL for a raw take. Keep the token in one place so the positive
// fixture and the real scan exercise the identical rule.
const RAW_CDN_PATTERN = /r2\.ultrafastfluency\.com\/raw/;
const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.html', '.json']);

function scanDirForPattern(root, pattern, exclude = new Set()) {
    let scanned = 0;
    const hits = [];
    const walk = (dir) => {
        // Not swallowed: an unreadable tree must fail the guard, not make
        // "no hits" pass vacuously.
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
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

describe('client never constructs a raw URL', () => {
    it('detects the forbidden token in a fixture (guard is functional)', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uff-raw-guard-'));
        const nested = path.join(tmp, 'components');
        fs.mkdirSync(nested, { recursive: true });
        const bad = path.join(nested, 'player.js');
        fs.writeFileSync(bad, "const u = 'https://r2.ultrafastfluency.com/raw/x.mp4';");
        const good = path.join(nested, 'ok.js');
        fs.writeFileSync(good, "const u = 'https://r2.ultrafastfluency.com/videos/ok.mp4';");
        try {
            const { hits, scanned } = scanDirForPattern(tmp, RAW_CDN_PATTERN);
            expect(scanned).toBeGreaterThan(0);
            expect(hits).toContain(bad);
            expect(hits).not.toContain(good);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('has no r2.ultrafastfluency.com/raw reference anywhere on the client surface', () => {
        const src = scanDirForPattern(SRC_DIR, RAW_CDN_PATTERN, new Set([SELF]));
        expect(src.scanned).toBeGreaterThan(0);
        expect(src.hits).toEqual([]);
        expect(fs.readFileSync(INDEX_PATH, 'utf8')).not.toMatch(RAW_CDN_PATTERN);
        // The vendored static studio page is not JS, so scan it explicitly.
        expect(fs.readFileSync(RECORDER_PATH, 'utf8')).not.toMatch(RAW_CDN_PATTERN);
    });

    it('recorder uploads/polls same-origin and never names the CDN', () => {
        const html = fs.readFileSync(RECORDER_PATH, 'utf8');
        expect(html).toContain("'/api/pipeline/upload-raw'");
        expect(html).toContain("'/api/pipeline/status'");
        expect(html).not.toContain('r2.ultrafastfluency.com');
    });

    it('video-url.js builds only assets/videos/ and videos/ URLs', () => {
        const src = fs.readFileSync(VIDEO_URL_PATH, 'utf8');
        expect(src).toContain('https://r2.ultrafastfluency.com/assets/videos/');
        expect(src).toContain('https://r2.ultrafastfluency.com/videos/');
        expect(src).not.toMatch(/raw\//);
        expect(src).not.toMatch(RAW_CDN_PATTERN);
    });

    it('no client module consumes rawTakeKey/statusKey (raw routing is server-side)', () => {
        // The key module defines them and its unit test exercises them; no other
        // client module may import/use them, which would let it build a raw URL.
        const DEFINERS = new Set([
            path.join(SRC_DIR, 'modules/video/pipeline-keys.js'),
            path.join(SRC_DIR, 'modules/video/pipeline-keys.test.js'),
            SELF,
        ]);
        const hits = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!TEXT_EXTENSIONS.has(path.extname(entry.name)) || DEFINERS.has(full)) continue;
                const content = fs.readFileSync(full, 'utf8');
                if (/\b(rawTakeKey|statusKey)\b/.test(content)) hits.push(full);
            }
        };
        walk(SRC_DIR);
        expect(hits).toEqual([]);
    });
});
