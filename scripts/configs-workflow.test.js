// scripts/configs-workflow.test.js
// Story 046 (+051, 065): source guard for .github/workflows/configs.yml. The
// Action is the only thing that commits generated configs, so its shape
// (triggers, bot token, loop guard, --check run over the committed CSV, skip
// reporting, diff-only commit, no --force) is pinned.
//
// AGENTS.md guard hygiene: tokens asserted over the whole file must appear
// exactly once.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { concurrencyBlock, ifLine } from './lib/workflow-guard-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/configs.yml');

const read = () => readFileSync(WORKFLOW, 'utf8');

const RUN_COMMAND = 'node scripts/generate-config-from-sheet.mjs --check';

/** The "Generate configs" step block (its env + run), so a header-comment
 * occurrence of a token cannot keep an assertion green. */
function runBlock(text) {
    const start = text.indexOf('- name: Generate configs');
    const end = text.indexOf('- name: Report skips', start);
    if (start === -1 || end === -1) throw new Error('configs.yml: Generate configs step not found');
    return text.slice(start, end);
}

/** The full contract, rendered against any (possibly mutated) text. */
function assertConfigsContract(text) {
    expect(text).toContain('workflow_dispatch:');
    expect(text).toContain('workflow_call:');
    // pipeline.yml owns `render-complete`; configs no longer accepts it.
    expect(text).not.toContain('repository_dispatch');
    expect(text).toContain('token: ${{ secrets.GH_NEW_TOKEN }}');
    expect(text).toContain('git push origin "HEAD:${{ github.ref_name }}"');
    // The loop guard's `if:` line, scoped: `[skip configs]` also appears in the
    // bot's commit message, so a whole-file assertion could stay green while the
    // guard is broken.
    const guard = ifLine(text, 'configs.yml');
    expect(guard).toContain("github.actor != 'github-actions[bot]'");
    expect(guard).toContain("github.event.head_commit.message || ''");
    expect(guard).toContain('[skip configs]');
    // Shared group with every CSV writer; `queue: max` keeps queued runs
    // instead of cancelling the older pending one.
    const conc = concurrencyBlock(text, 'configs.yml');
    expect(conc).toContain('group: master-csv');
    expect(conc).toContain('cancel-in-progress: false');
    expect(conc).toContain('queue: max');
    // The run step reads the committed CSV from disk: no API flags, no
    // service account, no sheet id.
    const block = runBlock(text);
    expect(block).toContain(RUN_COMMAND);
    expect(block).not.toContain('--from-api');
    expect(text).not.toContain('GOOGLE_');
    expect(text).not.toContain('SHEET_URL');
}

describe('configs.yml source guard', () => {
    it('has the required shape and absences', () => {
        expect(() => assertConfigsContract(read())).not.toThrow();
    });

    it('accepts workflow_dispatch and workflow_call (the pipeline chain)', () => {
        const text = read();
        expect(text).toContain('workflow_dispatch:');
        expect(text).toContain('workflow_call:');
        expect(text).not.toContain('repository_dispatch');
    });

    it('runs the generator with --check over the committed CSV in the run step', () => {
        expect(runBlock(read())).toContain(RUN_COMMAND);
    });

    it('checks out with the push-capable PAT', () => {
        expect(read()).toContain('token: ${{ secrets.GH_NEW_TOKEN }}');
    });

    it('uses the configs bot identity', () => {
        expect(read()).toContain('11131426+joelipi@users.noreply.github.com');
        expect(read()).toContain('uff-configs-bot');
    });

    it('has the null-safe actor + [skip configs] loop guard', () => {
        const guard = ifLine(read(), 'configs.yml');
        expect(guard).toContain("github.actor != 'github-actions[bot]'");
        expect(guard).toContain("github.event.head_commit.message || ''");
        expect(guard).toContain('[skip configs]');
    });

    it('scopes [skip configs] to the loop-guard if: line (it also appears in the commit message)', () => {
        const good = read();
        // Change only the single-quoted `if:` occurrence; the commit-message one
        // (inside a double-quoted string) survives, as it would in the real file.
        const mutated = good.replace("'[skip configs]'", "'[skip-configs]'");
        expect(mutated).not.toBe(good);
        expect(mutated).toContain('[skip configs]');
        expect(() => assertConfigsContract(mutated)).toThrow();
    });

    it('captures skips and surfaces them as annotations + summary', () => {
        const text = read();
        expect(text).toContain('tee /tmp/configs.log');
        expect(text).toContain('GITHUB_STEP_SUMMARY');
        expect(text).toContain('::error::');
        // Only missing-column skips are errors; overwrite is unconditional now
        // (story 047), so there is no "already exists" skip to exclude.
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

    it('the guard can fail on each pinned token', () => {
        const good = read();
        expect(() => assertConfigsContract(good)).not.toThrow();
        const tokens = [
            'workflow_call:', 'secrets.GH_NEW_TOKEN', '[skip configs]',
            RUN_COMMAND, 'group: master-csv',
            'git push origin "HEAD:${{ github.ref_name }}"', 'queue: max',
        ];
        for (const token of tokens) {
            const mutated = good.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertConfigsContract(mutated), token).toThrow();
        }
    });

    it('the concurrency guard can fail on queue: max', () => {
        const good = read();
        const block = concurrencyBlock(good);
        const mutated = good.replace(block, block.replace('queue: max', 'queue: 1'));
        expect(mutated).not.toBe(good);
        expect(() => assertConfigsContract(mutated)).toThrow();
    });

    it('re-adding the API path trips the absences', () => {
        const good = read();
        // Appending `--from-api` to the run command trips the scoped absence
        // (the header comment carries no such token to hide behind).
        const mutated = good.replace('mjs --check 2>&1', 'mjs --check --from-api 2>&1');
        expect(mutated).not.toBe(good);
        expect(() => assertConfigsContract(mutated)).toThrow();
    });
});
