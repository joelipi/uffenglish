// scripts/write-srt-to-csv.test.js
// Story 065, Task 5: the SRT write-back script merges `video_data.csv` into
// the committed master CSV. The step-key planner is unchanged (ported with the
// failable pre-fix guard); the write passes through the file merge.
// No live credential is used — the core pass is pure.
import { describe, it, expect } from 'vitest';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    groupKeyForRow,
    groupPrefixForFilename,
    planSrtWrites,
    runWriteSrtToCsv,
} from './write-srt-to-csv.mjs';
import { parseCsv } from './lib/sheet-config-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIPELINE_DIR = path.join(ROOT, 'docs', 'video-pipeline');

function findPython() {
    for (const candidate of ['python3', 'python']) {
        const res = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
        if (!res.error && res.status === 0) return candidate;
    }
    return null;
}

// The parity case shells out to Python; `npm run test:python` is a hard gate, so
// CI always has it. Locally, skip explicitly (not silently) when it is absent.
const PYTHON = findPython();

// A CSV carrying the pipeline-computed (JSON-escaped) srt. Group `clip_a`
// (clip_a01 + clip_a02) has an srt; group `clip_b` is blank.
const CSV = [
    'filename,video_file,srt',
    'clip_a01,group-a,"1\\n00:00 --> 00:01\\nHi"',
    'clip_a02,group-a,',
    'clip_b01,group-b,',
].join('\n');
const SRT = '1\\n00:00 --> 00:01\\nHi';

// A CSV carrying a blank-`filename` row for a rendered group — the master's
// config-only rows (e.g. lesson b's `wouldyourather_a01` rows) are
// `filename`-less, so the pre-fix `filename` map collapsed them onto `''`.
const CSV_BLANK_FILENAME = [
    'filename,video_file,srt',
    'clip_a01,group-a,"1\\n00:00 --> 00:01\\nHi"',
    ',group-a,"1\\n00:00 --> 00:01\\nHi"',
].join('\n');

// The pre-fix implementation, kept here so the guard is provably failable: it
// re-keys through `filename`, so a blank-`filename` sheet row collides with the
// rendered group's blank-`filename` CSV row.
function planByFilename({ csvText, rows, sheetRows } = {}) {
    const { rows: csvRows } = parseCsv(csvText);
    const srtOf = (row) => (row.srt === undefined || row.srt === null ? '' : String(row.srt));
    const groupSrt = new Map();
    for (const row of csvRows) {
        const value = srtOf(row);
        const key = groupKeyForRow(row);
        if (value.trim() && !groupSrt.has(key)) groupSrt.set(key, value);
    }
    const byFilename = new Map();
    for (const row of csvRows) {
        const value = groupSrt.get(groupKeyForRow(row));
        if (value !== undefined && value.trim()) byFilename.set(String(row.filename ?? ''), value);
    }
    const plan = [];
    (rows || []).forEach((row, i) => {
        const value = byFilename.get(String(row.filename ?? ''));
        if (value === undefined) return;
        plan.push({ row: i, sheetRow: sheetRows ? sheetRows[i] : i + 2, column: 'srt', value });
    });
    return plan;
}

const MASTER_ROWS = [
    ['filename', 'video_file', 'srt'],
    ['clip_a01', 'group-a', 'old1'],
    ['clip_a02', 'group-a', ''],
    ['clip_b01', 'group-b', 'keepme'],
];

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

    it.skipIf(!PYTHON)('matches pipeline_lib.group_key_for_filename for the master filenames', () => {
        const python = PYTHON;
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
    const sheetRows = () => MASTER_ROWS.slice(1).map((r) => ({ filename: r[0], video_file: r[1] }));

    it('writes every sheet row of a group matched by its own step key', () => {
        const plan = planSrtWrites({ csvText: CSV, rows: sheetRows(), sheetRows: [2, 3, 4] });
        expect(plan).toEqual([
            { row: 0, sheetRow: 2, column: 'srt', value: SRT },
            { row: 1, sheetRow: 3, column: 'srt', value: SRT },
        ]);
    });

    it('writes nothing for a group whose srt is blank (never clears the cell)', () => {
        const plan = planSrtWrites({ csvText: CSV, rows: sheetRows(), sheetRows: [2, 3, 4] });
        expect(plan.some((p) => p.row === 2)).toBe(false);
    });

    // The reported branching row: `filename`-less with its own friend `video_file`
    // that no rendered group matches. The old `filename` map matched it via `''`.
    it('does not write a blank-filename row whose own video_file is not a rendered group', () => {
        const rows = [{ filename: '', video_file: '{friendCode}x-a-response-01' }];
        expect(planSrtWrites({ csvText: CSV_BLANK_FILENAME, rows, sheetRows: [7] })).toEqual([]);
    });

    it('writes a blank-filename row whose own video_file IS a rendered group', () => {
        const rows = [{ filename: '', video_file: 'group-a' }];
        expect(planSrtWrites({ csvText: CSV_BLANK_FILENAME, rows, sheetRows: [8] })).toEqual([
            { row: 0, sheetRow: 8, column: 'srt', value: SRT },
        ]);
    });

    it('writes a join sub-row with the joined SRT (keyed by its video_file)', () => {
        const joined = '1\\n00:00 --> 00:10\\njoined';
        const csv = [
            'filename,join,video_file,srt',
            'grp_i01,grp,grp_i,"1\\n00:00 --> 00:10\\njoined"',
        ].join('\n');
        const rows = [{ filename: 'grp_i01', join: 'grp', video_file: 'grp_i' }];
        expect(planSrtWrites({ csvText: csv, rows, sheetRows: [5] })).toEqual([
            { row: 0, sheetRow: 5, column: 'srt', value: joined },
        ]);
    });

    it('proves failable: the old filename map writes the blank-filename branching row', () => {
        const rows = [{ filename: '', video_file: '{friendCode}x-a-response-01' }];
        // New behavior: keyed by the row's own step key -> no write.
        expect(planSrtWrites({ csvText: CSV_BLANK_FILENAME, rows, sheetRows: [7] })).toEqual([]);
        // Old behavior: the blank filename collides -> the branching row is written.
        expect(planByFilename({ csvText: CSV_BLANK_FILENAME, rows, sheetRows: [7] })).toEqual([
            { row: 0, sheetRow: 7, column: 'srt', value: SRT },
        ]);
    });
});

