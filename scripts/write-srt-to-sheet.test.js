// scripts/write-srt-to-sheet.test.js
// Story 050, Task 5: the SRT write-back script with an injected Sheets client.
// No live credential is used — the core pass takes fakes.
import { describe, it, expect, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    groupKeyForRow,
    groupPrefixForFilename,
    planSrtWrites,
    runWriteSrtToSheet,
} from './write-srt-to-sheet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIPELINE_DIR = path.join(ROOT, 'docs', 'video-pipeline');

function findPython() {
    for (const candidate of ['python3', 'python']) {
        const res = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
        if (!res.error && res.status === 0) return candidate;
    }
    return null;
}

// A CSV carrying the pipeline-computed (JSON-escaped) srt. Group `clip_a`
// (clip_a01 + clip_a02) has an srt; group `clip_b` is blank.
const CSV = [
    'filename,video_file,srt',
    'clip_a01,group-a,"1\\n00:00 --> 00:01\\nHi"',
    'clip_a02,group-a,',
    'clip_b01,group-b,',
].join('\n');
const SRT = '1\\n00:00 --> 00:01\\nHi';

const SHEET_VALUES = [
    ['filename', 'video_file', 'srt'],
    ['clip_a01', 'group-a', 'old1'],
    ['clip_a02', 'group-a', ''],
    ['clip_b01', 'group-b', 'keepme'],
];

function makeClient() {
    return {
        getValues: vi.fn(async () => ({ values: SHEET_VALUES })),
        getSpreadsheet: vi.fn(async () => ({
            sheets: [{ properties: { sheetId: 242913338, title: 'Sheet1' } }],
        })),
        batchUpdate: vi.fn(async () => ({ data: {} })),
    };
}

// Story 050: the write-back must key by exactly the pipeline's step key
// (`video_file`, fallback filename prefix) so the SRT targets the groups the
// pipeline rendered/joined under.
describe('group key parity with the pipeline', () => {
    it('keys a real master filename by video_file, not the lesson prefix', () => {
        expect(groupKeyForRow({ filename: 'wouldyourather_b01_i01', video_file: 'wouldyourather_b01_i' }))
            .toBe('wouldyourather_b01_i');
        expect(groupKeyForRow({ filename: 'wouldyourather_b01_i01' })).toBe('wouldyourather_b');
        expect(groupPrefixForFilename('wouldyourather_b01_i01')).toBe('wouldyourather_b');
    });

    it('matches pipeline_lib.group_key_for_filename for the master filenames', () => {
        const python = findPython();
        if (!python) return; // the Python suite (a hard gate) proves the module loads
        const script = [
            'import json, sys',
            `sys.path.insert(0, ${JSON.stringify(PIPELINE_DIR)})`,
            'import pipeline_lib as lib',
            'print(json.dumps([',
            "  lib.group_key_for_filename('wouldyourather_b01_i01', {'wouldyourather_b01_i01': 'wouldyourather_b01_i'}),",
            "  lib.group_key_for_filename('demo-a0101', None),",
            "  lib.group_key_for_filename('demo-a0101', {'demo-a0101': ''}),",
            ']))',
        ].join('\n');
        const [withMap, noMap, blank] = JSON.parse(
            execFileSync(python, ['-c', script], { encoding: 'utf8' }).trim(),
        );
        expect(groupKeyForRow({ filename: 'wouldyourather_b01_i01', video_file: 'wouldyourather_b01_i' })).toBe(withMap);
        expect(groupKeyForRow({ filename: 'demo-a0101' })).toBe(noMap);
        expect(groupKeyForRow({ filename: 'demo-a0101', video_file: '' })).toBe(blank);
    });
});

describe('planSrtWrites', () => {
    it('writes every sheet row of a group matched by filename', () => {
        const plan = planSrtWrites({ csvText: CSV, rows: SHEET_VALUES.slice(1).map((r) => ({ filename: r[0] })), sheetRows: [2, 3, 4] });
        expect(plan).toEqual([
            { row: 0, sheetRow: 2, column: 'srt', value: SRT },
            { row: 1, sheetRow: 3, column: 'srt', value: SRT },
        ]);
    });

    it('writes nothing for a group whose srt is blank (never clears the cell)', () => {
        const plan = planSrtWrites({ csvText: CSV, rows: SHEET_VALUES.slice(1).map((r) => ({ filename: r[0] })), sheetRows: [2, 3, 4] });
        expect(plan.some((p) => p.row === 2)).toBe(false);
    });
});

describe('runWriteSrtToSheet', () => {
    it('issues exactly one RAW batchUpdate with one range per written cell', async () => {
        const client = makeClient();
        const res = await runWriteSrtToSheet({
            sheetId: 'S', tab: 'Sheet1', csvText: CSV, ...client, log: () => {},
        });
        expect(client.batchUpdate).toHaveBeenCalledTimes(1);
        const request = client.batchUpdate.mock.calls[0][0];
        expect(request.spreadsheetId).toBe('S');
        expect(request.requestBody.valueInputOption).toBe('RAW');
        expect(request.requestBody.data).toEqual([
            { range: "'Sheet1'!C2", values: [[SRT]] },
            { range: "'Sheet1'!C3", values: [[SRT]] },
        ]);
        expect(res.written).toBe(2);
    });

    it('is idempotent: a second run writes the same values without error', async () => {
        const client = makeClient();
        await runWriteSrtToSheet({ sheetId: 'S', tab: 'Sheet1', csvText: CSV, ...client, log: () => {} });
        await runWriteSrtToSheet({ sheetId: 'S', tab: 'Sheet1', csvText: CSV, ...client, log: () => {} });
        expect(client.batchUpdate).toHaveBeenCalledTimes(2);
        const first = client.batchUpdate.mock.calls[0][0].requestBody;
        const second = client.batchUpdate.mock.calls[1][0].requestBody;
        expect(second).toEqual(first);
    });

    it('resolves the default tab from the published gid when --tab is absent', async () => {
        const client = makeClient();
        await runWriteSrtToSheet({ sheetId: 'S', csvText: CSV, ...client, log: () => {} });
        expect(client.getSpreadsheet).toHaveBeenCalledWith({ spreadsheetId: 'S' });
        expect(client.batchUpdate.mock.calls[0][0].requestBody.data[0].range).toBe("'Sheet1'!C2");
    });
});
