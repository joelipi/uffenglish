// scripts/ci-triggers.test.js
// Guards the CI-cost policy (the Actions budget was exhausted by routine
// pushes): the heavy workflows must not run on every branch push.
//   - playwright.yml is manual only (run `npx playwright test` locally);
//   - deploy.yml runs on `main` only and no longer re-runs the unit tests
//     (run `npm test` locally);
//   - captions.yml runs on `main` only.
// Each assertion is proven failable by mutation.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

    it('captions.yml runs on main only', () => {
        assertCaptionsMainOnly(read('captions.yml'));
    });

    it('each guard can fail on the forbidden trigger/step', () => {
        const pw = read('playwright.yml');
        expect(() => assertPlaywrightManual('on:\n  push:\n    branches: [main]\n' + pw)).toThrow();
        const dep = read('deploy.yml');
        expect(() => assertDeployMainOnly(dep.replace('branches: [main]', "branches: ['**']"))).toThrow();
        expect(() => assertDeployMainOnly(dep + '\n      - name: Run unit tests\n        run: npm test\n')).toThrow();
        const cap = read('captions.yml');
        expect(() => assertCaptionsMainOnly(cap.replace('branches: [main]', "branches: ['**']"))).toThrow();
    });
});
