// scripts/generate-master-csv.test.js
// The committed master CSV regenerator: validation before any write,
// translation carry-over across regenerations, atomic output.
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGenerateMasterCsv, MASTER_CSV_REL } from './generate-master-csv.mjs';
import { parseCsv, serializeCsv } from './lib/sheet-config-utils.js';
import { MASTER_HEADER, parseSourceConfig, sourceToRows } from './lib/source-bridge-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/generate-master-csv.mjs');

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

const tmpDir = () => mkdtempSync(path.join(os.tmpdir(), 'uff-master-csv-'));

describe('runGenerateMasterCsv', () => {
    it('pins the committed store path every consumer reads', () => {
        expect(MASTER_CSV_REL).toBe('public/wouldyourather.master.csv');
    });

    it('emits the contract header with takes counted from filename rows', () => {
        const { csv, rows, takes, carried } = runGenerateMasterCsv({ sourceText: MINI_SOURCE, log: () => {} });
        const { headers, rows: back } = parseCsv(csv);
        expect(headers.join(',')).toBe(MASTER_HEADER.map((h) => h.toLowerCase()).join(','));
        expect(rows).toBe(back.length);
        expect(takes).toBe(back.filter((r) => r.filename.trim()).length);
        expect(carried).toBe(0);
    });

    it('carries translations across a regeneration and blanks reworded sources', () => {
        const first = runGenerateMasterCsv({ sourceText: MINI_SOURCE, log: () => {} });
        // Simulate a translator fill + a reword in the source.
        const { rows: prevRows } = parseCsv(first.csv);
        const filled = prevRows.map((r) => ({
            ...r,
            phrase_es: r.phrase ? `ES:${r.phrase}` : r.phrase_es,
        }));
        const prevText = serializeCsv(Object.keys(filled[0]), filled);
        const reworded = JSON.parse(MINI_SOURCE);
        reworded.pairs[0].topics[0].question[0] = 'X or Z?';
        const second = runGenerateMasterCsv({
            sourceText: JSON.stringify(reworded), prevText, log: () => {},
        });
        const { rows } = parseCsv(second.csv);
        const kept = rows.find((r) => r.phrase === 'Which is better: X or Y?');
        const dropped = rows.find((r) => r.phrase === 'X or Z?');
        expect(kept.phrase_es).toBe('ES:Which is better: X or Y?');
        expect(dropped.phrase_es).toBe('');
        expect(second.carried).toBeGreaterThan(0);
    });

    it('invalid source throws before producing any CSV', () => {
        expect(() => runGenerateMasterCsv({ sourceText: '{nope', log: () => {} }))
            .toThrow(/not valid JSON/);
    });
});

describe('generate-master-csv CLI', () => {
    it('--help exits 0 and documents the flags', async () => {
        const { code, stdout } = await new Promise((resolve) => {
            execFile('node', [SCRIPT, '--help'], (err, stdout, stderr) => {
                resolve({ code: err ? err.code : 0, stdout, stderr });
            });
        });
        expect(code).toBe(0);
        for (const flag of ['--source', '--out', '--dry-run']) expect(stdout).toContain(flag);
    });

    it('--dry-run writes nothing', async () => {
        const dir = tmpDir();
        const src = path.join(dir, 'mini.txt');
        const out = path.join(dir, 'master.csv');
        writeFileSync(src, MINI_SOURCE);
        try {
            const { code, stdout } = await new Promise((resolve) => {
                execFile('node', [SCRIPT, `--source=${src}`, `--out=${out}`, '--dry-run'], (err, stdout, stderr) => {
                    resolve({ code: err ? err.code : 0, stdout, stderr });
                });
            });
            expect(code).toBe(0);
            expect(stdout).toContain('[dry-run] would write');
            expect(() => readFileSync(out, 'utf8')).toThrow();
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('writes the file and a second run carries translations', async () => {
        const dir = tmpDir();
        const src = path.join(dir, 'mini.txt');
        const out = path.join(dir, 'master.csv');
        writeFileSync(src, MINI_SOURCE);
        const run = (extra = []) => new Promise((resolve) => {
            execFile('node', [SCRIPT, `--source=${src}`, `--out=${out}`, ...extra], (err, stdout, stderr) => {
                resolve({ code: err ? err.code : 0, stdout, stderr });
            });
        });
        try {
            expect((await run()).code).toBe(0);
            // Translator fills one cell in the committed file…
            const { rows } = parseCsv(readFileSync(out, 'utf8'));
            const headers = Object.keys(rows[0]);
            const filled = rows.map((r) => (r.phrase ? { ...r, phrase_es: `ES:${r.phrase}` } : r));
            const { serializeCsv } = await import('./lib/sheet-config-utils.js');
            writeFileSync(out, serializeCsv(headers, filled));
            // …and the next regeneration keeps it.
            const second = await run();
            expect(second.code).toBe(0);
            expect(second.stdout).toMatch(/carried\)/);
            const again = parseCsv(readFileSync(out, 'utf8')).rows;
            expect(again.find((r) => r.phrase === 'X or Y?').phrase_es).toBe('ES:X or Y?');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('an invalid source exits non-zero and leaves a good file untouched', async () => {
        const dir = tmpDir();
        const src = path.join(dir, 'mini.txt');
        const out = path.join(dir, 'master.csv');
        writeFileSync(src, MINI_SOURCE);
        const run = () => new Promise((resolve) => {
            execFile('node', [SCRIPT, `--source=${src}`, `--out=${out}`], (err, stdout, stderr) => {
                resolve({ code: err ? err.code : 0, stdout, stderr });
            });
        });
        try {
            expect((await run()).code).toBe(0);
            const good = readFileSync(out, 'utf8');
            writeFileSync(src, '{nope');
            const bad = await run();
            expect(bad.code).not.toBe(0);
            expect(bad.stderr).toContain('ERROR:');
            expect(readFileSync(out, 'utf8')).toBe(good);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

describe('real source + committed store consistency', () => {
    it('the bridge output matches the committed CSV row-for-row (ignoring translations)', () => {
        const sourceText = readFileSync(path.join(ROOT, 'wouldyourather.source.txt'), 'utf8');
        const fresh = sourceToRows(parseSourceConfig(sourceText));
        const committed = parseCsv(readFileSync(path.join(ROOT, MASTER_CSV_REL), 'utf8'));
        expect(committed.headers.join(',')).toBe(MASTER_HEADER.map((h) => h.toLowerCase()).join(','));
        expect(committed.rows.length).toBe(fresh.length);
        expect(committed.rows.filter((r) => r.filename.trim()).length)
            .toBe(fresh.filter((r) => String(r.filename || '').trim()).length);
    });
});
