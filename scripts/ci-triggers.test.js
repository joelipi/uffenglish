// scripts/ci-triggers.test.js
// Guards the CI-cost policy (the Actions budget was exhausted by routine
// pushes): the heavy workflows must not run on every branch push.
//   - playwright.yml is manual only (run `npx playwright test` locally);
//   - deploy.yml runs on `main` only and no longer re-runs the unit tests
//     (run `npm test` locally);
//   - deploy.yml no longer regenerates posters: the Modal render writes
//     `assets/videos/<slug>.jpg` for every slug it publishes, so the old
//     ffmpeg + generate/upload/verify steps only slowed the deploy;
//   - captions.yml runs on `main` only.
// Each assertion is proven failable by mutation.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobBlock } from './lib/workflow-guard-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');

function assertPlaywrightManual(text) {
    expect(text).toContain('workflow_dispatch:');
    expect(text).not.toMatch(/^\s*push:/m);
    expect(text).not.toMatch(/^\s*pull_request:/m);
}

function assertDeployMainOnly(text) {
    expect(text).toContain('branches: [main]');
    expect(text).not.toContain("branches: ['**']");
    expect(text).toContain('workflow_dispatch:');
    expect(text).not.toContain('Run unit tests');
}

// Posters come from the render (`modal_app._publish` uploads the slug's
// `.jpg`), never from the deploy: the render already holds the video, so CI
// re-downloading it only added ffmpeg + minutes to every deploy.
function assertDeployPostersOffDeployPath(text) {
    // Scope to the job's steps: the file header may *document* that posters are
    // off the deploy path, but no step may run the poster scripts.
    const job = jobBlock(text, 'deploy', 'deploy.yml');
    expect(job).not.toMatch(/generate-thumbnails/);
    expect(job).not.toMatch(/verify-thumbnails/);
    expect(job).not.toMatch(/apt-get install -y ffmpeg/);
}

function assertCaptionsMainOnly(text) {
    expect(text).toContain('branches: [main]');
    expect(text).not.toContain("branches: ['**']");
}

describe('CI triggers stay off the per-branch push path', () => {
    it('playwright.yml is manual only', () => {
        assertPlaywrightManual(read('playwright.yml'));
    });

    it('deploy.yml runs on main only and skips the unit tests', () => {
        assertDeployMainOnly(read('deploy.yml'));
    });

    it('deploy.yml leaves posters to the render', () => {
        assertDeployPostersOffDeployPath(read('deploy.yml'));
    });

    it('captions.yml runs on main only', () => {
        assertCaptionsMainOnly(read('captions.yml'));
    });

    it('each guard can fail on the forbidden trigger/step', () => {
        const pw = read('playwright.yml');
        expect(() => assertPlaywrightManual('on:\n  push:\n    branches: [main]\n' + pw)).toThrow();
        const dep = read('deploy.yml');
        expect(() => assertDeployMainOnly(dep.replace('branches: [main]', "branches: ['**']"))).toThrow();
        expect(() => assertDeployMainOnly(dep + '\n      - name: Run unit tests\n        run: npm test\n')).toThrow();
        expect(() => assertDeployPostersOffDeployPath(
            dep + '\n      - name: Generate posters\n        run: node scripts/generate-thumbnails.mjs\n',
        )).toThrow();
        const cap = read('captions.yml');
        expect(() => assertCaptionsMainOnly(cap.replace('branches: [main]', "branches: ['**']"))).toThrow();
    });
});
