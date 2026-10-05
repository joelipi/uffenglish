// scripts/lib/sheet-translate-utils.js
// Pure planning helpers for the authoring-sheet round trip (story 049): given
// the sheet's English source columns, decide which per-language cells to fill,
// and build the Google Sheets `values.batchUpdate` payload. No fs/fetch/process,
// so the whole diff/payload logic is unit-testable with plain objects.
//
// The sheet is the operator's editing surface; translations are machine-written
// addenda in adjacent `*_<lang>` columns. Translation ONLY fills blanks, so a
// human edit to a translation cell is never clobbered and the next config
// generation picks it up.

// Sheet-localization targets. Distinct from `CAPTION_LANGUAGES` in
// caption-utils.js (which also carries `en`/`fr`/`hi`); the app's generated
// configs localize exactly these.
export const SHEET_LANGUAGES = ['es', 'pt', 'bn'];

// The translatable fields and their English source column. `cue` and `cue_alt`
// are mutually exclusive step shapes; `subtitle_text` is the static-subtitle
// source (the `srt` column is NOT translated — the caption pipeline owns SRT).
// The translator plans from this list; the config generator reads the same
// columns independently (see sheet-config-utils.js) and the two lists must be
// kept in sync by hand.
// `level` drives group-scoped planning: lesson-level fields are planned once per
// lesson, step-level fields once per `lesson_id` + `video_file` group.
export const TRANSLATABLE_FIELDS = [
    { field: 'lesson_title', source: 'lesson_title', level: 'lesson' },
    { field: 'mission', source: 'mission', level: 'lesson' },
    { field: 'cue', source: 'cue', level: 'step' },
    { field: 'cue_alt', source: 'cue_alt', level: 'step' },
    { field: 'subtitle_text', source: 'subtitle_text', level: 'step' },
];

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

/**
 * The diff plan for a sheet: for every (group, field, lang) whose English
 * source is non-blank and whose target cell is blank across the group (or, with
 * `force`, present), emit exactly one item targeting the first source-bearing
 * row of the group. Deterministic and idempotent: a non-blank target anywhere in
 * the group is skipped unless `force`. Never throws on a blank source.
 *
 * Planning is group-scoped (story 049 §2): lesson-level fields (`lesson_title`,
 * `mission`) group by `lesson_id`; step-level fields (`cue`, `cue_alt`,
 * `subtitle_text`) group by `lesson_id` + `video_file`. This translates a
 * repeated lesson value once, on the first row of the lesson, rather than on
 * every row. When the required key columns are absent from `headers`, planning
 * falls back to one group per row (so simple fixtures still work). Blank spacer
 * rows (missing `lesson_id`/`video_file`) never create spurious plans.
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
    const headerSet = new Set((headers || []).map((h) => String(h).trim().toLowerCase()));
    const hasLessonId = headerSet.has('lesson_id');
    const hasVideoFile = headerSet.has('video_file');

    for (const { field, source, level } of TRANSLATABLE_FIELDS) {
        // Group-scope only when the key columns for this level are present;
        // otherwise fall back to one group per row.
        const canGroup = level === 'lesson' ? hasLessonId : (hasLessonId && hasVideoFile);

        const groups = new Map();
        rowsList.forEach((row, rowIndex) => {
            let key;
            if (canGroup) {
                const lessonId = cell(row, 'lesson_id').trim();
                const videoFile = cell(row, 'video_file').trim();
                if (level === 'lesson') {
                    if (!lessonId) return; // blank spacer row
                    key = `lesson|${lessonId}`;
                } else {
                    if (!lessonId || !videoFile) return; // blank spacer row
                    key = `step|${lessonId}|${videoFile}`;
                }
            } else {
                key = `row|${rowIndex}`;
            }
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(rowIndex);
        });

        for (const indices of groups.values()) {
            const firstSource = indices.find((i) => cell(rowsList[i], source).trim());
            if (firstSource === undefined) continue;
            for (const lang of languages) {
                const target = localizedColumn(field, lang);
                const groupHasTarget = indices.some((i) => cell(rowsList[i], target).trim());
                if (groupHasTarget && !force) continue; // already translated -> idempotent
                plan.push({
                    row: firstSource,
                    sheetRow: sheetRows ? sheetRows[firstSource] : firstSource + 2,
                    column: target,
                    sourceColumn: source,
                    sourceText: cell(rowsList[firstSource], source).trim(),
                    lang,
                    field,
                });
            }
        }
    }
    return plan;
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
