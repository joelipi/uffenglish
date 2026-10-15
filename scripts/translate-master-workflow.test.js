// scripts/translate-master-workflow.test.js
// Story 065, Task 4: source guard for .github/workflows/translate-master.yml
// and the CLI. The Action writes translations into the committed master CSV
// (not a remote sheet), so this pins its shape: PAT checkout, bot-commit with
// the loop guard, shared CSV-writer concurrency, DeepSeek-only secrets, and
// the absences (no Google surface, no --force).
//
// Lives under scripts/ so the src/** recorder-page scanner is unaffected. Raw
// source throughout (no comment stripping); each pinned token is proven
// failable by mutation.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { concurrencyBlock, stepBlock } from './lib/workflow-guard-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/translate-master.yml');

const readWorkflow = () => readFileSync(WORKFLOW, 'utf8');

/** The `workflow_call:` block, up to the next top-level key (column 0), so an
 * assertion cannot be satisfied by a token elsewhere in the file. */
function workflowCallBlock(text) {
    const start = text.indexOf('workflow_call:');
    if (start === -1) throw new Error('translate-master.yml: workflow_call not found');
    const rest = text.slice(start);
    const next = /\n(?=\S)/.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
}

function assertWorkflowCallBlock(text) {
    const block = workflowCallBlock(text);
    expect(block).toContain('dry_run:');
    expect(block).toContain('default: false');
    expect(block).toContain('languages:');
    expect(block).toContain('default: es,pt,bn');
}

// The full contract for the workflow: required wiring + deliberate absences.
function assertWorkflowContract(text) {
    expect(text).toContain('workflow_dispatch:');
    // Story 051: the one-click pipeline calls this as a reusable workflow.
    expect(text).toContain('workflow_call:');
    expect(text).toContain('secrets.DEEPSEEK_API_KEY');
    expect(text).toContain('token: ${{ secrets.GH_NEW_TOKEN }}');
    expect(text).toContain('node scripts/translate-master-csv.mjs');
    expect(text).toContain('inputs.dry_run');
    expect(text).toContain('inputs.languages');
    const commit = stepBlock(text, 'Commit translations', 'translate-master.yml');
    expect(commit).toContain('uses: ./.github/actions/bot-commit/');
    expect(commit).toContain('bot-name: uff-translate-bot');
    expect(commit).toContain('[skip translate]');
    expect(commit).toContain('add-paths: public/wouldyourather.master.csv');
    expect(commit).toContain('node scripts/translate-master-csv.mjs');
    expect(commit).toContain('deepseek-key: ${{ secrets.DEEPSEEK_API_KEY }}');

    expect(text).toContain('[skip translate]');
    // The bot's own commit must not re-enter the job (loop guard on if:).
    expect(text).toContain("github.actor != 'github-actions[bot]'");
    // Shared group with every CSV writer; `queue: max` keeps queued runs.
    const conc = concurrencyBlock(text);
    expect(conc).toContain('group: master-csv');
    expect(conc).toContain('cancel-in-progress: false');
    expect(conc).toContain('queue: max');
    expect(text).toContain('node-version: 20');
    // Absences: no Google surface, no force.
    expect(text).not.toContain('GOOGLE_');
    expect(text).not.toContain('docs.google.com');
    expect(text).not.toContain('spreadsheet');
    expect(text).not.toContain('--force');
}

describe('translate-master.yml source guard', () => {
    it('has the required shape and absences', () => {
        expect(() => assertWorkflowContract(readWorkflow())).not.toThrow();
    });

    it('declares workflow_call with the dry_run/languages defaults', () => {
        expect(() => assertWorkflowCallBlock(readWorkflow())).not.toThrow();
    });

    it('the workflow_call block guard can fail', () => {
        const good = readWorkflow();
        const block = workflowCallBlock(good);
        const mutatedBlock = block.replace('default: es,pt,bn', 'default: xx');
        expect(mutatedBlock).not.toBe(block);
        const mutated = good.replace(block, mutatedBlock);
        expect(() => assertWorkflowCallBlock(mutated)).toThrow();
    });

    it('the guard can fail on each required token', () => {
        const good = readWorkflow();
        const required = [
            'workflow_dispatch:', 'workflow_call:', 'secrets.DEEPSEEK_API_KEY',
            'token: ${{ secrets.GH_NEW_TOKEN }}',
            'node scripts/translate-master-csv.mjs',
            'uses: ./.github/actions/bot-commit/',
            'bot-name: uff-translate-bot',
            '[skip translate]', 'group: master-csv', 'queue: max', 'node-version: 20',
            "github.actor != 'github-actions[bot]'",
        ];
        for (const token of required) {
            const mutated = good.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertWorkflowContract(mutated), token).toThrow();
        }
    });

    it('the concurrency guard can fail on queue: max', () => {
        const good = readWorkflow();
        const block = concurrencyBlock(good);
        const mutated = good.replace(block, block.replace('queue: max', 'queue: 1'));
        expect(mutated).not.toBe(good);
        expect(() => assertWorkflowContract(mutated)).toThrow();
    });

    it('re-adding a Google reference or --force trips the absences', () => {
        const good = readWorkflow();
        for (const injected of [
            '\n          GOOGLE_SHEET_ID: x\n',
            '\n          # see docs.google.com/spreadsheets/d/x\n',
            '\n      - run: node scripts/translate-master-csv.mjs --force\n',
        ]) {
            expect(() => assertWorkflowContract(good + injected), injected).toThrow();
        }
    });
});
