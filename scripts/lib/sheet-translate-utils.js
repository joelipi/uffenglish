// scripts/lib/sheet-translate-utils.js
// Pure planning helpers for the authoring-sheet round trip (story 049): given
// the sheet's English source columns, decide which per-language cells to fill,
// and build the Google Sheets `values.batchUpdate` payload. No fs/fetch/process,
// so the whole diff/payload logic is unit-testable with plain objects.
//
// The sheet is the operator's editing surface; translations are machine-written
// addenda in adjacent `*_<lang>` columns. Translation ONLY fills blanks, so a
// human edit to a translation cell is never clobbered and the next config
// generation picks it up. The `srt` column is the exception: the render pipeline
// rewrites it on every re-render, so a stored `srt_<lang>` whose cue count or
// timings no longer match the current English SRT is stale and is re-planned
// (see `srtTargetIsCurrent`). A hand-edit that keeps the cue count/timings is
// still honored; a stale cell is flagged on the plan item and logged by the CLI,
// so a re-translation is never silent.

import { validateTranslatedSrt } from './caption-utils.js';

// Sheet-localization targets. Distinct from `CAPTION_LANGUAGES` in
// caption-utils.js (which also carries `en`/`fr`/`hi`); the app's generated
// configs localize exactly these.
export const SHEET_LANGUAGES = ['es', 'pt', 'bn'];

// The translatable fields and their English source column. `cue` and `cue_alt`
// are mutually exclusive step shapes; `subtitle_text` is the static-subtitle
// source; `srt` is the pipeline's exact-timing caption document, translated
// cue-text-only by `translateSrt` (timings preserved, never retimed).
// The translator plans from this list; the config generator reads the same
// columns independently (see sheet-config-utils.js) and the two lists must be
// kept in sync by hand.
// `level` drives group-scoped planning: lesson-level fields are planned once per
// lesson, step-level fields once per step group. A step group is
// `lesson_id` + `video_file` — except an SRT field, which keys by the
// generator's step key (`join` else `video_file`) so a joined step plans once.
// `perRow` fields (the overlay master's `phrase`, one cue element per sheet row)
// are planned per row instead of per group. `lines` marks a newline-separated,
// line-paired cell (`cue_alt` -> `cue[i]`, `choose_step_text` ->
// `chooseStep[i].text`): the planner emits one item per source-bearing row and
// the CLI guards that a translation never changes the line count. `srt` marks a
// caption document whose translation is validated by cue count + timings, not
// line count.
export const TRANSLATABLE_FIELDS = [
    { field: 'lesson_title', source: 'lesson_title', level: 'lesson' },
    { field: 'mission', source: 'mission', level: 'lesson' },
    { field: 'cue', source: 'cue', level: 'step' },
    { field: 'cue_alt', source: 'cue_alt', level: 'step', lines: true },
    { field: 'choose_step_text', source: 'choose_step_text', level: 'step', lines: true },
    { field: 'subtitle_text', source: 'subtitle_text', level: 'step' },
    { field: 'srt', source: 'srt', level: 'step', srt: true },
    { field: 'phrase', source: 'phrase', level: 'step', perRow: true },
];

// The line-paired fields, derived from the `lines` flag so the two can never
// drift. A line-paired cell is written once per source-bearing row of the group
// (mirroring the generator's per-row line pairing) and its translation must
// preserve the line count.
export const LINE_PAIRED_FIELDS = new Set(
    TRANSLATABLE_FIELDS.filter((f) => f.lines).map((f) => f.field));

/** Whether a translatable field's cell is newline-separated and line-paired. */
export function isLinePairedField(field) {
    return LINE_PAIRED_FIELDS.has(field);
}

/**
 * Whether a translatable field is an SRT caption document (translation preserves
 * cue count and timestamps, validated by `validateTranslatedSrt`, not line
 * count).
 */
