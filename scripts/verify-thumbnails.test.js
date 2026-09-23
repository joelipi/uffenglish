// scripts/verify-thumbnails.test.js
// R2 poster verifier wiring and run (stories/011-auto-intro-poster, Task 5).
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/verify-thumbnails.mjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');

function runCli(args = []) {
    return new Promise((resolve) => {
        execFile('node', [SCRIPT, ...args], { cwd: ROOT }, (err, stdout, stderr) => {
            resolve({ code: err ? err.code : 0, stdout, stderr });
        });
    });
}

describe('verify-thumbnails.mjs source', () => {
    it('imports introTargets from ./lib/poster-utils.js', () => {
        expect(SOURCE).toContain("from './lib/poster-utils.js'");
        expect(SOURCE).toContain('introTargets');
    });

    it('checks the R2 slug sibling for every intro slug', () => {
        expect(SOURCE).toContain('https://r2.ultrafastfluency.com/assets/videos/');
        expect(SOURCE).toMatch(/posterFilename\(slug\)/);
        expect(SOURCE).toMatch(/method:\s*'HEAD'/);
    });

    it('no longer reads local public/assets/posters', () => {
        expect(SOURCE).not.toMatch(/public\/assets\/posters/);
    });
});

describe('verify-thumbnails.mjs run', () => {
    it('exits 0 and reports the five intro slugs', async () => {
        const { code, stdout } = await runCli();
        expect(code).toBe(0);
        expect(stdout).toContain('5 intro slugs');
    }, 120000);
});

describe('poster documentation', () => {
    it('README documents uniform R2-only <video>.jpg posters', () => {
        const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
        expect(readme).toMatch(/\.mp4`?→`?\.jpg|\.mp4.*\.jpg/);
        expect(readme).toContain('deploy.yml');
        expect(readme).toMatch(/UGC friend clips upload their sibling/);
        expect(readme).toMatch(/never committed|No poster is committed/);
        expect(readme).toMatch(/served locally/);
    });

    it('agents.md states posters are generated/uploaded on push and never committed locally', () => {
        const agents = readFileSync(path.join(ROOT, 'agents.md'), 'utf8');
        expect(agents).toMatch(/uploaded to R2.*on every push/is);
        expect(agents).toMatch(/never committed locally/i);
    });

    it('docs/product.md describes R2-only posters in Features and Known Limitations', () => {
        const product = readFileSync(path.join(ROOT, 'docs/product.md'), 'utf8');
        expect(product).toContain('stories/011-auto-intro-poster/story.md');
        expect(product).toMatch(/Uniform R2-only video posters/);
        // Known Limitations bullet.
        const limitations = product.slice(product.indexOf('## Known Limitations'));
        expect(limitations).toMatch(/poster/i);
        expect(limitations).toMatch(/R2-only|R2 only/);
    });
});
