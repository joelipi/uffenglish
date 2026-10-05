// scripts/configs-workflow.test.js
// Story 046: source guard for .github/workflows/configs.yml. The Action is the
// only thing that commits generated configs, so its shape (triggers, bot token,
// loop guard, --check, skip reporting, diff-only commit, no --force) is pinned.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/configs.yml');

const read = () => readFileSync(WORKFLOW, 'utf8');

describe('configs.yml source guard', () => {
    it('accepts both workflow_dispatch and repository_dispatch', () => {
        const text = read();
        expect(text).toContain('workflow_dispatch:');
        expect(text).toContain('repository_dispatch:');
        expect(text).toContain('types: [render-complete]');
    });

    it('checks out with the push-capable PAT', () => {
        expect(read()).toContain('token: ${{ secrets.GH_NEW_TOKEN }}');
    });

    it('uses the configs bot identity', () => {
        expect(read()).toContain('11131426+joelipi@users.noreply.github.com');
        expect(read()).toContain('uff-configs-bot');
    });

    it('has the null-safe actor + [skip configs] loop guard', () => {
        const text = read();
        expect(text).toContain("github.actor != 'github-actions[bot]'");
        expect(text).toContain("github.event.head_commit.message || ''");
        expect(text).toContain('[skip configs]');
    });

    it('runs the generator in --check mode', () => {
        expect(read()).toContain('node scripts/generate-config-from-sheet.mjs --check');
    });

    it('captures skips and surfaces them as annotations + summary', () => {
        const text = read();
        expect(text).toContain('tee /tmp/configs.log');
        expect(text).toContain('GITHUB_STEP_SUMMARY');
        expect(text).toContain('::error::');
        // Only missing-column skips are errors (overwrite-refusals are expected).
        expect(text).toContain("grep 'missing required column'");
    });

    it('commits configs + the allow-list only on a diff', () => {
        const text = read();
        expect(text).toContain('git add src/config scripts/lib/generated-configs.json');
        expect(text).toContain('git diff --cached --quiet');
        expect(text).toContain('git push origin "HEAD:${{ github.ref_name }}"');
    });

    it('never passes --force (the Action never overwrites)', () => {
        expect(read()).not.toContain('--force');
    });

    it('the guard can fail (mutating a pinned token is detected)', () => {
        // Render the guard's assertions against a mutated copy of the file — not
        // just an in-memory string — so we prove the pinned tokens are the real
        // detection surface.
        const assertRequired = (text) => {
            expect(text).toContain('workflow_dispatch:');
            expect(text).toContain('secrets.GH_NEW_TOKEN');
            expect(text).toContain('[skip configs]');
            expect(text).toContain('node scripts/generate-config-from-sheet.mjs --check');
            expect(text).toContain('git push origin "HEAD:${{ github.ref_name }}"');
        };
        const good = read();
        expect(() => assertRequired(good)).not.toThrow();

        for (const token of ['secrets.GH_NEW_TOKEN', '[skip configs]', 'node scripts/generate-config-from-sheet.mjs --check']) {
            const mutated = good.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertRequired(mutated), token).toThrow();
        }
    });
});