export function isSrtField(field) {
    return TRANSLATABLE_FIELDS.some((f) => f.field === field && f.srt);
}

/** The per-language column name for a field, e.g. `localizedColumn('cue','pt')` -> `cue_pt`. */
export function localizedColumn(field, lang) {
    return `${field}_${lang}`;
}

/** Split a multi-line cell into trimmed, non-blank lines (cue_alt pairing). */
export function groupCueAltLines(text) {
    return String(text ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
}

/**
 * Un-escape the JSON-string form the pipeline writes into the `srt` column
 * (`\n`->newline, `"`->quote, `\\`->backslash) back to literal SRT text. Only
 * JSON string escapes are decoded, so a literal backslash survives. Shared by
 * the config generator (which emits the English subtitles) and the translator
 * (which translates them); the generator imports it from here.
 */
export function unescapeSrt(value) {
    const s = String(value ?? '');
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 1 < s.length) {
            const next = s[i + 1];
            if (next === 'n') { out += '\n'; i++; continue; }
            if (next === 't') { out += '\t'; i++; continue; }
            if (next === 'r') { out += '\r'; i++; continue; }
            if (next === '"') { out += '"'; i++; continue; }
            if (next === '\\') { out += '\\'; i++; continue; }
        }
        out += s[i];
    }
    return out;
}

/**
 * Convert Google-Sheets `values.get` rows (an array of arrays) into the same
 * `{ headers, rows }` shape `parseCsv` produces, plus `sheetRows`: the real
 * 1-based physical row of each entry in `rows`. Fully-blank interior rows are
 * skipped when building `rows`, but `sheetRows` preserves the physical
 * positions, so a write range never shifts onto the wrong row. Header keys are
 * trimmed and lower-cased and a short row resolves every missing header to "",
 * so both the CSV read path and the API read path agree on the row shape.
 *
 * @param {Array<Array<unknown>>} values
 * @returns {{ headers: string[], rows: Array<Record<string,string>>, sheetRows: number[] }}
 */
export function rowsFromValues(values) {
    // Keep the physical (1-based) row number for every non-blank row; blank
    // rows are dropped from `rows` but their absence must not renumber later
    // rows. `values.get` is requested as `A1:...`, so index 0 is row 1.
    const entries = [];
    (values || []).forEach((raw, i) => {
        if (!Array.isArray(raw) || !raw.some((c) => String(c).trim() !== '')) return;
        entries.push({ physicalRow: i + 1, raw });
    });
    if (entries.length === 0) return { headers: [], rows: [], sheetRows: [] };

    const headers = entries[0].raw.map((h) => String(h).trim().toLowerCase());
    const rows = [];
    const sheetRows = [];
    for (const { physicalRow, raw } of entries.slice(1)) {
        const row = {};
        for (let i = 0; i < headers.length; i++) {
            row[headers[i]] = raw[i] === undefined ? '' : String(raw[i]);
        }
        rows.push(row);
        sheetRows.push(physicalRow);
    }
    return { headers, rows, sheetRows };
}

function cell(row, name) {
    const v = row?.[name];
    return v === undefined || v === null ? '' : String(v);
}

function headerSetOf(headers) {
    return new Set((headers || []).map((h) => String(h).trim().toLowerCase()));
}

/**
 * Row-index groups for one translatable field. Group-scoped only when the key
 * columns for the field's level are present in `headers`; otherwise every row is
 * its own group (per-row fallback, so simple fixtures keep working).
 *
 * Lesson-level fields group by `course_id` + `lesson_id`; step-level fields by
 * `course_id` + `lesson_id` + `video_file`. With `stepKey`, a step-level field
 * groups by the generator's step key instead (`join` when set, else
 * `video_file`), so a joined master step — whose rows carry two `video_file`
 * values but one `join` — is planned once, mirroring `masterSubtitlesFor`.
 * `course_id` is part of the key because `lesson_id` is only unique within a
 * course — the generator partitions by `course_id` first, so two courses may
 * reuse `intro`/`a`/…. Blank spacer rows (missing any required key) are dropped
 * so they cannot create plans.
 */
