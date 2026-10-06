// scripts/configs-workflow.test.js
// Story 046 (+051): source guard for .github/workflows/configs.yml. The Action is
// the only thing that commits generated configs, so its shape (triggers, bot
// token, loop guard, --check --from-api run, skip reporting, diff-only commit, no
// --force) is pinned.
//
// AGENTS.md guard hygiene: tokens asserted over the whole file must appear
// exactly once. `--from-api` also appears in the header comment, so the run
// assertions are scoped to the "Generate configs" step block, not the file.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/configs.yml');

const read = () => readFileSync(WORKFLOW, 'utf8');

const RUN_COMMAND = 'node scripts/generate-config-from-sheet.mjs --check --from-api';

/** The "Generate configs" step block (its env + run), so a header-comment
 * occurrence of a token cannot keep an assertion green. */
function runBlock(text) {
    const start = text.indexOf('- name: Generate configs');
    const end = text.indexOf('- name: Report skips', start);
    if (start === -1 || end === -1) throw new Error('configs.yml: Generate configs step not found');
    return text.slice(start, end);
}

/** The `concurrency:` block, up to the next column-0 key. */
function concurrencyBlock(text) {
    const start = text.indexOf('concurrency:');
    if (start === -1) throw new Error('configs.yml: concurrency block not found');
    const rest = text.slice(start);
    const next = /\n(?=\S)/.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
}

/** The full contract, rendered against any (possibly mutated) text. */
function assertConfigsContract(text) {
    expect(text).toContain('workflow_dispatch:');
    expect(text).toContain('workflow_call:');
    // pipeline.yml owns `render-complete`; configs no longer accepts it.
    expect(text).not.toContain('repository_dispatch');
    expect(text).toContain('token: ${{ secrets.GH_NEW_TOKEN }}');
    expect(text).toContain('[skip configs]');
    expect(text).toContain('git push origin "HEAD:${{ github.ref_name }}"');
    // One group per ref; `queue: max` keeps queued runs instead of cancelling the
    // older pending one.
    const conc = concurrencyBlock(text);
    expect(conc).toContain('group: configs-${{ github.ref }}');
    expect(conc).toContain('cancel-in-progress: false');
    expect(conc).toContain('queue: max');
    // The run step (not the comment) must read via the API with the service
    // account and the sheet id.
    const block = runBlock(text);
    expect(block).toContain(RUN_COMMAND);
    expect(block).toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
    expect(block).toContain('GOOGLE_SHEET_ID');
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

    it('runs the generator with --check --from-api in the run step', () => {
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
        const text = read();
        expect(text).toContain("github.actor != 'github-actions[bot]'");
        expect(text).toContain("github.event.head_commit.message || ''");
        expect(text).toContain('[skip configs]');
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
            RUN_COMMAND, 'GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SHEET_ID',
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

    it('scopes --from-api to the run step: dropping it from the command still fails', () => {
        const good = read();
        // Remove the flag from the run command only; the header comment keeps a
        // `--from-api` occurrence, which used to keep a whole-file guard green.
        const mutated = good.replace('mjs --check --from-api', 'mjs --check');
        expect(mutated).toContain('--from-api');
        expect(() => assertConfigsContract(mutated)).toThrow();
    });
});
