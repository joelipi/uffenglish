#!/usr/bin/env node
// scripts/translate-master-csv.mjs
// Story 065: translate the committed master CSV's English source columns into
// the blank per-language columns (`lesson_title_es`, `mission_pt`, `cue_es`,
// `cue_alt_es`, `subtitle_text_bn`, `srt_es`, …) and write the file back.
//
// The planning semantics are the translator's unchanged contract: only blank
// cells are filled (a human edit to a translation cell is never clobbered —
// idempotent re-runs), the English source is never overwritten, and the `srt`
// column is translated cue-text-only with cue numbers + timestamps preserved.
// Only the I/O seam changed (CSV file cells instead of Sheets API ranges);
// the pure row planners in `scripts/lib/sheet-translate-utils.js` are shared,
// not forked.
//
// Usage:
//   node scripts/translate-master-csv.mjs [--csv=<path>]
//     [--languages=es,pt,bn] [--dry-run] [--force]
//
// Requires DEEPSEEK_API_KEY. The translated file is written through a
// same-directory temp file + rename (the story-047 crash-safety rule).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagValue } from './lib/cli-utils.js';
import { parseCsv, serializeWithHeaderLine, rawHeaderLine } from './lib/sheet-config-utils.js';
import {
    SHEET_LANGUAGES,
    groupCueAltLines,
    isLinePairedField,
    planSheetTranslations,
    countPresentTranslations,
    validateSrtDocument,
} from './lib/sheet-translate-utils.js';
import { translateText as realTranslateText, translateSrt as realTranslateSrt } from './lib/deepseek.js';
import { MASTER_CSV_REL } from './generate-config-from-sheet.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HELP = `Translate the master CSV's English columns into the blank
per-language columns and write the file back (fills blanks only). The \`srt\` column
is translated cue-text-only, preserving cue numbers and timestamps.

Usage:
  node scripts/translate-master-csv.mjs [options]

Options:
  --csv=<path>          Master CSV file (default: the committed public/wouldyourather.master.csv)
  --languages=es,pt,bn  Target languages (default: ${SHEET_LANGUAGES.join(',')})
  --dry-run             Print the plan and would-be cells; write nothing
  --force               Retranslate non-blank target cells (operator-only)
  --help, -h            Show this help

Requires DEEPSEEK_API_KEY.`;

