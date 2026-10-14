// scripts/write-source-to-sheet.test.js
// Push-the-button authoring: editing wouldyourather.source.txt on the GitHub
// web UI syncs the sheet tab via .github/workflows/source-to-sheet.yml. These
// tests pin the writer's contract: validation before any write, dry-run writes
// nothing, missing tabs are created, and the read-back must match.
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildSheetValues,
    createWriterSeams,
    runWriteSourceToSheet,
    DEFAULT_SOURCE_SHEET_ID,
    DEFAULT_SOURCE_TAB,
} from './write-source-to-sheet.mjs';
import { MASTER_HEADER } from './lib/source-bridge-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/write-source-to-sheet.mjs');

const MINI_SOURCE = JSON.stringify({
    course: 'mini',
    title: 'Mini',
    mission: 'test mission',
    video_title: 'Mini Video',
    levels: { A1: 'X or Y', A2: 'which is better' },
    rungs: ['A1', 'A2'],
    pairs: [{
        ask: { id: 'a', title: 'Ask A' },
        answer: { id: 'b', title: 'Answer B' },
        topics: [{
            question: ['X or Y?', 'Which is better: X or Y?'],
            choices: ['X', 'Y'],
            answers: [['X.', 'X is better.'], ['Y.', 'Y is better.']],
        }],
    }],
});

// 1 ask topic x 2 takes + reuse rows (2) + branch row (1) + 2 answer groups x 2 takes.
const MINI_ROWS = 2 + 2 + 1 + 4;
const MINI_TAKES = 2 + 4;

function fakes({ tab = 'wouldyourather', tabExists = true, backRows = MINI_ROWS, backHeader = [...MASTER_HEADER], failUpdate = false } = {}) {
    const calls = [];
    const ranges = [];
    return {
        calls,
        ranges,
        getSpreadsheet: async () => {
            calls.push('getSpreadsheet');
            return tabExists ? { sheets: [{ properties: { title: tab } }] } : { sheets: [] };
        },
        addSheet: async () => { calls.push('addSheet'); return {}; },
        clearValues: async (_id, range) => { calls.push('clearValues'); ranges.push(range); return {}; },
        updateValues: async (_id, range) => {
            calls.push('updateValues'); ranges.push(range);
            if (failUpdate) throw new Error('update blew up');
            return {};
        },
        getValues: async () => {
            calls.push('getValues');
            return { values: [backHeader, ...Array.from({ length: backRows }, () => ['r'])] };
        },
    };
}

