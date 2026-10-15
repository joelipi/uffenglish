// scripts/sync-srt-workflow.test.js
// Story 065, Task 5: source guard for .github/workflows/sync-srt.yml. The
// Action merges the pipeline-computed srt column into the committed master CSV
// (not a remote sheet) and commits the file, so this pins its shape — R2
// download, file merge, PAT bot-commit with the loop guard, shared CSV-writer
// concurrency — and its absences (no Google surface, no dispatch, since
// pipeline.yml owns `render-complete`).
//
// Lives under scripts/ so the src/** recorder-page scanner is unaffected. Raw
// source throughout (no comment stripping); each pinned token is proven
// failable by mutation.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { concurrencyBlock, ifLine } from './lib/workflow-guard-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/sync-srt.yml');

const read = () => readFileSync(WORKFLOW, 'utf8');

function assertSyncWorkflowContract(text) {
    // Triggers: manual + the one-click pipeline's `workflow_call` (story 051).
    expect(text).toContain('workflow_dispatch:');
    expect(text).toContain('workflow_call:');
    // Shared group with every CSV writer; `queue: max` keeps queued runs.
    const conc = concurrencyBlock(text, 'sync-srt.yml');
    expect(conc).toContain('group: master-csv');
    expect(conc).toContain('cancel-in-progress: false');
    expect(conc).toContain('queue: max');
    // Cloudflare R2 download credentials are unchanged.
    expect(text).toContain('secrets.CLOUDFLARE_API_TOKEN');
    expect(text).toContain('secrets.CLOUDFLARE_ACCOUNT_ID');
    expect(text).toContain('node scripts/write-srt-to-csv.mjs');
    // PAT checkout + bot-commit with the loop guard, only on a diff.
    expect(text).toContain('token: ${{ secrets.GH_NEW_TOKEN }}');
    expect(text).toContain('git add public/wouldyourather.master.csv');
    expect(text).toContain('git diff --cached --quiet');
    expect(text).toContain('git push origin "HEAD:${{ github.ref_name }}"');
    // A rejected push retries on a fresh rebase instead of dying red.
    expect(text).toContain('for attempt in 1 2 3');
    expect(text).toContain('git rebase');

    const guard = ifLine(text, 'sync-srt.yml');
    expect(guard).toContain("github.actor != 'github-actions[bot]'");
    expect(guard).toContain('[skip srt]');
    // Absences: no Google surface, no dispatch (pipeline.yml owns
    // `render-complete`).
    expect(text).not.toContain('GOOGLE_');
    expect(text).not.toContain('docs.google.com');
    expect(text).not.toContain('spreadsheet');
    expect(text).not.toContain('repository_dispatch');
}

describe('sync-srt.yml source guard', () => {
    it('has the required shape and absences', () => {
        expect(() => assertSyncWorkflowContract(read())).not.toThrow();
    });

    it('no longer owns the render-complete dispatch (pipeline.yml does)', () => {
        expect(read()).not.toContain('repository_dispatch');
    });

    it('the guard can fail on each required token', () => {
        const good = read();
        const tokens = [
            'workflow_dispatch:', 'workflow_call:',
            'secrets.CLOUDFLARE_API_TOKEN', 'secrets.CLOUDFLARE_ACCOUNT_ID',
            'node scripts/write-srt-to-csv.mjs',
            'token: ${{ secrets.GH_NEW_TOKEN }}',
            'git add public/wouldyourather.master.csv',
            'git diff --cached --quiet',
            'git push origin "HEAD:${{ github.ref_name }}"',
            '[skip srt]', 'group: master-csv', 'queue: max',
            'for attempt in 1 2 3', 'git rebase',
        ];
        for (const token of tokens) {
            const mutated = good.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertSyncWorkflowContract(mutated), token).toThrow();
        }
    });

    it('the concurrency guard can fail on queue: max', () => {
        const good = read();
        const block = concurrencyBlock(good);
        const mutated = good.replace(block, block.replace('queue: max', 'queue: 1'));
        expect(mutated).not.toBe(good);
        expect(() => assertSyncWorkflowContract(mutated)).toThrow();
    });

    it('scopes [skip srt] to the loop-guard if: line (it also appears in the commit message)', () => {
        const good = read();
        const mutated = good.replace("'[skip srt]'", "'[skip-something-else]'");
        expect(mutated).not.toBe(good);
        expect(mutated).toContain('[skip srt]');
        expect(() => assertSyncWorkflowContract(mutated)).toThrow();
    });

    it('re-adding a Google reference or the dispatch trips the absences', () => {
        const good = read();
        for (const injected of [
            '\n          GOOGLE_SHEET_ID: x\n',
            '\n          # see docs.google.com/spreadsheets/d/x\n',
            '\n  repository_dispatch:\n    types: [render-complete]\n',
        ]) {
            expect(() => assertSyncWorkflowContract(good + injected), injected).toThrow();
        }
    });
});
