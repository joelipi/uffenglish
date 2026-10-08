// scripts/translate-sheet.test.js
// Story 049, Task 3: the sheet-translation CLI with injected Google + DeepSeek
// seams. No live credential is used anywhere — the core pass takes fakes, and
// the subprocess cases only exercise --help / validation errors.
import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTranslateSheet, parseLanguages, resolveTabFromGid } from './translate-sheet.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/translate-sheet.mjs');

const HEADER = ['lesson_title', 'lesson_title_es', 'cue', 'cue_es', 'cue_alt', 'cue_alt_es'];

function makeClient(values) {
    return {
        getValues: vi.fn(async () => ({ values })),
        getSpreadsheet: vi.fn(async () => ({
            sheets: [{ properties: { sheetId: 289451687, title: 'Sheet1' } }],
        })),
        batchUpdate: vi.fn(async () => ({ data: {} })),
    };
}

function collector() {
    const messages = [];
    return { messages, log: (m) => messages.push(String(m)) };
}

describe('runTranslateSheet', () => {
    it('issues exactly one batchUpdate with one range per planned cell', async () => {
        const values = [HEADER, ['Hello', '', 'Q', '', '', '']];
        const client = makeClient(values);
        const translateText = vi.fn(async (text, lang) => `${lang}:${text}`);
        const { messages, log } = collector();

        const res = await runTranslateSheet({
            sheetId: 'SHEET', tab: 'Sheet1', languages: ['es'],
            ...client, translateText, log,
        });

        expect(client.batchUpdate).toHaveBeenCalledTimes(1);
        const request = client.batchUpdate.mock.calls[0][0];
        expect(request.spreadsheetId).toBe('SHEET');
        expect(request.requestBody.valueInputOption).toBe('RAW');
        expect(request.requestBody.data).toEqual([
            { range: "'Sheet1'!B2", values: [['es:Hello']] },
            { range: "'Sheet1'!D2", values: [['es:Q']] },
        ]);
        expect(translateText).toHaveBeenCalledTimes(2);
        expect(res.written).toBe(2);
        expect(messages.join('\n')).toContain('es: 2 filled, 0 already present');
        expect(messages.join('\n')).toContain("FILLED 'Sheet1'!B2");
    });

    it('is idempotent: a filled target plans zero cells and issues no batchUpdate', async () => {
        const values = [HEADER, ['Hello', 'Hola', 'Q', 'Pregunta', '', '']];
        const client = makeClient(values);
        const translateText = vi.fn(async (t) => t);
        const { messages, log } = collector();

        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'],
            ...client, translateText, log,
        });

        expect(res.plan).toEqual([]);
        expect(client.batchUpdate).not.toHaveBeenCalled();
        expect(translateText).not.toHaveBeenCalled();
        expect(messages.join('\n')).toContain('no cells to fill');
        expect(messages.join('\n')).toContain('es: 0 filled, 2 already present');
    });

    it('--dry-run issues no batchUpdate but prints the would-be ranges', async () => {
        const values = [HEADER, ['Hello', '', 'Q', '', '', '']];
        const client = makeClient(values);
        const { messages, log } = collector();

        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], dryRun: true,
            ...client, translateText: vi.fn(), log,
        });

        expect(client.batchUpdate).not.toHaveBeenCalled();
        expect(res.written).toBe(0);
        expect(messages.join('\n')).toContain("[dry-run] would fill 'Sheet1'!B2");
        expect(messages.join('\n')).toContain("[dry-run] would fill 'Sheet1'!D2");
    });

    it('--languages=es only plans _es cells (never _pt)', async () => {
        const header = ['lesson_title', 'lesson_title_es', 'lesson_title_pt'];
        const values = [header, ['Hello', '', '']];
        const client = makeClient(values);
        const { log } = collector();
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client, translateText: vi.fn(async (t) => t), log,
        });
        expect(res.plan.map((p) => p.column)).toEqual(['lesson_title_es']);
        expect(client.batchUpdate.mock.calls[0][0].requestBody.data.map((d) => d.range)).toEqual(["'Sheet1'!B2"]);
    });

    it('--force retranslates a filled target', async () => {
        const values = [HEADER, ['Hello', 'Hola', '', '', '', '']];
        const client = makeClient(values);
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], force: true,
            ...client, translateText: vi.fn(async () => 'Nueva'), log: () => {},
        });
        expect(res.plan.map((p) => p.column)).toEqual(['lesson_title_es']);
        expect(client.batchUpdate.mock.calls[0][0].requestBody.data[0].values).toEqual([['Nueva']]);
    });

    it('resolves the default tab from the published gid when --tab is absent', async () => {
        const values = [['lesson_title', 'lesson_title_es'], ['Hi', '']];
        const client = makeClient(values);
        await runTranslateSheet({
            sheetId: 'S', languages: ['es'], ...client,
            translateText: vi.fn(async (t) => t), log: () => {},
        });
        expect(client.getSpreadsheet).toHaveBeenCalledWith({ spreadsheetId: 'S' });
        expect(client.batchUpdate.mock.calls[0][0].requestBody.data[0].range).toBe("'Sheet1'!B2");
    });

    it('targets the physical sheet row when the sheet has an interior blank row', async () => {
        const values = [
            ['lesson_title', 'lesson_title_es'],
            ['First', ''],
            ['', ''], // physical row 3: blank spacer
            ['Second', ''], // physical row 4
        ];
        const client = makeClient(values);
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client,
            translateText: vi.fn(async (t) => `T:${t}`), log: () => {},
        });
        expect(res.plan.map((p) => p.sheetRow)).toEqual([2, 4]);
        expect(client.batchUpdate.mock.calls[0][0].requestBody.data.map((d) => d.range))
            .toEqual(["'Sheet1'!B2", "'Sheet1'!B4"]);
    });

    it('translates a repeated lesson value once, on the first row of its lesson', async () => {
        const values = [
            ['course_id', 'lesson_id', 'video_file', 'lesson_title', 'lesson_title_es'],
            ['c', 'a', 'v1', 'Lesson', ''],
            ['c', 'a', 'v2', 'Lesson', ''],
            ['c', 'a', 'v3', 'Lesson', ''],
        ];
        const client = makeClient(values);
        const translateText = vi.fn(async (t, l) => `${l}:${t}`);
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client, translateText, log: () => {},
        });
        expect(res.plan).toHaveLength(1);
        expect(res.plan[0]).toMatchObject({ sheetRow: 2, column: 'lesson_title_es' });
        expect(translateText).toHaveBeenCalledTimes(1);
    });

    it('plans each course separately when two courses reuse a lesson id', async () => {
        const values = [
            ['course_id', 'lesson_id', 'video_file', 'lesson_title', 'lesson_title_es'],
            ['alpha', 'a', 'v1', 'Lesson', ''],
            ['alpha', 'a', 'v2', 'Lesson', ''],
            ['beta', 'a', 'v1', 'Lesson', ''],
            ['beta', 'a', 'v2', 'Lesson', ''],
        ];
        const client = makeClient(values);
        const translateText = vi.fn(async (t, l) => `${l}:${t}`);
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client, translateText, log: () => {},
        });
        expect(res.plan.map((p) => p.sheetRow)).toEqual([2, 4]);
        expect(client.batchUpdate.mock.calls[0][0].requestBody.data.map((d) => d.range))
            .toEqual(["'Sheet1'!E2", "'Sheet1'!E4"]);
    });

    it('emits one cue_alt item per source-bearing row of a step group', async () => {
        const values = [
            ['course_id', 'lesson_id', 'video_file', 'cue_alt', 'cue_alt_es'],
            ['c', 'a', 'v', 'A\nB', ''],
            ['c', 'a', 'v', 'C', ''],
        ];
        const client = makeClient(values);
        const translateText = vi.fn(async (t, l) => `${l}:${t}`);
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client, translateText, log: () => {},
        });
        expect(res.plan.map((p) => p.sheetRow)).toEqual([2, 3]);
        expect(translateText).toHaveBeenCalledTimes(2);
    });

    it('rejects a cue_alt translation whose line count changed, writing nothing', async () => {
        const values = [
            ['cue_alt', 'cue_alt_es'],
            ['A\nB', ''],
        ];
        const client = makeClient(values);
        await expect(runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client,
            translateText: vi.fn(async () => 'collapsed to one line'), log: () => {},
        })).rejects.toThrow(/cue_alt line count/);
        expect(client.batchUpdate).not.toHaveBeenCalled();
    });

    it('rejects a choose_step_text translation whose line count changed, naming choose_step_text', async () => {
        const values = [
            ['course_id', 'lesson_id', 'video_file', 'choose_step_text', 'choose_step_text_es'],
            ['c', 'a', 'v', 'Yes\nNo', ''],
        ];
        const client = makeClient(values);
        await expect(runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client,
            translateText: vi.fn(async () => 'collapsed to one line'), log: () => {},
        })).rejects.toThrow(/choose_step_text line count/);
        expect(client.batchUpdate).not.toHaveBeenCalled();
    });

    it('plans one choose_step_text_es item per source-bearing row of a step group', async () => {
        const values = [
            ['course_id', 'lesson_id', 'video_file', 'choose_step_text', 'choose_step_text_es'],
            ['c', 'a', 'v', 'A\nB', ''],
            ['c', 'a', 'v', 'C', ''],
        ];
        const client = makeClient(values);
        const translateText = vi.fn(async (t, l) => `${l}:${t}`);
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client, translateText, log: () => {},
        });
        expect(res.plan.map((p) => p.sheetRow)).toEqual([2, 3]);
        expect(translateText).toHaveBeenCalledTimes(2);
    });

    it('fails fast when the sheet lacks the target columns, before any translation', async () => {
        const values = [['lesson_title'], ['Hello']]; // no lesson_title_es
        const client = makeClient(values);
        const translateText = vi.fn(async (t) => t);
        await expect(runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client, translateText, log: () => {},
        })).rejects.toThrow(/missing target column\(s\): lesson_title_es/);
        expect(translateText).not.toHaveBeenCalled();
        expect(client.batchUpdate).not.toHaveBeenCalled();
    });

    // Story 050, Task 6: a master sheet translates `phrase` (per row) and never
    // touches the overlay `subtitle_text`.
    it('writes phrase_<lang> for a master sheet and leaves subtitle_text untouched', async () => {
        const values = [
            ['course_id', 'lesson_id', 'video_file', 'phrase', 'phrase_es', 'phrase_pt', 'phrase_bn', 'subtitle_text', 'subtitle_text_es'],
            ['c', 'a', 'v', 'Q1', '', '', '', '<aside>x</aside>', ''],
            ['c', 'a', 'v', 'Q2', '', '', '', '', ''],
        ];
        const client = makeClient(values);
        const translateText = vi.fn(async (t, l) => `${l}:${t}`);
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es', 'pt', 'bn'], ...client, translateText, log: () => {},
        });
        expect(res.plan.map((p) => p.column)).toEqual([
            'phrase_es', 'phrase_pt', 'phrase_bn',
            'phrase_es', 'phrase_pt', 'phrase_bn',
        ]);
        expect(res.plan.some((p) => p.field === 'subtitle_text')).toBe(false);
        const ranges = client.batchUpdate.mock.calls[0][0].requestBody.data.map((d) => d.range);
        expect(ranges).toEqual(["'Sheet1'!E2", "'Sheet1'!F2", "'Sheet1'!G2", "'Sheet1'!E3", "'Sheet1'!F3", "'Sheet1'!G3"]);
        // The overlay source column (H) and its language neighbour (I) are untouched.
        expect(ranges.some((r) => /[HI]\d/.test(r))).toBe(false);
    });

    // Story 056: the `srt` column is translated cue-text-only via the translateSrt
    // seam; the unescaped English document goes in and a literal SRT comes out.
    it('translates srt cue text with translateSrt, preserving timings, and writes srt_<lang> verbatim', async () => {
        const values = [
            ['course_id', 'lesson_id', 'video_file', 'srt', 'srt_es'],
            ['c', 'a', 'v', '1\\n00:00:00,000 --> 00:00:01,000\\nHi', ''],
        ];
        const client = makeClient(values);
        const translateText = vi.fn(async (t, l) => `${l}:${t}`);
        const translateSrt = vi.fn(async (srt, lang) => srt.replace('Hi', `${lang}:Hi`));
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client, translateText, translateSrt, log: () => {},
        });
        expect(res.plan.map((p) => p.column)).toEqual(['srt_es']);
        // The English document is unescaped before it reaches translateSrt.
        expect(translateSrt).toHaveBeenCalledWith('1\n00:00:00,000 --> 00:00:01,000\nHi', 'es');
        expect(translateText).not.toHaveBeenCalled();
        expect(client.batchUpdate.mock.calls[0][0].requestBody.data).toEqual([
            { range: "'Sheet1'!E2", values: [['1\n00:00:00,000 --> 00:00:01,000\nes:Hi']] },
        ]);
    });

    it('re-translates a stale srt_<lang> in place and logs STALE', async () => {
        const values = [
            ['course_id', 'lesson_id', 'video_file', 'srt', 'srt_es'],
            // The English SRT was re-rendered (new timings); the stored translation is stale.
            ['c', 'a', 'v', '1\\n00:00:00,000 --> 00:00:09,000\\nHi', '1\n00:00:00,000 --> 00:00:01,000\nViejo'],
        ];
        const client = makeClient(values);
        const translateSrt = vi.fn(async (srt, lang) => srt.replace('Hi', `${lang}:Hi`));
        const { messages, log } = collector();
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client,
            translateText: vi.fn(), translateSrt, log,
        });
        expect(res.plan.map((p) => p.column)).toEqual(['srt_es']);
        expect(messages.join('\n')).toContain('STALE srt_es (es)');
        expect(client.batchUpdate.mock.calls[0][0].requestBody.data).toEqual([
            { range: "'Sheet1'!E2", values: [['1\n00:00:00,000 --> 00:00:09,000\nes:Hi']] },
        ]);
    });

    it('rejects an srt translation whose timings drifted, writing nothing', async () => {
        const values = [
            ['course_id', 'lesson_id', 'video_file', 'srt', 'srt_es'],
            ['c', 'a', 'v', '1\\n00:00:00,000 --> 00:00:01,000\\nHi', ''],
        ];
        const client = makeClient(values);
        await expect(runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client,
            translateText: vi.fn(async (t) => t),
            translateSrt: vi.fn(async () => '1\n00:00:00,000 --> 00:00:02,000\nHola'),
            log: () => {},
        })).rejects.toThrow(/not a valid SRT/);
        expect(client.batchUpdate).not.toHaveBeenCalled();
    });

    it('plans no phrase cells for an authoring sheet (no phrase column)', async () => {
        const values = [['lesson_title', 'lesson_title_es'], ['Hi', '']];
        const client = makeClient(values);
        const res = await runTranslateSheet({
            sheetId: 'S', tab: 'Sheet1', languages: ['es'], ...client,
            translateText: vi.fn(async (t) => t), log: () => {},
        });
        expect(res.plan.map((p) => p.field)).not.toContain('phrase');
    });
});

