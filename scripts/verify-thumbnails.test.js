// scripts/verify-thumbnails.test.js
// R2 poster verifier wiring and run (stories/011-auto-intro-poster, Task 5).
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/verify-thumbnails.mjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');

function runCli(args = [], env = {}) {
    return new Promise((resolve) => {
        execFile('node', [SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
            resolve({ code: err ? err.code : 0, stdout, stderr });
        });
    });
}

// Serve a fake R2 so the verifier's run is deterministic (no live network) and
// so strict-miss behaviour can actually be exercised.
function withFakeR2(status, fn) {
    return new Promise((resolve, reject) => {
        const server = createServer((_req, res) => {
            res.writeHead(status, { 'content-type': 'image/jpeg' });
            res.end(status === 200 ? 'jpeg' : '');
        });
        server.listen(0, '127.0.0.1', async () => {
            const base = `http://127.0.0.1:${server.address().port}/assets/videos/`;
            try {
                resolve(await fn(base));
            } catch (e) {
                reject(e);
            } finally {
                server.close();
            }
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

    it('gates on the R2 poster only, not the retired LQIP module', () => {
        // The LQIP module was a CI-built artifact; the render owns posters now,
        // so the verifier must not fail on an LQIP entry nothing regenerates.
        expect(SOURCE).not.toMatch(/poster-lqips/);
        expect(SOURCE).not.toMatch(/MISSING LQIP/);
    });

    it('treats a missing R2 poster as fatal (gate, not advisory)', () => {
        expect(SOURCE).not.toMatch(/non-fatal/);
        expect(SOURCE).toMatch(/R2 missing/);
        expect(SOURCE).toMatch(/process\.exit\(1\)/);
    });
});

describe('verify-thumbnails.mjs run', () => {
    it('exits 0 and reports every intro slug when every poster is present', async () => {
        const { code, stdout } = await withFakeR2(200, (base) =>
            runCli([], { POSTER_CDN_BASE: base }));
        expect(code).toBe(0);
        expect(stdout).toContain('7 intro slugs');
    }, 120000);

    it('exits non-zero when an R2 poster is missing', async () => {
        const { code, stderr } = await withFakeR2(404, (base) =>
            runCli([], { POSTER_CDN_BASE: base }));
        expect(code).toBe(1);
        expect(stderr).toMatch(/R2 missing/);
    }, 120000);
});

describe('poster documentation', () => {
    it('README documents uniform R2-only <video>.jpg posters', () => {
        const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
        expect(readme).toMatch(/\.mp4`?→`?\.jpg|\.mp4.*\.jpg/);
        expect(readme).toMatch(/Modal render/);
        expect(readme).toMatch(/UGC friend clips upload their sibling/);
        expect(readme).toMatch(/never committed|No poster is committed/);
        expect(readme).toMatch(/served locally/);
    });

    it('agents.md names the render as the poster source and keeps posters out of git', () => {
        const agents = readFileSync(path.join(ROOT, 'agents.md'), 'utf8');
        expect(agents).toMatch(/Modal render/);
        // The old claim (deploy.yml builds posters on every push) must be gone.
        expect(agents).not.toMatch(/uploaded to R2[^.]*on every push/i);
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
