// scripts/source-to-csv-workflow.test.js
// Story 065, Task 1: source guard for .github/workflows/source-to-csv.yml. The
// Action regenerates the committed master CSV from the source config, so this
// pins its triggers, the shared CSV-writer concurrency, the PAT bot-commit
// with the loop guard, and the absence of every Google Sheets reference.
//
// Lives under scripts/ so the src/** recorder-page scanner is unaffected. Raw
// source throughout (no comment stripping); each pinned token is proven
// failable by mutation.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { concurrencyBlock, ifLine, stepBlock } from './lib/workflow-guard-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/source-to-csv.yml');

const read = () => readFileSync(WORKFLOW, 'utf8');

function assertSourceToCsvContract(text) {
    expect(text).toContain('branches: [main]');
    expect(text).toContain('wouldyourather.source.txt');
    expect(text).toContain('scripts/generate-master-csv.mjs');
    expect(text).toContain('workflow_dispatch:');
    expect(text).toContain('inputs.dry_run');
    // Shared group with every CSV writer; queued runs wait their turn.
    const conc = concurrencyBlock(text, 'source-to-csv.yml');
    expect(conc).toContain('group: master-csv');
    expect(conc).toContain('cancel-in-progress: false');
    expect(conc).toContain('queue: max');
    // PAT checkout; the bot commit itself lives in the shared action.
    expect(text).toContain('token: ${{ secrets.GH_NEW_TOKEN }}');
    expect(text).toContain('node scripts/generate-master-csv.mjs');
    const commit = stepBlock(text, 'Commit master CSV', 'source-to-csv.yml');
    expect(commit).toContain('uses: ./.github/actions/bot-commit/');
    expect(commit).toContain('bot-name: uff-authoring-bot');
    expect(commit).toContain('[skip authoring]');
    expect(commit).toContain('add-paths: public/*.master.csv');
    expect(commit).toContain('node scripts/generate-master-csv.mjs');

    const guard = ifLine(text, 'source-to-csv.yml');
    expect(guard).toContain("github.actor != 'github-actions[bot]'");
    expect(guard).toContain('[skip authoring]');
    // Absences: the old Google Sheets sync this replaces.
    expect(text).not.toContain('GOOGLE_');
    expect(text).not.toContain('docs.google.com');
    expect(text).not.toContain('spreadsheet');
}

describe('source-to-csv.yml source guard', () => {
    it('has the required triggers, concurrency, PAT commit, and absences', () => {
        expect(() => assertSourceToCsvContract(read())).not.toThrow();
    });

    it('the guard can fail on each pinned token', () => {
        const good = read();
        const tokens = [
            'branches: [main]', 'wouldyourather.source.txt',
            'scripts/generate-master-csv.mjs', 'workflow_dispatch:',
            'group: master-csv', 'queue: max',
            'token: ${{ secrets.GH_NEW_TOKEN }}',
            'node scripts/generate-master-csv.mjs',
            'uses: ./.github/actions/bot-commit/',
            'bot-name: uff-authoring-bot',
            '[skip authoring]',
        ];
        for (const token of tokens) {
            const mutated = good.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertSourceToCsvContract(mutated), token).toThrow();
        }
    });

    it('scopes [skip authoring] to the loop-guard if: line (it also appears in the commit message)', () => {
        const good = read();
        const mutated = good.replace("'[skip authoring]'", "'[skip-something-else]'");
        expect(mutated).not.toBe(good);
        expect(mutated).toContain('[skip authoring]');
        expect(() => assertSourceToCsvContract(mutated)).toThrow();
    });

    it('re-adding a Google reference trips the absences', () => {
        const good = read();
        for (const injected of [
            '\n          GOOGLE_SHEET_ID: x\n',
            '\n          # see docs.google.com/spreadsheets/d/x\n',
        ]) {
            expect(() => assertSourceToCsvContract(good + injected), injected).toThrow();
        }
    });
});
