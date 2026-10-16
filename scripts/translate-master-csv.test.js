// scripts/translate-master-csv.test.js
// Story 065, Task 4: the file-based translator with injected Gemini seams.
// No live credential is used anywhere — the core pass takes fakes, and the
// subprocess cases only exercise --help / validation errors.
import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTranslateCsv, applyTranslationsToRows, parseLanguages } from './translate-master-csv.mjs';
import { parseCsv, serializeCsv } from './lib/sheet-config-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/translate-master-csv.mjs');

const csvOf = (headers, rows) => serializeCsv(headers, rows.map((r) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
    return obj;
}));

function collector() {
    const messages = [];
    return { messages, log: (m) => messages.push(String(m)) };
}

describe('runTranslateCsv', () => {
    it('fills blanks and leaves human edits byte-identical', async () => {
        const csvText = csvOf(
            ['lesson_title', 'lesson_title_es', 'lesson_title_pt', 'cue', 'cue_es', 'cue_pt'],
            [['Hello', '', 'Hola a mano', 'Q', '', '']],
        );
        const translateText = vi.fn(async (text, lang) => `${lang}:${text}`);
        const { messages, log } = collector();
        const res = await runTranslateCsv({ csvText, languages: ['es', 'pt'], translateText, log });
        expect(res.applied).toBe(3);
        const { rows } = parseCsv(res.csv);
        expect(rows[0].lesson_title_es).toBe('es:Hello');
        expect(rows[0].lesson_title_pt).toBe('Hola a mano');
        expect(rows[0].cue_es).toBe('es:Q');
        expect(rows[0].cue_pt).toBe('pt:Q');
        expect(messages.join('\n')).toContain('es: 2 filled, 0 already present');
        expect(messages.join('\n')).toContain('FILLED lesson_title_es (row 2)');
    });

    it('is idempotent: filled targets plan zero cells and return no CSV', async () => {
        const csvText = csvOf(
            ['lesson_title', 'lesson_title_es'],
            [['Hello', 'Hola']],
        );
        const translateText = vi.fn(async (t) => t);
        const { messages, log } = collector();
        const res = await runTranslateCsv({ csvText, languages: ['es'], translateText, log });
        expect(res.plan).toEqual([]);
        expect(res.csv).toBeNull();
        expect(translateText).not.toHaveBeenCalled();
        expect(messages.join('\n')).toContain('no cells to fill');
    });

    it('--dry-run prints the plan and returns no CSV', async () => {
        const csvText = csvOf(
            ['lesson_title', 'lesson_title_es'],
            [['Hello', '']],
        );
        const res = await runTranslateCsv({
            csvText, languages: ['es'], dryRun: true,
            translateText: vi.fn(), log: () => {},
        });
        expect(res.csv).toBeNull();
        expect(res.applied).toBe(0);
    });

    it('dry-run preview names the column and physical row', async () => {
        const csvText = csvOf(
            ['lesson_title', 'lesson_title_es'],
            [['Hello', '']],
        );
        const { messages, log } = collector();
        await runTranslateCsv({ csvText, languages: ['es'], dryRun: true, translateText: vi.fn(), log });
        expect(messages.join('\n')).toContain('[dry-run] would fill lesson_title_es (row 2)');
    });

    it('--languages=es only plans _es cells (never _pt)', async () => {
        const csvText = csvOf(
            ['lesson_title', 'lesson_title_es', 'lesson_title_pt'],
            [['Hello', '', '']],
        );
        const res = await runTranslateCsv({
            csvText, languages: ['es'], translateText: vi.fn(async (t) => t), log: () => {},
        });
        expect(res.plan.map((p) => p.column)).toEqual(['lesson_title_es']);
    });

    it('--force retranslates a filled target', async () => {
        const csvText = csvOf(
            ['lesson_title', 'lesson_title_es'],
            [['Hello', 'Hola']],
        );
        const res = await runTranslateCsv({
            csvText, languages: ['es'], force: true,
            translateText: vi.fn(async () => 'Nueva'), log: () => {},
        });
        expect(res.plan.map((p) => p.column)).toEqual(['lesson_title_es']);
        expect(parseCsv(res.csv).rows[0].lesson_title_es).toBe('Nueva');
    });

    it('plans the physical row for dense file rows', async () => {
        const csvText = csvOf(
            ['lesson_title', 'lesson_title_es'],
            [['First', ''], ['Second', '']],
        );
        const res = await runTranslateCsv({
            csvText, languages: ['es'],
            translateText: vi.fn(async (t) => `T:${t}`), log: () => {},
        });
        expect(res.plan.map((p) => p.sheetRow)).toEqual([2, 3]);
    });

    it('rejects a cue_alt translation whose line count changed, writing nothing', async () => {
        const csvText = csvOf(
            ['cue_alt', 'cue_alt_es'],
            [['A\nB', '']],
        );
        await expect(runTranslateCsv({
            csvText, languages: ['es'],
            translateText: vi.fn(async () => 'collapsed to one line'), log: () => {},
        })).rejects.toThrow(/cue_alt line count/);
    });

    it('fails fast when the file lacks the target columns, before any translation', async () => {
        const minimal = 'lesson_title\nHello\n';
        const translateText = vi.fn(async (t) => t);
        await expect(runTranslateCsv({
            csvText: minimal, languages: ['es'], translateText, log: () => {},
        })).rejects.toThrow(/missing target column\(s\): lesson_title_es/);
        expect(translateText).not.toHaveBeenCalled();
    });

    it('translates srt cue text with translateSrt, preserving timings', async () => {
        const csvText = csvOf(
            ['course_id', 'lesson_id', 'video_file', 'srt', 'srt_es'],
            [['c', 'a', 'v', '1\\n00:00:00,000 --> 00:00:01,000\\nHi', '']],
        );
        const translateText = vi.fn(async (t, l) => `${l}:${t}`);
        const translateSrt = vi.fn(async (srt, lang) => srt.replace('Hi', `${lang}:Hi`));
        const res = await runTranslateCsv({
            csvText, languages: ['es'], translateText, translateSrt, log: () => {},
        });
        expect(res.plan.map((p) => p.column)).toEqual(['srt_es']);
        expect(translateSrt).toHaveBeenCalledWith('1\n00:00:00,000 --> 00:00:01,000\nHi', 'es');
        expect(translateText).not.toHaveBeenCalled();
        expect(parseCsv(res.csv).rows[0].srt_es).toBe('1\n00:00:00,000 --> 00:00:01,000\nes:Hi');
    });

    it('re-translates a stale srt_es in place and logs STALE', async () => {
        const csvText = csvOf(
            ['course_id', 'lesson_id', 'video_file', 'srt', 'srt_es'],
            [['c', 'a', 'v', '1\\n00:00:00,000 --> 00:00:09,000\\nHi', '1\n00:00:00,000 --> 00:00:01,000\nViejo']],
        );
        const translateSrt = vi.fn(async (srt, lang) => srt.replace('Hi', `${lang}:Hi`));
        const { messages, log } = collector();
        const res = await runTranslateCsv({
            csvText, languages: ['es'], translateText: vi.fn(), translateSrt, log,
        });
        expect(res.plan.map((p) => p.column)).toEqual(['srt_es']);
        expect(messages.join('\n')).toContain('STALE srt_es (es)');
        expect(parseCsv(res.csv).rows[0].srt_es).toBe('1\n00:00:00,000 --> 00:00:09,000\nes:Hi');
    });

    it('rejects an srt translation whose timings drifted, writing nothing', async () => {
        const csvText = csvOf(
            ['course_id', 'lesson_id', 'video_file', 'srt', 'srt_es'],
            [['c', 'a', 'v', '1\\n00:00:00,000 --> 00:00:01,000\\nHi', '']],
        );
        const out = await runTranslateCsv({
            csvText, languages: ['es'], translateText: vi.fn(async (t) => t),
            translateSrt: vi.fn(async () => '1\n00:00:00,000 --> 00:00:02,000\nHola'),
            log: () => {},
        }).then(() => 'resolved', (e) => e.message);
        expect(out).toMatch(/not a valid SRT/);
    });

    it('writes phrase_<lang> for master rows and leaves subtitle_text untouched', async () => {
        const csvText = csvOf(
            ['course_id', 'lesson_id', 'video_file', 'phrase', 'phrase_es', 'subtitle_text', 'subtitle_text_es'],
            [['c', 'a', 'v', 'Q1', '', '<aside>x</aside>', '']],
        );
        const res = await runTranslateCsv({
            csvText, languages: ['es'],
            translateText: vi.fn(async (t, l) => `${l}:${t}`), log: () => {},
        });
        expect(res.plan.map((p) => p.column)).toEqual(['phrase_es']);
        expect(res.plan.some((p) => p.field === 'subtitle_text')).toBe(false);
    });

    it('preserves the committed header casing in the written CSV', async () => {
        const raw = 'course_id,phrase,bgSound,phrase_es\nc,Q1,S,\n';
        const res = await runTranslateCsv({
            csvText: raw, languages: ['es'],
            translateText: vi.fn(async (t, l) => `${l}:${t}`), log: () => {},
        });
        expect(res.csv.split('\n')[0]).toBe('course_id,phrase,bgSound,phrase_es');
        expect(parseCsv(res.csv).rows[0].phrase_es).toBe('es:Q1');
    });

    it('applyTranslationsToRows sets planned cells and returns the count', () => {
        const rows = [{ a: '', b: '' }, { a: '', b: '' }];
        const plan = [{ row: 0, column: 'a' }, { row: 1, column: 'b' }];
        expect(applyTranslationsToRows(rows, plan, ['x', 'y'])).toBe(2);
        expect(rows).toEqual([{ a: 'x', b: '' }, { a: '', b: 'y' }]);
    });

    it('applyTranslationsToRows names a corrupt plan row instead of TypeErroring', () => {
        expect(() => applyTranslationsToRows([{ a: '' }], [{ row: 7, column: 'a' }], ['x']))
            .toThrow(/missing row 7/);
    });
});