function groupsForField(rows, headerSet, level, { stepKey = false } = {}) {
    const hasCourseId = headerSet.has('course_id');
    const hasLessonId = headerSet.has('lesson_id');
    const hasVideoFile = headerSet.has('video_file');
    const canGroup = level === 'lesson'
        ? (hasCourseId && hasLessonId)
        : (hasCourseId && hasLessonId && hasVideoFile);

    const groups = new Map();
    rows.forEach((row, rowIndex) => {
        let key;
        if (canGroup) {
            const courseId = cell(row, 'course_id').trim();
            const lessonId = cell(row, 'lesson_id').trim();
            const videoFile = cell(row, 'video_file').trim();
            if (level === 'lesson') {
                if (!courseId || !lessonId) return; // blank spacer row
                key = `lesson|${courseId}|${lessonId}`;
            } else {
                if (!courseId || !lessonId || !videoFile) return; // blank spacer row
                const step = stepKey ? (cell(row, 'join').trim() || videoFile) : videoFile;
                key = `step|${courseId}|${lessonId}|${step}`;
            }
        } else {
            key = `row|${rowIndex}`; // per-row fallback
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(rowIndex);
    });
    return groups;
}

// The group's `srt` column wins over `subtitle_text`, so its text is not
// translated. `subtitle_text` groups by `video_file` (not `join`), but a master
// sheet skips `subtitle_text` entirely, so the two keys never need to agree.
function groupUsesSrt(rows, indices) {
    return indices.some((i) => cell(rows[i], 'srt').trim());
}

/**
 * Whether the group's stored `srt_<lang>` cell is up to date with the current
 * English `srt`. The render pipeline rewrites `srt` on every re-render, so a
 * translation whose cue count or timings no longer match the English document is
 * stale and must be re-planned. A stored translation always has literal newlines
 * (the generator takes it verbatim) while the English cell is JSON-escaped, so
 * the English side is unescaped before comparison. Missing/blank -> not current.
 */
function srtTargetIsCurrent(rows, indices, source, target) {
    const existing = indices.map((i) => cell(rows[i], target).trim()).find(Boolean);
    if (!existing) return false;
    const englishIndex = indices.find((i) => cell(rows[i], source).trim());
    if (englishIndex === undefined) return false;
    const english = unescapeSrt(cell(rows[englishIndex], source).trim());
    return validateTranslatedSrt(english, existing).ok;
}

/**
 * The diff plan for a sheet: for every (group, field, lang) whose English
 * source is non-blank and whose target cell is blank across the group (or, with
 * `force`, present), emit the item(s) to fill. Deterministic and idempotent: a
 * non-blank target anywhere in the group is skipped unless `force`. Never throws
 * on a blank source.
 *
 * `cue_alt`/`choose_step_text` are flattened across the group's rows by the
 * generator, so each emits one item per source-bearing row; every other field is
 * one value written once on the group's first source-bearing row.
 * `subtitle_text` groups shadowed by a non-blank `srt` are skipped (the
 * generator gives `srt` precedence). `srt` groups by the generator's step key
 * (`join` else `video_file`) so a joined step is planned once; its `sourceText`
 * is the unescaped English document (the CLI hands it to `translateSrt`). A
 * stored `srt_<lang>` whose cue count/timings no longer match it is re-planned
 * (`stale: true`) and rewritten in place on the row the generator reads first.
 *
 * @param {object} opts
 * @param {Array<Record<string,string>>} opts.rows parsed rows (header-keyed)
 * @param {string[]} [opts.headers] the sheet header row (enables group-scoped planning)
 * @param {number[]} [opts.sheetRows] the 1-based physical row of each `rows` entry
 * @param {string[]} [opts.languages]
 * @param {boolean} [opts.force]
 * @returns {Array<{row: number, sheetRow: number, column: string, sourceColumn: string, sourceText: string, lang: string, field: string}>}
 *   `row` is the 0-based data-row index; `sheetRow` is the real 1-based sheet row.
 */
export function planSheetTranslations({
    rows, headers, sheetRows, languages = SHEET_LANGUAGES, force = false,
} = {}) {
    const plan = [];
    const rowsList = rows || [];
    const headerSet = headerSetOf(headers);

    // Master format: the overlay master's `subtitle_text` is burnt-in overlay
    // markup, never app subtitles (the master emits subtitles from `srt` only).
    // Translating it would be dead weight, so skip it when the `phrase` header is
    // present.
    const isMaster = headerSet.has('phrase');

    for (const { field, source, level, perRow, srt } of TRANSLATABLE_FIELDS) {
        if (field === 'subtitle_text' && isMaster) continue;

        if (perRow) {
            // One source value per row (the master's `phrase` -> one cue element
            // per row), so the blank/fill check is per row, not per group.
            rowsList.forEach((row, rowIndex) => {
                const sourceText = cell(row, source).trim();
                if (!sourceText) return;
                for (const lang of languages) {
                    const target = localizedColumn(field, lang);
                    if (cell(row, target).trim() && !force) continue; // already translated
                    plan.push({
                        row: rowIndex,
                        sheetRow: sheetRows ? sheetRows[rowIndex] : rowIndex + 2,
                        column: target,
                        sourceColumn: source,
                        sourceText,
                        lang,
                        field,
                    });
                }
            });
            continue;
        }

        const groups = groupsForField(rowsList, headerSet, level, { stepKey: !!srt });
        for (const indices of groups.values()) {
            const sourceIndices = indices.filter((i) => cell(rowsList[i], source).trim());
            if (sourceIndices.length === 0) continue;
            if (field === 'subtitle_text' && groupUsesSrt(rowsList, indices)) continue;
            for (const lang of languages) {
                const target = localizedColumn(field, lang);
                const targetIndex = indices.find((i) => cell(rowsList[i], target).trim());
                const groupHasTarget = targetIndex !== undefined;
                // Idempotent for every field except `srt`, where a stored
                // translation is re-planned when its cue count/timings no longer
                // match the current (re-rendered) English SRT. `stale` marks that
                // case so the CLI can log it (never a silent overwrite).
                const stale = srt && groupHasTarget && !force
                    && !srtTargetIsCurrent(rowsList, indices, source, target);
                if (groupHasTarget && !force && !stale) continue; // already translated
                // A stale/forced `srt` is rewritten in place on the row the
                // generator reads first; a fresh one lands on the step's first
                // source-bearing row. Other fields write on that same first row.
                const targetRows = isLinePairedField(field)
                    ? sourceIndices
                    : [srt && groupHasTarget ? targetIndex : sourceIndices[0]];
                for (const rowIndex of targetRows) {
                    // English is read from the step's first source row for `srt`
                    // (the write row may not carry English text); other fields
                    // read their own write row.
                    const englishIndex = srt ? sourceIndices[0] : rowIndex;
                    const rawSource = cell(rowsList[englishIndex], source).trim();
                    plan.push({
                        row: rowIndex,
                        sheetRow: sheetRows ? sheetRows[rowIndex] : rowIndex + 2,
                        column: target,
                        sourceColumn: source,
                        // `srt` is unescaped so the CLI can hand the literal
                        // document straight to translateSrt.
                        sourceText: srt ? unescapeSrt(rawSource) : rawSource,
                        lang,
                        field,
                        ...(stale ? { stale: true } : {}),
                    });
                }
            }
        }
    }
    return plan;
}

/**
 * Group-scoped count of translations already present, matching the planner's
 * notion of a group: a (field, lang) counts once per group that has any
 * non-blank target. `subtitle_text` groups shadowed by `srt` are not counted.
 * Used only for the CLI report.
 *
 * @param {object} opts
 * @param {Array<Record<string,string>>} [opts.rows]
 * @param {string[]} [opts.headers]
 * @param {string[]} [opts.languages]
 * @returns {Record<string, number>} counts keyed by language
 */
export function countPresentTranslations({ rows, headers, languages = SHEET_LANGUAGES } = {}) {
    const rowsList = rows || [];
    const headerSet = headerSetOf(headers);
    const counts = {};
    for (const lang of languages) counts[lang] = 0;

    const isMaster = headerSet.has('phrase');
    for (const { field, source, level, perRow, srt } of TRANSLATABLE_FIELDS) {
        if (field === 'subtitle_text' && isMaster) continue;
        if (perRow) {
            for (const row of rowsList) {
                if (!cell(row, source).trim()) continue;
                for (const lang of languages) {
                    if (cell(row, localizedColumn(field, lang)).trim()) counts[lang] += 1;
                }
            }
            continue;
        }
        const groups = groupsForField(rowsList, headerSet, level, { stepKey: !!srt });
        for (const indices of groups.values()) {
            if (!indices.some((i) => cell(rowsList[i], source).trim())) continue;
            if (field === 'subtitle_text' && groupUsesSrt(rowsList, indices)) continue;
            for (const lang of languages) {
                const target = localizedColumn(field, lang);
                if (!indices.some((i) => cell(rowsList[i], target).trim())) continue;
                // A stale `srt_<lang>` is not "already present" — the planner
                // will re-translate it, so it is reported as filled, not present.
                if (srt && !srtTargetIsCurrent(rowsList, indices, source, target)) continue;
                counts[lang] += 1;
            }
        }
    }
    return counts;
}

/** A 0-based column index -> A1 column letters (0 -> A, 26 -> AA). */
export function columnLetter(index) {
    let n = index;
    let out = '';
    do {
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return out;
}

/**
 * Quote a tab title for an A1 range: always single-quoted, with any embedded
 * `'` doubled (so a tab named `My Tab` or `O'Brien` produces a valid range).
 */
export function quoteSheetTitle(title) {
    return `'${String(title ?? '').replace(/'/g, "''")}'`;
}

/**
 * Build the `spreadsheets.values.batchUpdate` request body for a plan. One
 * request object per planned cell, each `{ range, values: [[text]] }`, where the
 * range is `<quoted-sheet>!<colLetter><sheetRow>`. The translated text is
 * supplied by the caller (one entry per plan item), so this stays pure.
 *
 * The range row comes from `item.sheetRow` — the real 1-based physical sheet
 * row carried through the plan — so interior blank spacer rows never shift a
 * write. `item.row + 2` is used only as a fallback for hand-built plan items.
 *
 * @param {object} opts
 * @param {Array} opts.plan output of planSheetTranslations
 * @param {string[]} opts.headers the sheet header row (column order)
 * @param {string} opts.sheetTitle the tab name for the A1 range
 * @param {string[]} opts.translations translated text, one per plan item
 * @returns {{ valueInputOption: string, data: Array<{range: string, values: string[][]}> }}
 */
export function buildBatchUpdatePayload({ plan, headers, sheetTitle, translations }) {
    const index = new Map((headers || []).map((h, i) => [String(h).trim().toLowerCase(), i]));
    const data = (plan || []).map((item, i) => {
        const colIndex = index.get(item.column);
        if (colIndex === undefined) {
            throw new Error(`column "${item.column}" not found in headers`);
        }
        const sheetRow = item.sheetRow ?? item.row + 2;
        const range = `${quoteSheetTitle(sheetTitle)}!${columnLetter(colIndex)}${sheetRow}`;
        return { range, values: [[String(translations[i] ?? '')]] };
    });
    return { valueInputOption: 'RAW', data };
}
