// Regression guard: the mock video generator (scripts/generate-mock-videos.mjs)
// was deleted because its `--upload` path overwrote real teacher recordings on
// R2 (wrangler r2 object put overwrites unconditionally). This test ensures the
// generator stays gone and that no source/doc reference to it sneaks back in.
// Historical story docs under stories/** are excluded — they are dated records.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GENERATOR_PATH = path.join(REPO_ROOT, 'scripts/generate-mock-videos.mjs');
const TOKEN = 'generate-mock-videos';

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'stories', '.wrangler', 'coverage', 'test-results']);
const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.jsonc', '.md', '.markdown', '.yml', '.yaml', '.toml', '.html', '.css', '.txt']);
const TEXT_FILENAMES = new Set(['.gitignore', '.env.example']);

// Recursively find text files under `root` whose content contains `token`.
// Skips EXCLUDED_DIRS at any depth, non-text files, unreadable files, and
// (optionally) the guard file itself.
function scanForToken(root, token, { excludeSelf = null } = {}) {
    const hits = [];
    const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (EXCLUDED_DIRS.has(entry.name)) continue;
                walk(full);
                continue;
            }
            if (excludeSelf && full === excludeSelf) continue;
            const ext = path.extname(entry.name);
            if (!TEXT_EXTENSIONS.has(ext) && !TEXT_FILENAMES.has(entry.name)) continue;
            let content;
            try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
            if (content.includes(token)) hits.push(full);
        }
    };
    walk(root);
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

    it('leaves no references to the mock generator in the repo', () => {
        const self = fileURLToPath(import.meta.url);
        const hits = scanForToken(REPO_ROOT, TOKEN, { excludeSelf: self });
        expect(hits).toEqual([]);
    });

    it('deletes the mock generator script', () => {
        expect(fs.existsSync(GENERATOR_PATH)).toBe(false);
    });

    it('keeps videos gitignored without mock-specific entries', () => {
        const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
        expect(gitignore).toContain('public/assets/videos/*.mp4');
        const specificMockEntry = gitignore.split('\n').some((line) => /(?:gtests|testvideo|do_you_have|success)\S*\.mp4/.test(line));
        expect(specificMockEntry).toBe(false);
    });

    it('has no mock npm script', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
        const scripts = pkg.scripts || {};
        expect(Object.keys(scripts).some((k) => /mock/i.test(k))).toBe(false);
        expect(Object.values(scripts).some((v) => /mock/i.test(String(v)))).toBe(false);
    });
});