describe('write-source-to-sheet', () => {
    it('pins the owned sheet and tab defaults', () => {
        expect(DEFAULT_SOURCE_SHEET_ID).toBe('17H9btBVtNAVYmPSxrwO7chN25qlblxstxJKQlX0saKA');
        expect(DEFAULT_SOURCE_TAB).toBe('wouldyourather');
    });

    it('buildSheetValues emits the master header first, in order', () => {
        const values = buildSheetValues([{ course_id: 'mini' }]);
        expect(values[0]).toEqual([...MASTER_HEADER]);
        expect(values[1][MASTER_HEADER.indexOf('course_id')]).toBe('mini');
        expect(values[1]).toHaveLength(MASTER_HEADER.length);
    });

    it('dry-run validates and writes nothing', async () => {
        const seams = fakes();
        const logs = [];
        const result = await runWriteSourceToSheet({
            sourceText: MINI_SOURCE,
            sheetId: 'sid',
            tab: 'wouldyourather',
            dryRun: true,
            ...seams,
            log: (m) => logs.push(m),
        });
        expect(result).toEqual({ rows: MINI_ROWS, takes: MINI_TAKES, written: false });
        expect(seams.calls).toEqual(['getSpreadsheet']);
        expect(logs.join('\n')).toContain('would sync');
    });

    it('invalid JSON throws before any sheet call', async () => {
        const seams = fakes();
        await expect(runWriteSourceToSheet({
            sourceText: '// comment\n{nope',
            sheetId: 'sid',
            tab: 'wouldyourather',
            ...seams,
            log: () => {},
        })).rejects.toThrow(/not valid JSON/);
        expect(seams.calls).toEqual([]);
    });

    it('structural errors (choices != answers) throw before any sheet call', async () => {
        const bad = JSON.parse(MINI_SOURCE);
        bad.pairs[0].topics[0].answers.pop();
        const seams = fakes();
        await expect(runWriteSourceToSheet({
            sourceText: JSON.stringify(bad),
            sheetId: 'sid',
            tab: 'wouldyourather',
            ...seams,
            log: () => {},
        })).rejects.toThrow(/answer group/);
        expect(seams.calls).toEqual([]);
    });

    it('invalid source with a missing tab still never creates it', async () => {
        const seams = fakes({ tabExists: false });
        await expect(runWriteSourceToSheet({
            sourceText: '// comment\n{nope',
            sheetId: 'sid',
            tab: 'wouldyourather',
            ...seams,
            log: () => {},
        })).rejects.toThrow(/not valid JSON/);
        expect(seams.calls).toEqual([]);
    });

    it('happy path writes first, then clears only the trailing rows, then verifies', async () => {
        const seams = fakes();
        const logs = [];
        const result = await runWriteSourceToSheet({
            sourceText: MINI_SOURCE,
            sheetId: 'sid',
            tab: 'wouldyourather',
            ...seams,
            log: (m) => logs.push(m),
        });
        expect(result).toEqual({ rows: MINI_ROWS, takes: MINI_TAKES, written: true });
        expect(seams.calls).toEqual(['getSpreadsheet', 'updateValues', 'clearValues', 'getValues']);
        // The tab is never observed empty: the full-range clear is gone.
        expect(seams.ranges).toEqual(["'wouldyourather'!A1", `'wouldyourather'!A${MINI_ROWS + 2}:ZZ`]);
        expect(logs.join('\n')).toContain('SYNCED');
    });

    it('a non-default tab is quoted through every range', async () => {
        const seams = fakes({ tab: "Joe's Tab" });
        await runWriteSourceToSheet({
            sourceText: MINI_SOURCE,
            sheetId: 'sid',
            tab: "Joe's Tab",
            ...seams,
            log: () => {},
        });
        expect(seams.ranges).toEqual(["'Joe''s Tab'!A1", `'Joe''s Tab'!A${MINI_ROWS + 2}:ZZ`]);
    });

    it('creates a missing tab before writing', async () => {
        const seams = fakes({ tabExists: false });
        await runWriteSourceToSheet({
            sourceText: MINI_SOURCE,
            sheetId: 'sid',
            tab: 'wouldyourather',
            ...seams,
            log: () => {},
        });
        expect(seams.calls).toEqual(['getSpreadsheet', 'addSheet', 'updateValues', 'clearValues', 'getValues']);
    });

    it('a failed update throws with the old tab intact (no trailing clear)', async () => {
        const seams = fakes({ failUpdate: true });
        await expect(runWriteSourceToSheet({
            sourceText: MINI_SOURCE,
            sheetId: 'sid',
            tab: 'wouldyourather',
            ...seams,
            log: () => {},
        })).rejects.toThrow(/update blew up/);
        expect(seams.calls).toEqual(['getSpreadsheet', 'updateValues']);
    });

    it('a short read-back fails loudly instead of silently drifting', async () => {
        const seams = fakes({ backRows: MINI_ROWS - 1 });
        await expect(runWriteSourceToSheet({
            sourceText: MINI_SOURCE,
            sheetId: 'sid',
            tab: 'wouldyourather',
            ...seams,
            log: () => {},
        })).rejects.toThrow(/read-back mismatch/);
    });

    it('a wrong-column read-back fails loudly too', async () => {
        const seams = fakes({ backHeader: ['nope'] });
        await expect(runWriteSourceToSheet({
            sourceText: MINI_SOURCE,
            sheetId: 'sid',
            tab: 'wouldyourather',
            ...seams,
            log: () => {},
        })).rejects.toThrow(/read-back mismatch/);
    });

    it('createWriterSeams rejects a missing or invalid secret without echoing it', async () => {
        expect(() => createWriterSeams({})).toThrow(/not set/);
        expect(() => createWriterSeams({ GOOGLE_SERVICE_ACCOUNT_JSON: '{nope' })).toThrow(/not valid JSON/);
    });

    it('CLI --help runs with no credential', async () => {
        const out = await new Promise((resolve, reject) => {
            execFile('node', [SCRIPT, '--help'], (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve(stdout + stderr);
            });
        });
        expect(out).toContain('--dry-run');
    });

    it('CLI without a credential fails with the secret error, not a stack', async () => {
        const code = await new Promise((resolve) => {
            execFile('node', [SCRIPT, '--dry-run'], {
                env: { ...process.env, GOOGLE_SERVICE_ACCOUNT_JSON: '' },
            }, (err) => resolve(err ? err.code : 0));
        });
        expect(code).toBe(1);
    });
});
