// Regression guard: the mock video generator (scripts/generate-mock-videos.mjs)
// was deleted because its `--upload` path overwrote real teacher recordings on
// R2 (wrangler r2 object put overwrites unconditionally). This test ensures the
// generator stays gone, that no source/doc reference to it sneaks back in, and
// that no video files are ever committed (they live on R2 and are too large for
// git). Historical story docs under stories/** are excluded — they are dated
// records.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GENERATOR_PATH = path.join(REPO_ROOT, 'scripts/generate-mock-videos.mjs');
const TOKEN = 'generate-mock-videos';

const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.jsonc', '.md', '.markdown', '.yml', '.yaml', '.toml', '.html', '.css', '.txt']);
const TEXT_FILENAMES = new Set(['.gitignore', '.env.example']);

function isTextFile(name) {
    return TEXT_EXTENSIONS.has(path.extname(name)) || TEXT_FILENAMES.has(name);
}

function listTrackedFiles(root) {
    return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
}

// Walk-based scan for arbitrary directories (used by the fixture meta-test).
function scanForToken(root, token) {
    const hits = [];
    const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!isTextFile(entry.name)) continue;
            let content;
            try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
            if (content.includes(token)) hits.push(full);
        }
    };
    walk(root);
    return hits;
}

// Git-tracked scan for the repo: only committed files are inspected, so
// untracked local scratch files can never fail the guard.
function scanTrackedForToken(root, token) {
    const self = fileURLToPath(import.meta.url);
    const hits = [];
    for (const rel of listTrackedFiles(root)) {
        if (rel.startsWith('stories/')) continue;
        const full = path.join(root, rel);
        if (full === self) continue;
        if (!isTextFile(rel)) continue;
        let content;
        try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
        if (content.includes(token)) hits.push(rel);
    }
    return hits;
}

describe('mock video generator removal', () => {
    it('detects a lingering reference (guard is functional)', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uff-mock-guard-'));
        const docs = path.join(tmp, 'docs');
        fs.mkdirSync(docs, { recursive: true });
        const ref = path.join(docs, 'ref.md');
        fs.writeFileSync(ref, `run ${TOKEN} --upload`);
        try {
            const hits = scanForToken(tmp, TOKEN);
            expect(hits).toContain(ref);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('leaves no references to the mock generator in tracked files', () => {
        expect(scanTrackedForToken(REPO_ROOT, TOKEN)).toEqual([]);
    });

    it('deletes the mock generator script', () => {
        expect(fs.existsSync(GENERATOR_PATH)).toBe(false);
    });

    it('keeps videos gitignored with only the generic rule', () => {
        const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
        const mp4Lines = gitignore.split('\n').filter((line) => line.includes('.mp4') && !line.trim().startsWith('#'));
        expect(mp4Lines).toEqual(['public/assets/videos/*.mp4']);
    });

    it('tracks no video files (media lives on R2)', () => {
        expect(listTrackedFiles(REPO_ROOT).filter((f) => /\.mp4$/i.test(f))).toEqual([]);
    });

    it('has no mock npm script', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
        const scripts = pkg.scripts || {};
        expect(Object.keys(scripts).some((k) => /mock/i.test(k))).toBe(false);
        expect(Object.values(scripts).some((v) => /mock/i.test(String(v)))).toBe(false);
    });
});