describe('parseLanguages', () => {
    it('accepts the sheet languages and trims', () => {
        expect(parseLanguages('es, pt ,bn')).toEqual(['es', 'pt', 'bn']);
    });
    it('names an unknown language', () => {
        expect(() => parseLanguages('xx')).toThrow(/xx/);
    });
});

describe('resolveTabFromGid', () => {
    it('matches the gid, else falls back to a single sheet, else throws', () => {
        const meta = { sheets: [{ properties: { sheetId: 1, title: 'A' } }, { properties: { sheetId: 2, title: 'B' } }] };
        expect(resolveTabFromGid(meta, 2)).toBe('B');
        expect(resolveTabFromGid({ sheets: [{ properties: { sheetId: 9, title: 'Only' } }] }, 2)).toBe('Only');
        expect(() => resolveTabFromGid(meta, 999)).toThrow(/--tab/);
    });
});

function runCli(args, env = {}) {
    // Start from the ambient env, then drop the two secrets so a case only has
    // what it explicitly passes in `env`.
    const clean = { ...process.env };
    delete clean.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete clean.DEEPSEEK_API_KEY;
    delete clean.GOOGLE_SHEET_ID;
    Object.assign(clean, env);
    return new Promise((resolve) => {
        execFile('node', [SCRIPT, ...args], { cwd: ROOT, env: clean }, (err, stdout, stderr) => {
            resolve({ code: err ? err.code : 0, stdout, stderr });
        });
    });
}