describe('parseLanguages', () => {
    it('accepts the file languages and trims', () => {
        expect(parseLanguages('es, pt ,bn')).toEqual(['es', 'pt', 'bn']);
    });
    it('names an unknown language', () => {
        expect(() => parseLanguages('xx')).toThrow(/xx/);
    });
});

function runCli(args, env = {}) {
    const clean = { ...process.env };
    delete clean.GOOGLE_API_KEY;
    Object.assign(clean, env);
    return new Promise((resolve) => {
        execFile('node', [SCRIPT, ...args], { cwd: ROOT, env: clean }, (err, stdout, stderr) => {
            resolve({ code: err ? err.code : 0, stdout, stderr });
        });
    });
}

describe('translate-master-csv CLI validation', () => {
    it('--help exits 0 and lists every flag', async () => {
        const { code, stdout } = await runCli(['--help']);
        expect(code).toBe(0);
        for (const flag of ['--csv', '--languages', '--dry-run', '--force']) {
            expect(stdout).toContain(flag);
        }
    });

    it('a bare --languages errors', async () => {
        const { code, stderr } = await runCli(['--languages']);
        expect(code).not.toBe(0);
        expect(stderr).toContain('--languages requires a value');
    });

    it('--languages=xx exits non-zero naming xx', async () => {
        const { code, stderr } = await runCli(['--languages=xx', '--csv=x']);
        expect(code).not.toBe(0);
        expect(stderr).toContain('xx');
    });

    it('errors clearly when GOOGLE_API_KEY is missing', async () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'uff-trcsv-'));
        try {
            const file = path.join(dir, 'm.csv');
            writeFileSync(file, 'lesson_title,lesson_title_es\nHi,\n');
            const { code, stderr } = await runCli([`--csv=${file}`]);
            expect(code).not.toBe(0);
            expect(stderr).toContain('GOOGLE_API_KEY');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('errors clearly when the CSV file is missing', async () => {
        const { code, stderr } = await runCli(['--csv=/tmp/uff-no-such.csv'], { GOOGLE_API_KEY: 'k' });
        expect(code).not.toBe(0);
        expect(stderr).toContain('ERROR:');
    });

    it('the raw source carries no Google Sheets surface', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toContain('GOOGLE_API_KEY');
        expect(src).not.toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
        expect(src).not.toContain('GOOGLE_SHEET_ID');
        expect(src).not.toContain('docs.google.com');
        expect(src).not.toContain('batchUpdate');
        expect(src).not.toContain('spreadsheetId');
    });

    it('--dry-run on the committed master prints a plan and writes nothing', async () => {
        const before = readFileSync(path.join(ROOT, 'public/wouldyourather.master.csv'), 'utf8');
        const { code, stdout } = await runCli(['--dry-run'], { GOOGLE_API_KEY: 'k' });
        expect(code).toBe(0);
        expect(stdout).toContain('filled,');
        expect(readFileSync(path.join(ROOT, 'public/wouldyourather.master.csv'), 'utf8')).toBe(before);
    });
});


describe('stripTranslatedSrtPreamble normalizer', () => {
    it('leaves a clean SRT unchanged', async () => {
        const { stripTranslatedSrtPreamble } = await import('./translate-master-csv.mjs');
        const srt = '1\n00:00:00,000 --> 00:00:01,000\nHi\n';
        expect(stripTranslatedSrtPreamble(srt)).toBe(srt.trim());
    });
    it('strips a hallucinated [9] marker before cue 1', async () => {
        const { stripTranslatedSrtPreamble } = await import('./translate-master-csv.mjs');
        const srt = '[9]\n1\n00:00:00,000 --> 00:00:01,000\nHola\n';
        expect(stripTranslatedSrtPreamble(srt)).toBe('1\n00:00:00,000 --> 00:00:01,000\nHola');
    });
});
