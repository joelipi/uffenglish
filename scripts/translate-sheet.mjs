#!/usr/bin/env node
// scripts/translate-sheet.mjs
// Story 049: translate the authoring sheet's English source columns into the
// blank per-language columns (`lesson_title_es`, `mission_pt`, `cue_es`,
// `cue_alt_es`, `subtitle_text_bn`, `srt_es`, …) and write them back into the
// sheet.
//
// The sheet is the operator's editing surface. This script only fills blanks, so
// a human edit to a translation cell is never clobbered (idempotent re-runs);
// the English source is never overwritten. The `srt` column is translated
// cue-text-only via `translateSrt` (cue numbers + timestamps preserved), so the
// app can localize captions without the caption pipeline retiming anything.
//
// Usage:
//   node scripts/translate-sheet.mjs [--sheet-id=<id>] [--tab=<name>]
//     [--languages=es,pt,bn] [--dry-run] [--force]
//
// Reads the sheet via the Google Sheets API with a service account (scope
// https://www.googleapis.com/auth/spreadsheets). The service-account key is read
// from GOOGLE_SERVICE_ACCOUNT_JSON in memory and is never written to disk.

import { pathToFileURL } from 'node:url';
import { google } from 'googleapis';
import { flagValue } from './lib/cli-utils.js';
import {
    SHEET_LANGUAGES,
    groupCueAltLines,
    isLinePairedField,
    planSheetTranslations,
    countPresentTranslations,
    quoteSheetTitle,
    buildBatchUpdatePayload,
    rowsFromValues,
} from './lib/sheet-translate-utils.js';
import { validateTranslatedSrt } from './lib/caption-utils.js';
import { translateText as realTranslateText, translateSrt as realTranslateSrt } from './lib/deepseek.js';

// The only scope requested: read + write the sheet the account can access. No
// broader scope (no Drive).
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
// The published CSV URL pins this tab's gid (scripts/generate-config-from-sheet.mjs);
// the default `--tab` resolves whichever tab carries it.
export const PUBLISHED_GID = 242913338;

const HELP = `Translate the authoring sheet's English columns into the blank
per-language columns and write them back (fills blanks only). The \`srt\` column
is translated cue-text-only, preserving cue numbers and timestamps.

Usage:
  node scripts/translate-sheet.mjs [options]

Options:
  --sheet-id=<id>       Spreadsheet id (default: GOOGLE_SHEET_ID)
  --tab=<name>          Sheet/tab name (default: the tab whose gid the published
                        CSV URL pins, ${PUBLISHED_GID})
  --languages=es,pt,bn  Target languages (default: ${SHEET_LANGUAGES.join(',')})
  --dry-run             Print the plan and would-be ranges; write nothing
  --force               Retranslate non-blank target cells (operator-only)
  --help, -h            Show this help

Requires DEEPSEEK_API_KEY and GOOGLE_SERVICE_ACCOUNT_JSON. The key is read in
memory only and never written to disk.`;

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
 * Resolve a tab title from `spreadsheets.get` metadata by gid, falling back to
 * the single sheet when the gid does not match and the spreadsheet is
 * unambiguous.
 */
export function resolveTabFromGid(meta, gid = PUBLISHED_GID) {
    const sheets = meta?.sheets || [];
    const match = sheets.find((s) => s?.properties?.sheetId === gid);
    if (match) return match.properties.title;
    if (sheets.length === 1) return sheets[0].properties.title;
    throw new Error(`could not resolve the published tab (gid ${gid}); pass --tab=<name>`);
}

/**
 * Production Google seams. The service-account JSON is parsed in memory and
 * handed straight to `GoogleAuth`; it is never written to a file.
 */
