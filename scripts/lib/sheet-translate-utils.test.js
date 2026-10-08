// Unit tests for the sheet translation planner (story 049, Task 1).
import { describe, it, expect } from 'vitest';
import {
    SHEET_LANGUAGES,
    TRANSLATABLE_FIELDS,
    LOCALIZATION_FIELDS,
    LINE_PAIRED_FIELDS,
    isLinePairedField,
    localizedColumn,
    groupCueAltLines,
    validateSrtCell,
    validateSrtDocument,
    planSheetTranslations,
    countPresentTranslations,
    columnLetter,
    quoteSheetTitle,
    buildBatchUpdatePayload,
    rowsFromValues,
} from './sheet-translate-utils.js';

describe('column contract', () => {
    it('exposes the three sheet languages', () => {
        expect(SHEET_LANGUAGES).toEqual(['es', 'pt', 'bn']);
    });

    it('maps exactly the seven generic translatable sources (21 columns)', () => {
        expect(TRANSLATABLE_FIELDS.map((f) => f.source)).toEqual([
            'lesson_title', 'mission', 'cue', 'cue_alt', 'choose_step_text', 'subtitle_text', 'phrase',
        ]);
        const cols = TRANSLATABLE_FIELDS.flatMap((f) =>
            SHEET_LANGUAGES.map((l) => localizedColumn(f.field, l)));
        expect(cols).toHaveLength(21);
        expect(cols).toContain('cue_pt');
        expect(cols).toContain('choose_step_text_es');
        expect(cols).toContain('subtitle_text_bn');
        expect(cols).toContain('phrase_es');
    });

    it('LOCALIZATION_FIELDS adds srt to the generic fields (24 columns total)', () => {
        expect(LOCALIZATION_FIELDS).toHaveLength(TRANSLATABLE_FIELDS.length + 1);
        expect(LOCALIZATION_FIELDS.map((f) => f.field)).toContain('srt');
        const cols = LOCALIZATION_FIELDS.flatMap((f) =>
            SHEET_LANGUAGES.map((l) => localizedColumn(f.field, l)));
        expect(cols).toHaveLength(24);
        expect(cols).toContain('srt_bn');
    });

    it('treats srt as a step field that is not line-paired', () => {
        expect(isLinePairedField('srt')).toBe(false);
    });

    it('marks cue_alt and choose_step_text as line-paired step fields', () => {
        const cueAlt = TRANSLATABLE_FIELDS.find((f) => f.field === 'cue_alt');
        const chooseText = TRANSLATABLE_FIELDS.find((f) => f.field === 'choose_step_text');
        expect(cueAlt).toMatchObject({ source: 'cue_alt', level: 'step', lines: true });
        expect(chooseText).toMatchObject({ source: 'choose_step_text', level: 'step', lines: true });
        expect(isLinePairedField('cue_alt')).toBe(true);
        expect(isLinePairedField('choose_step_text')).toBe(true);
        expect(isLinePairedField('cue')).toBe(false);
        expect(isLinePairedField('subtitle_text')).toBe(false);
        expect([...LINE_PAIRED_FIELDS].sort()).toEqual(['choose_step_text', 'cue_alt']);
    });

    it('marks phrase as a per-row step field', () => {
        const phrase = TRANSLATABLE_FIELDS.find((f) => f.field === 'phrase');
        expect(phrase).toMatchObject({ source: 'phrase', level: 'step', perRow: true });
    });

    it('localizedColumn builds field_lang', () => {
        expect(localizedColumn('cue', 'pt')).toBe('cue_pt');
        expect(localizedColumn('phrase', 'es')).toBe('phrase_es');
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
        const headers = ['course_id', 'lesson_id', 'lesson_title', 'lesson_title_es', 'lesson_title_pt'];
        const repeated = [
            { course_id: 'c', lesson_id: 'a', lesson_title: 'L', lesson_title_es: '', lesson_title_pt: '' },
            { course_id: 'c', lesson_id: 'a', lesson_title: 'L', lesson_title_es: '', lesson_title_pt: '' },
            { course_id: 'c', lesson_id: 'a', lesson_title: 'L', lesson_title_es: '', lesson_title_pt: '' },
        ];
        const plan = planSheetTranslations({ rows: repeated, headers, languages: ['es', 'pt'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:lesson_title_es', '0:lesson_title_pt']);
    });

    it('plans a step-level field once per course_id + lesson_id + video_file group', () => {
        const headers = ['course_id', 'lesson_id', 'video_file', 'cue', 'cue_es'];
        const group = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', cue: 'Q', cue_es: '' },
            { course_id: 'c', lesson_id: 'a', video_file: 'v', cue: 'Q', cue_es: '' },
            { course_id: 'c', lesson_id: 'a', video_file: 'w', cue: 'R', cue_es: '' },
        ];
        const plan = planSheetTranslations({ rows: group, headers, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:cue_es', '2:cue_es']);
    });

    it('keys groups by course_id so two courses reusing a lesson id do not merge', () => {
        const headers = ['course_id', 'lesson_id', 'lesson_title', 'lesson_title_es'];
        const rowsTwoCourses = [
            { course_id: 'alpha', lesson_id: 'a', lesson_title: 'L', lesson_title_es: '' },
            { course_id: 'alpha', lesson_id: 'a', lesson_title: 'L', lesson_title_es: '' },
            { course_id: 'beta', lesson_id: 'a', lesson_title: 'L', lesson_title_es: '' },
            { course_id: 'beta', lesson_id: 'a', lesson_title: 'L', lesson_title_es: '' },
        ];
        const plan = planSheetTranslations({ rows: rowsTwoCourses, headers, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:lesson_title_es', '2:lesson_title_es']);
    });

    it('falls back to per-row groups when course_id is absent from the header', () => {
        const headers = ['lesson_id', 'lesson_title', 'lesson_title_es'];
        const rows = [
            { lesson_id: 'a', lesson_title: 'L', lesson_title_es: '' },
            { lesson_id: 'a', lesson_title: 'L', lesson_title_es: '' },
        ];
        const plan = planSheetTranslations({ rows, headers, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:lesson_title_es', '1:lesson_title_es']);
    });

    it('skips a group whose translation is hand-edited on a later row', () => {
        const headers = ['course_id', 'lesson_id', 'lesson_title', 'lesson_title_es'];
        const rowsWithEdit = [
            { course_id: 'c', lesson_id: 'a', lesson_title: 'L', lesson_title_es: '' },
            { course_id: 'c', lesson_id: 'a', lesson_title: 'L', lesson_title_es: 'Lección' },
        ];
        expect(planSheetTranslations({ rows: rowsWithEdit, headers, languages: ['es'] })).toEqual([]);
    });

    it('does not plan spurious cells for blank spacer rows', () => {
        const headers = ['course_id', 'lesson_id', 'video_file', 'lesson_title', 'cue', 'lesson_title_es', 'cue_es'];
        const withSpacer = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', lesson_title: 'L', cue: 'Q', lesson_title_es: '', cue_es: '' },
            { course_id: '', lesson_id: '', video_file: '', lesson_title: 'STRAY', cue: 'STRAYQ', lesson_title_es: '', cue_es: '' },
        ];
        const plan = planSheetTranslations({ rows: withSpacer, headers, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:lesson_title_es', '0:cue_es']);
    });

    it('plans srt (not subtitle_text) when the group has srt (srt wins)', () => {
        const headers = ['course_id', 'lesson_id', 'video_file', 'subtitle_text', 'subtitle_text_es', 'srt', 'srt_es'];
        const rows = [{
            course_id: 'c', lesson_id: 'a', video_file: 'v',
            subtitle_text: 'Hi', subtitle_text_es: '', srt: '1\\n00:00 --> 00:01\\nHi', srt_es: '',
        }];
        const plan = planSheetTranslations({ rows, headers, languages: ['es'] });
        expect(plan.map((p) => p.column)).toEqual(['srt_es']);
        expect(plan.some((p) => p.field === 'subtitle_text')).toBe(false);
    });

    it('emits one cue_alt item per source-bearing row of the group', () => {
        const headers = ['course_id', 'lesson_id', 'video_file', 'cue_alt', 'cue_alt_es'];
        const rows = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', cue_alt: 'A\nB', cue_alt_es: '' },
            { course_id: 'c', lesson_id: 'a', video_file: 'v', cue_alt: 'C', cue_alt_es: '' },
        ];
        const plan = planSheetTranslations({ rows, headers, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}:${p.sourceText}`)).toEqual([
            '0:cue_alt_es:A\nB',
            '1:cue_alt_es:C',
        ]);
    });

    it('plans one choose_step_text_<lang> item for a step row with a multi-line source', () => {
        const headers = ['course_id', 'lesson_id', 'video_file', 'choose_step_text', 'choose_step_text_es'];
        const rows = [{ course_id: 'c', lesson_id: 'a', video_file: 'v', choose_step_text: 'Yes\nNo', choose_step_text_es: '' }];
        const plan = planSheetTranslations({ rows, headers, languages: ['es'] });
        expect(plan).toHaveLength(1);
        expect(plan[0]).toMatchObject({
            column: 'choose_step_text_es', sourceColumn: 'choose_step_text', sourceText: 'Yes\nNo', field: 'choose_step_text',
        });
    });

    it('plans nothing for a choose_step_text row whose translation is already present', () => {
        const headers = ['course_id', 'lesson_id', 'video_file', 'choose_step_text', 'choose_step_text_es'];
        const rows = [{ course_id: 'c', lesson_id: 'a', video_file: 'v', choose_step_text: 'Yes\nNo', choose_step_text_es: 'Sí\nNo' }];
        expect(planSheetTranslations({ rows, headers, languages: ['es'] })).toEqual([]);
        const forced = planSheetTranslations({ rows, headers, languages: ['es'], force: true });
        expect(forced.map((p) => p.column)).toEqual(['choose_step_text_es']);
    });

    it('emits one choose_step_text item per source-bearing row of the group (mirrors cue_alt)', () => {
        const headers = ['course_id', 'lesson_id', 'video_file', 'choose_step_text', 'choose_step_text_es'];
        const rows = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', choose_step_text: 'A\nB', choose_step_text_es: '' },
            { course_id: 'c', lesson_id: 'a', video_file: 'v', choose_step_text: 'C', choose_step_text_es: '' },
        ];
        const plan = planSheetTranslations({ rows, headers, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}:${p.sourceText}`)).toEqual([
            '0:choose_step_text_es:A\nB',
            '1:choose_step_text_es:C',
        ]);
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

// Story 050, Task 6: the overlay master's `phrase` is a per-row step field (one
// cue element per row), and the master's subtitle_text (burnt-in overlay markup)
// is never translated.
describe('phrase and master-format planning', () => {
    const masterHeaders = ['course_id', 'lesson_id', 'video_file', 'phrase', 'phrase_es', 'phrase_pt', 'phrase_bn', 'subtitle_text', 'subtitle_text_es'];
    const masterRows = [
        { course_id: 'c', lesson_id: 'a', video_file: 'v', phrase: 'Q1', phrase_es: '', phrase_pt: '', phrase_bn: '', subtitle_text: '<aside>x</aside>', subtitle_text_es: '' },
        { course_id: 'c', lesson_id: 'a', video_file: 'v', phrase: 'Q2', phrase_es: '', phrase_pt: '', phrase_bn: '', subtitle_text: '', subtitle_text_es: '' },
    ];

    it('plans phrase_<lang> for every row with a non-blank phrase (per row, not per group)', () => {
        const plan = planSheetTranslations({ rows: masterRows, headers: masterHeaders, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:phrase_es', '1:phrase_es']);
        expect(plan.every((p) => p.field === 'phrase' && p.sourceColumn === 'phrase')).toBe(true);
    });

    it('skips a filled phrase_<lang> per row (blanks-only), unless force', () => {
        const rows = [
            { ...masterRows[0], phrase_es: 'Q1-es' },
            masterRows[1],
        ];
        const skipped = planSheetTranslations({ rows, headers: masterHeaders, languages: ['es'] });
        expect(skipped.map((p) => `${p.row}:${p.column}`)).toEqual(['1:phrase_es']);
        const forced = planSheetTranslations({ rows, headers: masterHeaders, languages: ['es'], force: true });
        expect(forced.map((p) => `${p.row}:${p.column}`)).toEqual(['0:phrase_es', '1:phrase_es']);
    });

    it('never plans subtitle_text_<lang> on a master sheet', () => {
        const plan = planSheetTranslations({ rows: masterRows, headers: masterHeaders, languages: ['es', 'pt', 'bn'] });
        expect(plan.map((p) => p.column)).not.toContain('subtitle_text_es');
        expect(plan.some((p) => p.field === 'subtitle_text')).toBe(false);
    });

    it('still plans subtitle_text on an authoring sheet (no phrase header)', () => {
        const headers = ['course_id', 'lesson_id', 'video_file', 'subtitle_text', 'subtitle_text_es'];
        const rows = [{ course_id: 'c', lesson_id: 'a', video_file: 'v', subtitle_text: 'Hi', subtitle_text_es: '' }];
        const plan = planSheetTranslations({ rows, headers, languages: ['es'] });
        expect(plan.map((p) => p.column)).toEqual(['subtitle_text_es']);
    });
});

// Story 056: the pipeline's `srt` column is translated cue-text-only into
// `srt_<lang>` (timings preserved by translateSrt). It is a step-level field
// keyed by the generator's step key (`join` else `video_file`), so a joined step
// is planned once.
describe('validateSrtCell', () => {
    const english = '1\\n00:00:00,000 --> 00:00:01,000\\nHi';

    it('accepts a translation that preserves cues and timings (after unescaping)', () => {
        expect(validateSrtCell(english, '1\n00:00:00,000 --> 00:00:01,000\nHola')).toEqual({ ok: true });
    });

    it('rejects a translation with different cue count/timings', () => {
        expect(validateSrtCell(english, '1\n00:00:00,000 --> 00:00:09,000\nHola').ok).toBe(false);
    });

    it('rejects an empty or unparseable English SRT (never a vacuous pass)', () => {
        expect(validateSrtCell('', 'anything').ok).toBe(false);
        expect(validateSrtCell('not an srt', 'also not an srt').ok).toBe(false);
        expect(validateSrtCell('', '').reason).toMatch(/no parseable cues/);
    });

    it('validateSrtDocument applies the same rule to literal documents (the translator path)', () => {
        const literal = '1\n00:00:00,000 --> 00:00:01,000\nHi';
        expect(validateSrtDocument(literal, '1\n00:00:00,000 --> 00:00:01,000\nHola')).toEqual({ ok: true });
        expect(validateSrtDocument('not an srt', 'also not an srt').ok).toBe(false);
        expect(validateSrtDocument(literal, 'not an srt').ok).toBe(false);
    });
});

describe('srt planning', () => {
    // A master header (the `phrase` column marks the shape) so `join` grouping
    // applies; the authoring shape groups by `video_file` only.
    const headers = ['course_id', 'lesson_id', 'video_file', 'join', 'phrase', 'srt', 'srt_es'];
    const escaped = '1\\n00:00:00,000 --> 00:00:01,000\\nHi';
    const literal = '1\n00:00:00,000 --> 00:00:01,000\nHi';
    const translated = '1\n00:00:00,000 --> 00:00:01,000\nHola';

    it('plans srt_<lang> once per step group, unescaping the English source', () => {
        const rows = [{ course_id: 'c', lesson_id: 'a', video_file: 'v', join: '', srt: escaped }];
        const plan = planSheetTranslations({ rows, headers, languages: ['es'] });
        expect(plan).toHaveLength(1);
        expect(plan[0]).toMatchObject({
            row: 0, column: 'srt_es', sourceColumn: 'srt', sourceText: literal, lang: 'es', field: 'srt',
        });
    });

    it('skips a stored srt_<lang> whose timings match the English SRT (idempotent)', () => {
        const rows = [{ course_id: 'c', lesson_id: 'a', video_file: 'v', join: '', srt: escaped, srt_es: translated }];
        expect(planSheetTranslations({ rows, headers, languages: ['es'] })).toEqual([]);
        expect(countPresentTranslations({ rows, headers, languages: ['es'] })).toEqual({ es: 1 });
        expect(planSheetTranslations({ rows, headers, languages: ['es'], force: true }).map((p) => p.column))
            .toEqual(['srt_es']);
    });

    it('re-plans a stored srt_<lang> whose timings drifted, marking it stale and rewriting in place', () => {
        // The pipeline rewrote `srt` with new timings; the old translation is stale.
        const rows = [{
            course_id: 'c', lesson_id: 'a', video_file: 'v', join: '',
            srt: '1\\n00:00:00,000 --> 00:00:09,000\\nHi', srt_es: translated,
        }];
        const plan = planSheetTranslations({ rows, headers, languages: ['es'] });
        expect(plan).toHaveLength(1);
        expect(plan[0]).toMatchObject({ row: 0, column: 'srt_es', stale: true });
        // A stale cell is not counted as already present (it will be refilled).
        expect(countPresentTranslations({ rows, headers, languages: ['es'] })).toEqual({ es: 0 });
    });

    it('rewrites a stale srt_<lang> on the row the generator reads first, not the source row', () => {
        // Target on an earlier row than the English source: the generator's
        // firstNonBlank reads row 0, so the fresh value must land there.
        const rows = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', join: '', srt: '', srt_es: translated },
            { course_id: 'c', lesson_id: 'a', video_file: 'v', join: '', srt: '1\\n00:00:00,000 --> 00:00:09,000\\nHi', srt_es: '' },
        ];
        const plan = planSheetTranslations({ rows, headers, languages: ['es'] });
        expect(plan).toHaveLength(1);
        expect(plan[0]).toMatchObject({ row: 0, column: 'srt_es', stale: true, sourceText: '1\n00:00:00,000 --> 00:00:09,000\nHi' });
    });

    it('re-plans a stored srt_<lang> whose cue count drifted', () => {
        const rows = [{
            course_id: 'c', lesson_id: 'a', video_file: 'v', join: '',
            srt: '1\\n00:00:00,000 --> 00:00:01,000\\nHi\\n\\n2\\n00:00:01,000 --> 00:00:02,000\\nThere', srt_es: translated,
        }];
        expect(planSheetTranslations({ rows, headers, languages: ['es'] }).map((p) => p.column)).toEqual(['srt_es']);
    });

    it('groups a joined step by join so its shared SRT is planned once', () => {
        const rows = [
            { course_id: 'c', lesson_id: 'a', video_file: 'b_i', join: 'J', srt: escaped },
            { course_id: 'c', lesson_id: 'a', video_file: 'b_ii', join: 'J', srt: escaped },
        ];
        const plan = planSheetTranslations({ rows, headers, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:srt_es']);
    });

    it('groups by video_file on an authoring sheet (no phrase header)', () => {
        const authoringHeaders = ['course_id', 'lesson_id', 'video_file', 'srt', 'srt_es'];
        const rows = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v1', srt: escaped },
            { course_id: 'c', lesson_id: 'a', video_file: 'v2', srt: escaped },
        ];
        const plan = planSheetTranslations({ rows, headers: authoringHeaders, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:srt_es', '1:srt_es']);
    });

    it('ignores a stray join column on an authoring sheet (matches the authoring generator)', () => {
        // The authoring generator groups strictly by video_file, so the planner
        // must not merge two video_files that happen to share a `join` value.
        const authoringWithJoin = ['course_id', 'lesson_id', 'video_file', 'join', 'srt', 'srt_es'];
        const rows = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v1', join: 'J', srt: escaped },
            { course_id: 'c', lesson_id: 'a', video_file: 'v2', join: 'J', srt: escaped },
        ];
        const plan = planSheetTranslations({ rows, headers: authoringWithJoin, languages: ['es'] });
        expect(plan.map((p) => `${p.row}:${p.column}`)).toEqual(['0:srt_es', '1:srt_es']);
    });

    it('counts a joined step srt_<lang> once', () => {
        const rows = [
            { course_id: 'c', lesson_id: 'a', video_file: 'b_i', join: 'J', srt: escaped, srt_es: translated },
            { course_id: 'c', lesson_id: 'a', video_file: 'b_ii', join: 'J', srt: escaped },
        ];
        expect(countPresentTranslations({ rows, headers, languages: ['es'] })).toEqual({ es: 1 });
    });
});

describe('countPresentTranslations', () => {
    it('counts a repeated lesson value once per group, not per row', () => {
        const headers = ['course_id', 'lesson_id', 'lesson_title', 'lesson_title_es'];
        const rows = [
            { course_id: 'c', lesson_id: 'a', lesson_title: 'L', lesson_title_es: 'Lección' },
            { course_id: 'c', lesson_id: 'a', lesson_title: 'L', lesson_title_es: '' },
            { course_id: 'c', lesson_id: 'a', lesson_title: 'L', lesson_title_es: '' },
        ];
        expect(countPresentTranslations({ rows, headers, languages: ['es'] })).toEqual({ es: 1 });
    });

    it('does not count a subtitle_text group shadowed by srt', () => {
        const headers = ['course_id', 'lesson_id', 'video_file', 'subtitle_text', 'subtitle_text_es', 'srt'];
        const rows = [{
            course_id: 'c', lesson_id: 'a', video_file: 'v',
            subtitle_text: 'Hi', subtitle_text_es: 'Hola', srt: '1\\n00:00 --> 00:01\\nHi',
        }];
        expect(countPresentTranslations({ rows, headers, languages: ['es'] })).toEqual({ es: 0 });
    });

    it('counts a non-blank choose_step_text_es once for the step group', () => {
        const headers = ['course_id', 'lesson_id', 'video_file', 'choose_step_text', 'choose_step_text_es'];
        const rows = [{
            course_id: 'c', lesson_id: 'a', video_file: 'v',
            choose_step_text: 'Yes\nNo', choose_step_text_es: 'Sí\nNo',
        }];
        expect(countPresentTranslations({ rows, headers, languages: ['es'] })).toEqual({ es: 1 });
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
