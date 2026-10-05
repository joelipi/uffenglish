// Unit tests for the sheet translation planner (story 049, Task 1).
import { describe, it, expect } from 'vitest';
import {
    SHEET_LANGUAGES,
    TRANSLATABLE_FIELDS,
    localizedColumn,
    groupCueAltLines,
    planSheetTranslations,
    columnLetter,
    quoteSheetTitle,
    buildBatchUpdatePayload,
    rowsFromValues,
} from './sheet-translate-utils.js';

describe('column contract', () => {
    it('exposes the three sheet languages', () => {
        expect(SHEET_LANGUAGES).toEqual(['es', 'pt', 'bn']);
    });

    it('maps exactly the five translatable sources (15 columns)', () => {
        expect(TRANSLATABLE_FIELDS.map((f) => f.source)).toEqual([
            'lesson_title', 'mission', 'cue', 'cue_alt', 'subtitle_text',
        ]);
        const cols = TRANSLATABLE_FIELDS.flatMap((f) =>
            SHEET_LANGUAGES.map((l) => localizedColumn(f.field, l)));
        expect(cols).toHaveLength(15);
        expect(cols).toContain('cue_pt');
        expect(cols).toContain('subtitle_text_bn');
    });

    it('localizedColumn builds field_lang', () => {
        expect(localizedColumn('cue', 'pt')).toBe('cue_pt');
    });
});

describe('groupCueAltLines', () => {
    it('trims and drops blank lines', () => {
        expect(groupCueAltLines('a\n\n b \nc')).toEqual(['a', 'b', 'c']);
    });
});