export function createSheetsSeams(env = process.env) {
    const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
    let credentials;
    try {
        credentials = JSON.parse(raw);
    } catch {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
    const auth = new google.auth.GoogleAuth({ credentials, scopes: [SHEETS_SCOPE] });
    const sheets = google.sheets({ version: 'v4', auth });
    return {
        getValues: (params) => sheets.spreadsheets.values.get(params).then((r) => r.data),
        getSpreadsheet: (params) => sheets.spreadsheets.get(params).then((r) => r.data),
        batchUpdate: (params) => sheets.spreadsheets.values.batchUpdate(params).then((r) => r.data),
    };
}

/**
 * Read one tab through the injected seams and return its parsed values. The tab
 * is resolved from the published gid when `tab` is absent. Shared by the
 * translator and the config generator's `--from-api`, so the `A1:ZZ` range and
 * the gid rule live in one place.
 *
 * @param {object} seams `{ getValues, getSpreadsheet }`
 * @param {object} target `{ sheetId, tab }`
 * @returns {Promise<{sheetTitle: string, headers: string[], rows: Array<Record<string,string>>, sheetRows: number[]}>}
 */
export async function readSheetRows({ getValues, getSpreadsheet } = {}, { sheetId, tab } = {}) {
    if (!sheetId) throw new Error('missing sheet id (--sheet-id or GOOGLE_SHEET_ID)');
    if (!getValues) throw new Error('missing Google Sheets client');
    // `getSpreadsheet` is only needed to resolve the tab from the published gid.
    if (!tab && !getSpreadsheet) throw new Error('missing Google Sheets client');

    let sheetTitle = tab;
    if (!sheetTitle) {
        const meta = await getSpreadsheet({ spreadsheetId: sheetId });
        sheetTitle = resolveTabFromGid(meta, PUBLISHED_GID);
    }
    const data = await getValues({
        spreadsheetId: sheetId,
        range: `${quoteSheetTitle(sheetTitle)}!A1:ZZ`,
    });
    const { headers, rows, sheetRows } = rowsFromValues(data?.values || []);
    return { sheetTitle, headers, rows, sheetRows };
}

/**
 * Core, dependency-injected translation pass. `getValues`/`getSpreadsheet`/
 * `batchUpdate`/`translateText`/`translateSrt` are seams so tests run with fakes
 * and no live credential. `translateText` handles plain cells; `translateSrt`
 * handles `srt` cells (cue text only, timings preserved).
 *
 * @returns {Promise<{plan: Array, payload: object|null, written: number}>}
 */
export async function runTranslateSheet({
    sheetId,
    tab,
    languages = SHEET_LANGUAGES,
    dryRun = false,
    force = false,
    getValues,
    getSpreadsheet,
    batchUpdate,
    translateText: translate = realTranslateText,
    translateSrt = realTranslateSrt,
    log = console.log,
} = {}) {
    if (!batchUpdate) throw new Error('missing Google Sheets client');

    const { sheetTitle, headers, rows, sheetRows } = await readSheetRows(
        { getValues, getSpreadsheet }, { sheetId, tab });

    const plan = planSheetTranslations({ rows, headers, sheetRows, languages, force });
    const already = countPresentTranslations({ rows, headers, languages });

    // Fail fast before any DeepSeek call or write if the sheet is missing a
    // target column the plan needs (e.g. the localization columns were never
    // added). `headers` from rowsFromValues are already trimmed + lower-cased.
    const headerSet = new Set(headers.map((h) => String(h).trim().toLowerCase()));
    const missingColumns = [...new Set(plan.map((p) => p.column))]
        .filter((column) => !headerSet.has(column));
    if (missingColumns.length > 0) {
        throw new Error(`sheet is missing target column(s): ${missingColumns.join(', ')}`);
    }

    if (plan.length === 0) {
        for (const lang of languages) log(`${lang}: 0 filled, ${already[lang] || 0} already present`);
        log('no cells to fill');
        return { plan, payload: null, written: 0 };
    }

    if (dryRun) {
        // Build ranges with empty placeholder text; no translation, no write.
        const preview = buildBatchUpdatePayload({
            plan, headers, sheetTitle, translations: plan.map(() => ''),
        });
        for (const item of preview.data) log(`[dry-run] would fill ${item.range}`);
        for (const lang of languages) {
            const filled = plan.filter((p) => p.lang === lang).length;
            log(`${lang}: ${filled} filled, ${already[lang] || 0} already present`);
        }
        return { plan, payload: preview, written: 0 };
    }

    const translations = [];
    for (const item of plan) {
        // A stale `srt_<lang>` (its timings no longer match a re-rendered English
        // SRT) is overwritten deliberately — say so, never silently.
        if (item.stale) {
            log(`STALE ${item.column} (${item.lang}): English srt changed; re-translating`);
        }
        let translated;
        if (item.field === 'srt') {
            // The planner already unescaped the English SRT (the sheet's `srt`
            // cell is the pipeline's JSON-escaped string), so `sourceText` is the
            // literal document. The result is written verbatim (the generator
            // takes `srt_<lang>` as operator text). A model that mangles cue
            // count or timestamps must fail before anything is written.
            const englishSrt = item.sourceText;
            translated = await translateSrt(englishSrt, item.lang);
            const validation = validateTranslatedSrt(englishSrt, translated);
            if (!validation.ok) {
                throw new Error(
                    `translation for ${item.column} (${item.lang}) is not a valid SRT: ${validation.reason}`
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
    const payload = buildBatchUpdatePayload({ plan, headers, sheetTitle, translations });
    await batchUpdate({ spreadsheetId: sheetId, requestBody: payload });

    for (const item of payload.data) log(`FILLED ${item.range}`);
    for (const lang of languages) {
        const filled = plan.filter((p) => p.lang === lang).length;
        log(`${lang}: ${filled} filled, ${already[lang] || 0} already present`);
    }
    return { plan, payload, written: payload.data.length };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP);
        return;
    }

    // Flag validation first, so a bad invocation fails with the flag error.
    const sheetId = flagValue(args, '--sheet-id') || process.env.GOOGLE_SHEET_ID;
    const tab = flagValue(args, '--tab');
    const languagesRaw = flagValue(args, '--languages');
    const languages = languagesRaw ? parseLanguages(languagesRaw) : SHEET_LANGUAGES;
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');

    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        console.error('ERROR: GOOGLE_SERVICE_ACCOUNT_JSON is not set. Add the service-account JSON key as a secret.');
        process.exit(1);
    }
    if (!process.env.DEEPSEEK_API_KEY) {
        console.error('ERROR: DEEPSEEK_API_KEY is not set. Set it before running the sheet translator.');
        process.exit(1);
    }
    if (!sheetId) {
        console.error('ERROR: missing sheet id. Pass --sheet-id=<id> or set GOOGLE_SHEET_ID.');
        process.exit(1);
    }

    const seams = createSheetsSeams(process.env);
    await runTranslateSheet({ sheetId, tab, languages, dryRun, force, ...seams });
}

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((e) => {
        console.error('ERROR:', e.message);
        process.exit(1);
    });
}
