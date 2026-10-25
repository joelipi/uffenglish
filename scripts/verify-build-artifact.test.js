// Tests for the build-artifact verifier (stories/096).
//
// The verifier exists because a dev-mode bundle shipped twice as a preview. These
// tests build fixture dist directories (production-shaped / dev-shaped / broken)
// and assert the verdict, plus run the CLI as a subprocess so the `invokedDirectly`
// guard is exercised.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    FORBIDDEN_MARKER,
    REQUIRED_MARKER,
    verifyBuildArtifact,
} from './verify-build-artifact.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'verify-build-artifact.mjs');

let dir;

function makeDist({ indexHtml, chunkName = 'assets/main-abc123.js', chunk = null }) {
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    if (indexHtml !== null) fs.writeFileSync(path.join(dir, 'index.html'), indexHtml);
    if (chunk !== null) fs.writeFileSync(path.join(dir, chunkName), chunk);
    return dir;
}

const PROD_CHUNK = `const base="${REQUIRED_MARKER}";function getVideoUrl(slug){return base+slug+".mp4"}`;
const DEV_CHUNK = 'function getVideoUrl(e){return e?`/assets/videos/${e}.mp4`:``}';

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uff-artifact-'));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('verifyBuildArtifact', () => {
    it('accepts a production-shaped artifact', () => {
        makeDist({ indexHtml: '<script type="module" src="/assets/main-abc123.js"></script>', chunk: PROD_CHUNK });
        const result = verifyBuildArtifact({ distDir: dir });
        expect(result.ok).toBe(true);
        expect(result.problems).toEqual([]);
        expect(result.chunk).toBe('assets/main-abc123.js');
    });

    it('rejects a dev-mode artifact and names both facts', () => {
        makeDist({ indexHtml: '<script src="/assets/main-abc123.js"></script>', chunk: DEV_CHUNK });
        const result = verifyBuildArtifact({ distDir: dir });
        expect(result.ok).toBe(false);
        const text = result.problems.join(' ');
        expect(text).toContain(REQUIRED_MARKER);
        expect(text).toContain(FORBIDDEN_MARKER);
    });

    it('rejects a chunk that has the dev template even if it also has the base', () => {
        makeDist({
            indexHtml: '<script src="/assets/main-abc123.js"></script>',
            chunk: `${PROD_CHUNK}\n${DEV_CHUNK}`,
        });
        const result = verifyBuildArtifact({ distDir: dir });
        expect(result.ok).toBe(false);
        expect(result.problems.join(' ')).toContain(FORBIDDEN_MARKER);
    });

    it('rejects a missing index.html', () => {
        makeDist({ indexHtml: null, chunk: PROD_CHUNK });
        const result = verifyBuildArtifact({ distDir: dir });
        expect(result.ok).toBe(false);
        expect(result.problems.join(' ')).toContain('missing');
    });

    it('rejects an index.html with no main chunk', () => {
        makeDist({ indexHtml: '<html><body>no scripts</body></html>' });
        const result = verifyBuildArtifact({ distDir: dir });
        expect(result.ok).toBe(false);
        expect(result.problems.join(' ')).toContain('no assets/main');
    });

    it('rejects an index.html that names a chunk which does not exist', () => {
        makeDist({ indexHtml: '<script src="/assets/main-abc123.js"></script>', chunk: null });
        const result = verifyBuildArtifact({ distDir: dir });
        expect(result.ok).toBe(false);
        expect(result.problems.join(' ')).toContain('cannot be read');
    });

    it('rejects a missing distDir argument', () => {
        expect(verifyBuildArtifact({}).ok).toBe(false);
    });
});

describe('the CLI fails the build', () => {
    it('exits 1 and explains on a dev-mode artifact', () => {
        makeDist({ indexHtml: '<script src="/assets/main-abc123.js"></script>', chunk: DEV_CHUNK });
        let error = null;
        try {
            execFileSync(process.execPath, [SCRIPT, '--dist', dir], { encoding: 'utf8', stdio: 'pipe' });
        } catch (e) {
            error = e;
        }
        expect(error).not.toBeNull();
        expect(error.status).toBe(1);
        expect(`${error.stderr}`).toContain('NOT shippable');
        expect(`${error.stderr}`).toContain(REQUIRED_MARKER);
    });

    it('exits 0 on a production artifact', () => {
        makeDist({ indexHtml: '<script src="/assets/main-abc123.js"></script>', chunk: PROD_CHUNK });
        const out = execFileSync(process.execPath, [SCRIPT, '--dist', dir], { encoding: 'utf8' });
        expect(out).toContain('production artifact OK');
    });
});

describe('the build script runs the verifier', () => {
    it('package.json wires it into `npm run build` after vite build', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        expect(pkg.scripts.build).toContain('vite build');
        expect(pkg.scripts.build).toContain('verify-build-artifact.mjs');
        expect(pkg.scripts.build.indexOf('vite build'))
            .toBeLessThan(pkg.scripts.build.indexOf('verify-build-artifact.mjs'));
    });
});
