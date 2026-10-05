// Unit tests for the sheet translation planner (story 049, Task 1).
import { describe, it, expect } from 'vitest';
import {
    SHEET_LANGUAGES,
    TRANSLATABLE_FIELDS,
    localizedColumn,
    groupCueAltLines,
    planSheetTranslations,
    columnLetter,
    buildBatchUpdatePayload,
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
});

describe('columnLetter', () => {
    it('maps indices to A1 letters', () => {
        expect(columnLetter(0)).toBe('A');
        expect(columnLetter(25)).toBe('Z');
        expect(columnLetter(26)).toBe('AA');
    });
});

describe('buildBatchUpdatePayload', () => {
    it('builds one RAW range per planned cell with a 1-based sheet row', () => {
        const headers = ['lesson_title', 'lesson_title_es', 'cue_es'];
        const plan = [
            { row: 0, column: 'lesson_title_es' },
            { row: 2, column: 'cue_es' },
        ];
        const payload = buildBatchUpdatePayload({
            plan, headers, sheetTitle: 'Sheet1', translations: ['Hola', 'Pregunta'],
        });
        expect(payload.valueInputOption).toBe('RAW');
        expect(payload.data).toEqual([
            { range: 'Sheet1!B2', values: [['Hola']] },
            { range: 'Sheet1!C4', values: [['Pregunta']] },
        ]);
    });

    it('throws when a planned column is absent from the headers', () => {
        expect(() => buildBatchUpdatePayload({
            plan: [{ row: 0, column: 'missing_es' }], headers: ['a'], sheetTitle: 'S', translations: ['x'],
        })).toThrow(/missing_es/);
    });
});