describe('translate-sheet CLI validation', () => {
    it('--help exits 0 and lists every flag', async () => {
        const { code, stdout } = await runCli(['--help']);
        expect(code).toBe(0);
        for (const flag of ['--sheet-id', '--tab', '--languages', '--dry-run', '--force']) {
            expect(stdout).toContain(flag);
        }
    });

    it('a bare --languages errors', async () => {
        const { code, stderr } = await runCli(['--languages']);
        expect(code).not.toBe(0);
        expect(stderr).toContain('--languages requires a value');
    });

    it('--languages=xx exits non-zero naming xx', async () => {
        const { code, stderr } = await runCli(['--languages=xx', '--sheet-id=S']);
        expect(code).not.toBe(0);
        expect(stderr).toContain('xx');
    });

    it('errors clearly when GOOGLE_SERVICE_ACCOUNT_JSON is missing', async () => {
        const { code, stderr } = await runCli(['--sheet-id=S'], { DEEPSEEK_API_KEY: 'k' });
        expect(code).not.toBe(0);
        expect(stderr).toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
    });

    it('errors clearly when DEEPSEEK_API_KEY is missing', async () => {
        const { code, stderr } = await runCli(['--sheet-id=S'], { GOOGLE_SERVICE_ACCOUNT_JSON: '{}' });
        expect(code).not.toBe(0);
        expect(stderr).toContain('DEEPSEEK_API_KEY');
    });

    it('errors clearly when the sheet id is missing', async () => {
        const { code, stderr } = await runCli([], { GOOGLE_SERVICE_ACCOUNT_JSON: '{}', DEEPSEEK_API_KEY: 'k' });
        expect(code).not.toBe(0);
        expect(stderr).toMatch(/GOOGLE_SHEET_ID|--sheet-id/);
    });

    it('the raw source never writes the service-account key to disk', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).not.toContain('writeFileSync');
        expect(src).not.toMatch(/console\.log\([^)]*GOOGLE_SERVICE_ACCOUNT_JSON/);
        expect(src).toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
    });
});
