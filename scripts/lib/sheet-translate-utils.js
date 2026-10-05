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
// This is the single source of truth for the column contract, shared by the
// translator and the config generator so they cannot drift.
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
 * `{ headers, rows }` shape `parseCsv` produces. Header keys are trimmed and
 * lower-cased and a short row resolves every missing header to "", so both the
 * CSV read path and the API read path agree on the row shape.
 *
 * @param {Array<Array<unknown>>} values
 * @returns {{ headers: string[], rows: Array<Record<string,string>> }}
 */
export function rowsFromValues(values) {
    const nonBlank = (values || [])
        .filter((r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ''));
    if (nonBlank.length === 0) return { headers: [], rows: [] };

    const headers = nonBlank[0].map((h) => String(h).trim().toLowerCase());
    const rows = nonBlank.slice(1).map((raw) => {
        const row = {};
        for (let i = 0; i < headers.length; i++) {
            row[headers[i]] = raw[i] === undefined ? '' : String(raw[i]);
        }
        return row;
    });
    return { headers, rows };
}

function cell(row, name) {
    const v = row?.[name];
    return v === undefined || v === null ? '' : String(v);
}

/**
 * The (field, lang) targets whose English source is non-blank and whose target
 * cell is blank (or, with `force`, present). Deterministic and idempotent: a
 * non-blank target is skipped unless `force`. Never throws on a blank source.
 *
 * @param {object} opts
 * @param {Array<Record<string,string>>} opts.rows parsed rows (header-keyed)
 * @param {string[]} [opts.languages]
 * @param {boolean} [opts.force]
 * @returns {Array<{row: number, column: string, sourceColumn: string, sourceText: string, lang: string, field: string}>}
 *   `row` is the 0-based data-row index (the caller adds 2 for the sheet row).
 */
export function planSheetTranslations({ rows, languages = SHEET_LANGUAGES, force = false } = {}) {
    const plan = [];
    (rows || []).forEach((row, rowIndex) => {
        for (const { field, source } of TRANSLATABLE_FIELDS) {
            const sourceText = cell(row, source).trim();
            if (!sourceText) continue;
            for (const lang of languages) {
                const target = cell(row, localizedColumn(field, lang)).trim();
                if (target && !force) continue; // already translated -> idempotent
                plan.push({
                    row: rowIndex,
                    column: localizedColumn(field, lang),
                    sourceColumn: source,
                    sourceText,
                    lang,
                    field,
                });
            }
        }
    });
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
 * Build the `spreadsheets.values.batchUpdate` request body for a plan. One
 * request object per planned cell, each `{ range, values: [[text]] }`, where the
 * range is `<sheet>!<colLetter><sheetRow>`. The translated text is supplied by
 * the caller (one entry per plan item), so this stays pure.
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
        const sheetRow = item.row + 2; // +1 for header, +1 for 1-based
        const range = `${sheetTitle}!${columnLetter(colIndex)}${sheetRow}`;
        return { range, values: [[String(translations[i] ?? '')]] };
    });
    return { valueInputOption: 'RAW', data };
}