describe('runWriteSrtToCsv', () => {
    const masterOf = (srtA = '', srtB = '') => [
        'filename,video_file,srt',
        `clip_a01,group-a,${srtA}`,
        'clip_a02,group-a,',
        `clip_b01,group-b,${srtB}`,
    ].join('\n');

    it('merges the rendered group srt into every matching master row', async () => {
        const messages = [];
        const res = await runWriteSrtToCsv({
            videoDataText: CSV, masterText: masterOf(), log: (m) => messages.push(String(m)),
        });
        expect(res.applied).toBe(2);
        const { rows } = parseCsv(res.csv);
        expect(rows[0].srt).toBe(SRT);
        expect(rows[1].srt).toBe(SRT);
        expect(rows[2].srt).toBe('');
        expect(messages.join('\n')).toContain('wrote 2 srt cell(s)');
    });

    it('is a no-op returning null when no rendered group matches', async () => {
        const res = await runWriteSrtToCsv({
            videoDataText: 'filename,video_file,srt\nzzz01,zzz,\n',
            masterText: masterOf(),
            log: () => {},
        });
        expect(res.plan).toEqual([]);
        expect(res.applied).toBe(0);
        expect(res.csv).toBeNull();
    });

    it('never clears a cell: blank rendered groups leave stored values alone', async () => {
        const res = await runWriteSrtToCsv({
            videoDataText: CSV, masterText: masterOf('', 'keepme'), log: () => {},
        });
        expect(parseCsv(res.csv).rows[2].srt).toBe('keepme');
    });

    it('overwrites a stale stored srt unconditionally (srt is derived)', async () => {
        const res = await runWriteSrtToCsv({
            videoDataText: CSV, masterText: masterOf('old1'), log: () => {},
        });
        expect(parseCsv(res.csv).rows[0].srt).toBe(SRT);
    });

    it('preserves the committed header casing', async () => {
        const master = 'filename,video_file,bgSound,srt\nclip_a01,group-a,S,\n';
        const res = await runWriteSrtToCsv({ videoDataText: CSV, masterText: master, log: () => {} });
        expect(res.csv.split('\n')[0]).toBe('filename,video_file,bgSound,srt');
    });
});

describe('write-srt-to-csv CLI', () => {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const SCRIPT = path.join(ROOT, 'scripts/write-srt-to-csv.mjs');
    const tmpDir = () => mkdtempSync(path.join(os.tmpdir(), 'uff-srtcsv-'));
    const run = (args) => new Promise((resolve) => {
        execFile('node', [SCRIPT, ...args], (err, stdout, stderr) => {
            resolve({ code: err ? err.code : 0, stdout, stderr });
        });
    });

    it('--help exits 0 and documents --csv/--master', async () => {
        const { code, stdout } = await run(['--help']);
        expect(code).toBe(0);
        expect(stdout).toContain('--csv=');
        expect(stdout).toContain('--master=');
    });

    it('requires --csv', async () => {
        const { code, stderr } = await run([]);
        expect(code).not.toBe(0);
        expect(stderr).toContain('--csv=<path> is required');
    });

    it('writes the merged master file and leaves no temp behind', async () => {
        const dir = tmpDir();
        try {
            const csv = path.join(dir, 'video_data.csv');
            const master = path.join(dir, 'master.csv');
            writeFileSync(csv, CSV);
            writeFileSync(master, ['filename,video_file,srt', 'clip_a01,group-a,', 'clip_b01,group-b,'].join('\n'));
            const { code, stdout } = await run([`--csv=${csv}`, `--master=${master}`]);
            expect(code).toBe(0);
            expect(stdout).toContain(`WROTE ${master}`);
            const { rows } = parseCsv(readFileSync(master, 'utf8'));
            expect(rows[0].srt).toBe(SRT);
            expect(rows[1].srt).toBe('');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('a missing master file exits non-zero with ERROR', async () => {
        const dir = tmpDir();
        try {
            const csv = path.join(dir, 'video_data.csv');
            writeFileSync(csv, CSV);
            const { code, stderr } = await run([`--csv=${csv}`, `--master=${path.join(dir, 'nope.csv')}`]);
            expect(code).not.toBe(0);
            expect(stderr).toContain('ERROR:');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