/** Parse/validate a comma-separated `--languages` value. */
export function parseLanguages(value) {
    const langs = String(value ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const unknown = langs.filter((l) => !SHEET_LANGUAGES.includes(l));
    if (unknown.length > 0) {
        throw new Error(`unknown language(s): ${unknown.join(', ')}; expected ${SHEET_LANGUAGES.join(',')}`);
    }
    return langs;
}

/**
 * Apply translated texts to their planned cells. `plan` comes from
 * `planSheetTranslations` (items carry `row` + `column`); `translations[i]` is
 * the text for `plan[i]`. Mutates `rows` in place and returns the applied
 * count — the file-CSV replacement for the old range writer.
 *
 * @param {Array<Record<string,string>>} rows parsed master rows
 * @param {Array} plan translation plan items
 * @param {string[]} translations one text per plan item
 * @returns {number} applied cell count
 */
export function applyTranslationsToRows(rows, plan, translations) {
    (plan || []).forEach((item, i) => {
        rows[item.row][item.column] = translations[i];
    });
    return (plan || []).length;
}

/**
 * Core, dependency-injected translation pass over CSV text. `translateText` /
 * `translateSrt` are seams so tests run with fakes and no live credential.
 *
 * @returns {Promise<{plan: Array, applied: number, csv: string|null}>}
 */
export async function runTranslateCsv({
    csvText,
    languages = SHEET_LANGUAGES,
    dryRun = false,
    force = false,
    translateText: translate = realTranslateText,
    translateSrt = realTranslateSrt,
    log = console.log,
} = {}) {
    const { headers, rows } = parseCsv(csvText ?? '');
    // Physical file rows are dense (no interior blanks): row i lives on
    // 1-based line i + 2, so plan ranges stay exact without a sheet grid.
    const sheetRows = rows.map((_, i) => i + 2);

    const plan = planSheetTranslations({ rows, headers, sheetRows, languages, force });
    const already = countPresentTranslations({ rows, headers, languages });

    // Fail fast before any DeepSeek call or write if the file is missing a
    // target column the plan needs.
    const headerSet = new Set(headers.map((h) => String(h).trim().toLowerCase()));
    const missingColumns = [...new Set(plan.map((p) => p.column))]
        .filter((column) => !headerSet.has(column));
    if (missingColumns.length > 0) {
        throw new Error(`master CSV is missing target column(s): ${missingColumns.join(', ')} (regenerate the master CSV)`);
    }

    if (plan.length === 0) {
        for (const lang of languages) log(`${lang}: 0 filled, ${already[lang] || 0} already present`);
        log('no cells to fill');
        return { plan, applied: 0, csv: null };
    }

    if (dryRun) {
        for (const item of plan) log(`[dry-run] would fill ${item.column} (row ${item.sheetRow})`);
        for (const lang of languages) {
            const filled = plan.filter((p) => p.lang === lang).length;
            log(`${lang}: ${filled} filled, ${already[lang] || 0} already present`);
        }
        return { plan, applied: 0, csv: null };
    }

    const translations = [];
    for (const item of plan) {
        // A stale `srt_<lang>` (its timings no longer match a re-rendered English
        // SRT) is overwritten deliberately — say so, never silently.
        if (item.stale) {
            log(`STALE ${item.column} (${item.lang}) at row ${item.sheetRow}: English srt changed; re-translating`);
        }
        let translated;
        if (item.field === 'srt') {
            // The planner already unescaped the English SRT, so `sourceText` is
            // the literal document. The result is written verbatim. A model that
            // mangles cue count or timestamps must fail before anything is written.
            const englishSrt = item.sourceText;
            translated = await translateSrt(englishSrt, item.lang);
            const validation = validateSrtDocument(englishSrt, translated);
            if (!validation.ok) {
                throw new Error(
                    `translation for ${item.column} (${item.lang}) at row ${item.sheetRow} ` +
                    `is not a valid SRT: ${validation.reason}`
                );
            }
        } else {
            translated = await translate(item.sourceText, item.lang);
            // Line-paired cells (`cue_alt`, `choose_step_text`) are paired with
            // the English lines by index by the generator; a model that
            // collapses/expands lines would silently drop translations, so reject
            // the cell before anything is written.
            if (isLinePairedField(item.field)) {
                const expected = groupCueAltLines(item.sourceText).length;
                const got = groupCueAltLines(translated).length;
                if (got !== expected) {
                    throw new Error(
                        `translation for ${item.column} (${item.lang}) changed the ${item.field} line count: ` +
                        `expected ${expected}, got ${got}`
                    );
                }
            }
        }
        translations.push(translated);
    }
    const applied = applyTranslationsToRows(rows, plan, translations);
    const csv = serializeWithHeaderLine(rawHeaderLine(csvText), headers, rows);

    for (const item of plan) log(`FILLED ${item.column} (row ${item.sheetRow})`);
    for (const lang of languages) {
        const filled = plan.filter((p) => p.lang === lang).length;
        log(`${lang}: ${filled} filled, ${already[lang] || 0} already present`);
    }
    return { plan, applied, csv };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP);
        return;
    }

    // Flag validation first, so a bad invocation fails with the flag error.
    const csvFlag = flagValue(args, '--csv');
    const csvPath = csvFlag ? path.resolve(csvFlag) : path.join(ROOT, MASTER_CSV_REL);
    const languagesRaw = flagValue(args, '--languages');
    const languages = languagesRaw ? parseLanguages(languagesRaw) : SHEET_LANGUAGES;
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');

    if (!process.env.DEEPSEEK_API_KEY) {
        console.error('ERROR: DEEPSEEK_API_KEY is not set. Set it before running the translator.');
        process.exit(1);
    }

    const csvText = await fs.readFile(csvPath, 'utf8');
    const { csv } = await runTranslateCsv({ csvText, languages, dryRun, force });
    if (dryRun || csv === null) return;

    // Same-directory temp file + rename (story-047 rule): a killed run never
    // leaves a half-written store.
    const tmpPath = `${csvPath}.tmp-${process.pid}`;
    try {
        await fs.writeFile(tmpPath, csv);
        await fs.rename(tmpPath, csvPath);
    } catch (err) {
        await fs.rm(tmpPath, { force: true });
        throw err;
    }
    console.log(`WROTE ${csvPath}`);
}

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((e) => {
        console.error('ERROR:', e.message);
        process.exit(1);
    });
}