describe('planSheetTranslations', () => {
    const rows = [
        { lesson_title: 'Lesson A', lesson_title_es: '', lesson_title_pt: 'X', mission: '' },
        { cue: 'Q1', cue_es: '', cue_pt: '', cue_alt: '', subtitle_text: 'Hi', subtitle_text_es: '' },
    ];

    it('plans blank targets with a non-blank source, skipping filled ones', () => {
        const plan = planSheetTranslations({ rows, languages: ['es', 'pt'] });
        const cols = plan.map((p) => p.column);
        expect(cols).toContain('lesson_title_es');
        expect(cols).not.toContain('lesson_title_pt');
        expect(cols).toContain('cue_es');
        expect(cols).toContain('subtitle_text_es');
    });

    it('treats whitespace-only targets as blank', () => {
        const plan = planSheetTranslations({ rows: [{ cue: 'Q', cue_es: '   ' }], languages: ['es'] });
        expect(plan.map((p) => p.column)).toContain('cue_es');
    });

    it('with force, also plans the filled target', () => {
        const plan = planSheetTranslations({ rows, languages: ['pt'], force: true });
        expect(plan.map((p) => p.column)).toContain('lesson_title_pt');
    });

    it('emits nothing for a blank English source', () => {
        const plan = planSheetTranslations({ rows: [{ lesson_title: '', cue: '' }], languages: ['es'] });
        expect(plan).toEqual([]);
    });

    it('plans cue_<lang> but not cue_alt_<lang> for a single-cue row', () => {
        const plan = planSheetTranslations({ rows: [{ cue: 'Q', cue_alt: '' }], languages: ['es'] });
        expect(plan.map((p) => p.column)).toEqual(['cue_es']);
    });

    it('plans cue_alt_<lang> but not cue_<lang> for a cue_alt row', () => {
        const plan = planSheetTranslations({ rows: [{ cue: '', cue_alt: 'a\nb' }], languages: ['es'] });
        expect(plan.map((p) => p.column)).toEqual(['cue_alt_es']);
    });

    it('is deterministic and carries the source text + 0-based row', () => {
        const plan = planSheetTranslations({ rows, languages: ['es'] });
        expect(plan[0]).toMatchObject({ row: 0, sourceColumn: 'lesson_title', sourceText: 'Lesson A', lang: 'es', field: 'lesson_title' });
    });

    it('plans a repeated lesson-level field once per language, on the first row of the lesson', () => {
        const headers = ['lesson_id', 'lesson_title', 'lesson_title_es', 'lesson_title_pt'];
        const repeated = [
            { lesson_id: 'a', lesson_title: 'L', lesson_title_es: '', lesson_title_pt: '' },
            { lesson_id: 'a', lesson_title: 'L', lesson_title_es: '', lesson_title_pt: '' },
            { lesson_id: 'a', lesson_title: 'L', lesson_title_es: '', lesson_title_pt: '' },
        ];
        const plan = planSheetTranslations({ rows: repeated, headers, languages: ['es', 'pt'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:lesson_title_es', '0:lesson_title_pt']);
    });

    it('plans a step-level field once per lesson_id + video_file group', () => {
        const headers = ['lesson_id', 'video_file', 'cue', 'cue_es'];
        const group = [
            { lesson_id: 'a', video_file: 'v', cue: 'Q', cue_es: '' },
            { lesson_id: 'a', video_file: 'v', cue: 'Q', cue_es: '' },
            { lesson_id: 'a', video_file: 'w', cue: 'R', cue_es: '' },
        ];
        const plan = planSheetTranslations({ rows: group, headers, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:cue_es', '2:cue_es']);
    });

    it('skips a group whose translation is hand-edited on a later row', () => {
        const headers = ['lesson_id', 'lesson_title', 'lesson_title_es'];
        const rowsWithEdit = [
            { lesson_id: 'a', lesson_title: 'L', lesson_title_es: '' },
            { lesson_id: 'a', lesson_title: 'L', lesson_title_es: 'Lección' },
        ];
        expect(planSheetTranslations({ rows: rowsWithEdit, headers, languages: ['es'] })).toEqual([]);
    });

    it('does not plan spurious cells for blank spacer rows', () => {
        const headers = ['lesson_id', 'video_file', 'lesson_title', 'cue', 'lesson_title_es', 'cue_es'];
        const withSpacer = [
            { lesson_id: 'a', video_file: 'v', lesson_title: 'L', cue: 'Q', lesson_title_es: '', cue_es: '' },
            { lesson_id: '', video_file: '', lesson_title: 'STRAY', cue: 'STRAYQ', lesson_title_es: '', cue_es: '' },
        ];
        const plan = planSheetTranslations({ rows: withSpacer, headers, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:lesson_title_es', '0:cue_es']);
    });

    it('carries the physical sheet row through the plan', () => {
        const plan = planSheetTranslations({
            rows: [{ lesson_title: 'L', lesson_title_es: '' }],
            sheetRows: [7],
            languages: ['es'],
        });
        expect(plan[0].sheetRow).toBe(7);
    });
});

describe('quoteSheetTitle', () => {
    it('quotes a title and doubles embedded quotes', () => {
        expect(quoteSheetTitle('My Tab')).toBe("'My Tab'");
        expect(quoteSheetTitle("O'Brien")).toBe("'O''Brien'");
        expect(quoteSheetTitle('Sheet1')).toBe("'Sheet1'");
    });
});

describe('columnLetter', () => {
    it('maps indices to A1 letters', () => {
        expect(columnLetter(0)).toBe('A');
        expect(columnLetter(25)).toBe('Z');
        expect(columnLetter(26)).toBe('AA');
    });
});

describe('buildBatchUpdatePayload', () => {
    it('builds one RAW range per planned cell with a quoted title', () => {
        const headers = ['lesson_title', 'lesson_title_es', 'cue_es'];
        const plan = [
            { row: 0, sheetRow: 2, column: 'lesson_title_es' },
            { row: 2, sheetRow: 4, column: 'cue_es' },
        ];
        const payload = buildBatchUpdatePayload({
            plan, headers, sheetTitle: 'Sheet1', translations: ['Hola', 'Pregunta'],
        });
        expect(payload.valueInputOption).toBe('RAW');
        expect(payload.data).toEqual([
            { range: "'Sheet1'!B2", values: [['Hola']] },
            { range: "'Sheet1'!C4", values: [['Pregunta']] },
        ]);
    });

    it('targets item.sheetRow (not row + 2) so blank spacer rows do not shift writes', () => {
        const headers = ['lesson_title', 'lesson_title_es'];
        // Physical rows: header=1, row A=2, blank=3, row B=4. Data index 1 lives
        // on physical row 4; row + 2 would wrongly target row 3.
        const plan = [
            { row: 0, sheetRow: 2, column: 'lesson_title_es' },
            { row: 1, sheetRow: 4, column: 'lesson_title_es' },
        ];
        const payload = buildBatchUpdatePayload({
            plan, headers, sheetTitle: 'My Tab', translations: ['A', 'B'],
        });
        expect(payload.data.map((d) => d.range)).toEqual(["'My Tab'!B2", "'My Tab'!B4"]);
    });

    it('throws when a planned column is absent from the headers', () => {
        expect(() => buildBatchUpdatePayload({
            plan: [{ row: 0, column: 'missing_es' }], headers: ['a'], sheetTitle: 'S', translations: ['x'],
        })).toThrow(/missing_es/);
    });
});

describe('rowsFromValues', () => {
    it('carries the physical 1-based row for every non-blank row', () => {
        const values = [
            ['lesson_id', 'lesson_title', 'lesson_title_es'],
            ['a', 'L', ''],
            ['', '', ''], // blank spacer row
            ['b', 'M', ''],
        ];
        const { headers, rows, sheetRows } = rowsFromValues(values);
        expect(headers).toEqual(['lesson_id', 'lesson_title', 'lesson_title_es']);
        expect(rows).toHaveLength(2);
        expect(sheetRows).toEqual([2, 4]);
        // `rows` stays clean of enumerable junk.
        expect(Object.keys(rows[0])).toEqual(['lesson_id', 'lesson_title', 'lesson_title_es']);
    });

    it('returns empty parallel arrays for empty values', () => {
        expect(rowsFromValues([])).toEqual({ headers: [], rows: [], sheetRows: [] });
    });
});
