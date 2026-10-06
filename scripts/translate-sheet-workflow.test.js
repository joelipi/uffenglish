// scripts/translate-sheet-workflow.test.js
// Story 049, Task 6: source guard for .github/workflows/translate-sheet.yml and
// the CLI. The Action writes to the operator's sheet (not the repo), so this
// pins its shape and the absences (no bot token, no commit, no push, no --force),
// and proves the service-account key is only ever read in memory.
//
// Lives under scripts/ so the src/** recorder-page scanner is unaffected.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTranslateSheet } from './translate-sheet.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/translate-sheet.yml');
const CLI = path.join(ROOT, 'scripts/translate-sheet.mjs');

const readWorkflow = () => readFileSync(WORKFLOW, 'utf8');
const readCli = () => readFileSync(CLI, 'utf8');

/** The `workflow_call:` block, up to the next top-level key (column 0), so an
 * assertion cannot be satisfied by a token elsewhere in the file. */
function workflowCallBlock(text) {
    const start = text.indexOf('workflow_call:');
    if (start === -1) throw new Error('translate-sheet.yml: workflow_call not found');
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
    expect(text).toContain('secrets.GOOGLE_SERVICE_ACCOUNT_JSON');
    expect(text).toContain('GOOGLE_SHEET_ID');
    expect(text).toContain('group: translate-sheet');
    expect(text).toContain('node-version: 20');
    expect(text).toContain('node scripts/translate-sheet.mjs');
    // Absences: no repo write path, no force.
    expect(text).not.toContain('GH_NEW_TOKEN');
    expect(text).not.toContain('git commit');
    expect(text).not.toContain('git push');
    expect(text).not.toContain('--force');
}

describe('translate-sheet.yml source guard', () => {
    it('has the required shape and absences', () => {
        expect(() => assertWorkflowContract(readWorkflow())).not.toThrow();
    });

    it('reads the sheet id from a repo variable, accepting the secret fallback', () => {
        const text = readWorkflow();
        expect(text).toContain('vars.GOOGLE_SHEET_ID');
        expect(text).toContain('secrets.GOOGLE_SHEET_ID');
    });

    it('maps the dispatch inputs (dry_run/languages) into the run', () => {
        const text = readWorkflow();
        expect(text).toContain('inputs.dry_run');
        expect(text).toContain('inputs.languages');
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
            'secrets.GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SHEET_ID',
            'group: translate-sheet', 'node-version: 20', 'node scripts/translate-sheet.mjs',
        ];
        for (const token of required) {
            const mutated = good.split(token).join('SENTINEL_REMOVED');
            expect(mutated, token).not.toContain(token);
            expect(() => assertWorkflowContract(mutated), token).toThrow();
        }
    });

    it('re-adding git commit / git push / GH_NEW_TOKEN / --force trips the absences', () => {
        const good = readWorkflow();
        for (const injected of [
            '\n      - run: git commit -m x\n',
            '\n      - run: git push origin HEAD\n',
            '\n      - run: echo ${{ secrets.GH_NEW_TOKEN }}\n',
            '\n      - run: node scripts/translate-sheet.mjs --force\n',
        ]) {
            expect(() => assertWorkflowContract(good + injected), injected).toThrow();
        }
    });
});

describe('service-account key is never written to disk', () => {
    it('the workflow never echoes or redirects the key', () => {
        const text = readWorkflow();
        expect(text).toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
        expect(text).not.toMatch(/echo[^\n]*GOOGLE_SERVICE_ACCOUNT_JSON/);
        expect(text).not.toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON[^\n]*>/);
        expect(text).not.toMatch(/>\s*\S*\.json\b/);
    });

    it('the CLI only reads GOOGLE_SERVICE_ACCOUNT_JSON (never writes a file)', () => {
        const src = readCli();
        expect(src).toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
        expect(src).toContain('JSON.parse(raw)');
        expect(src).not.toContain('writeFileSync');
        expect(src).not.toContain('createWriteStream');
        expect(src).not.toContain('fs.writeFile');
        expect(src).not.toMatch(/console\.log\([^)]*GOOGLE_SERVICE_ACCOUNT_JSON/);
    });

    it('a fake Google client records only in-memory params across a dry-run and a real run', async () => {
        const opened = [];
        const client = {
            getValues: async () => ({ values: [['lesson_title', 'lesson_title_es'], ['Hi', '']] }),
            getSpreadsheet: async () => ({ sheets: [{ properties: { sheetId: 289451687, title: 'Sheet1' } }] }),
            batchUpdate: (params) => { opened.push(params); return Promise.resolve({ data: {} }); },
            translateText: async (t) => t,
            log: () => {},
        };
        // Dry-run reads but never authenticates a write.
        await runTranslateSheet({ sheetId: 'S', tab: 'Sheet1', languages: ['es'], dryRun: true, ...client });
        expect(opened).toHaveLength(0);
        // Real run: one authenticated write, in-memory params only.
        await runTranslateSheet({ sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client });
        expect(opened).toHaveLength(1);
        expect(opened[0].spreadsheetId).toBe('S');
        expect(String(opened[0].requestBody)).not.toContain('.json');
    });
});
