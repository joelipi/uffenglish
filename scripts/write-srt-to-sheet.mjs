#!/usr/bin/env node
// scripts/write-srt-to-sheet.mjs
// Story 050, Task 5 (Option B): write the pipeline-computed `srt` column from
// `video_data.csv` into the overlay-master sheet's `srt` column, once per group.
//
// The pipeline persists the updated CSV to R2; the sync-srt Action downloads it
// and runs this script. It overwrites `srt` unconditionally (it is derived), so
// blanks-only does not apply — but a group whose `srt` is blank is not cleared.
// Rows are matched by `filename`, and the group key mirrors `write_srt_column`'s
// per-prefix value; the value is written verbatim (the JSON-escaped string from
// the CSV), so the generator's `unescapeSrt` still applies.
//
// Usage:
//   node scripts/write-srt-to-sheet.mjs --csv=<path> [--sheet-id=<id>] [--tab=<name>]
//
// Requires GOOGLE_SERVICE_ACCOUNT_JSON. The key is read in memory only and is
// never written to disk.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { flagValue } from './lib/cli-utils.js';
import { parseCsv } from './lib/sheet-config-utils.js';
import { columnLetter, quoteSheetTitle, rowsFromValues } from './lib/sheet-translate-utils.js';
import {
    PUBLISHED_GID,
    createSheetsSeams,
    resolveTabFromGid,
} from './translate-sheet.mjs';

/**
 * Plan one write per sheet row whose `filename` belongs to a `video_file` group
 * with a non-blank `srt`. `write_srt_column` writes the group's value to every
 * CSV row of the group, so the first non-blank value is the group value; rows
 * are matched to the sheet by `filename`. Pure.
 *
 * @param {object} opts
 * @param {string} opts.csvText the `video_data.csv` text (carrying `srt`)
 * @param {Array<Record<string,string>>} opts.rows parsed sheet rows
 * @param {number[]} [opts.sheetRows] the physical 1-based sheet row of each entry
 * @returns {Array<{row:number, sheetRow:number, column:string, value:string}>}
 */
export function planSrtWrites({ csvText, rows, sheetRows } = {}) {
    const { rows: csvRows } = parseCsv(csvText);

    const groupKey = (row) => String(row.video_file ?? '').trim() || String(row.filename ?? '');
    const srtOf = (row) => (row.srt === undefined || row.srt === null ? '' : String(row.srt));

    // The group's first non-blank `srt` (the pipeline writes it to every row of
    // the group, so first non-blank is the group value).
    const groupSrt = new Map();
    for (const row of csvRows) {
        const value = srtOf(row);
        const key = groupKey(row);
        if (value.trim() && !groupSrt.has(key)) groupSrt.set(key, value);
    }

    // Every CSV filename in a written group maps to that group's value, so every
    // sheet row of the group is written (matched by `filename`).
    const byFilename = new Map();
    for (const row of csvRows) {
        const value = groupSrt.get(groupKey(row));
        if (value !== undefined && value.trim()) byFilename.set(String(row.filename ?? ''), value);
    }

    const plan = [];
    (rows || []).forEach((row, i) => {
        const value = byFilename.get(String(row.filename ?? ''));
        if (value === undefined) return;
        plan.push({ row: i, sheetRow: sheetRows ? sheetRows[i] : i + 2, column: 'srt', value });
    });
    return plan;
}

/**
 * Core, dependency-injected write pass. `getValues`/`getSpreadsheet`/`batchUpdate`
 * are seams so tests run with fakes and no live credential. Issues exactly one
 * `values.batchUpdate` (`valueInputOption: 'RAW'`).
 *
 * @returns {Promise<{plan: Array, payload: object|null, written: number}>}
 */
export async function runWriteSrtToSheet({
    sheetId,
    tab,
    csvText,
    getValues,
    getSpreadsheet,
    batchUpdate,
    log = console.log,
} = {}) {
    if (!sheetId) throw new Error('missing sheet id (--sheet-id or GOOGLE_SHEET_ID)');
    if (!getValues || !batchUpdate) throw new Error('missing Google Sheets client');

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

    const plan = planSrtWrites({ csvText, rows, sheetRows });
    if (plan.length === 0) {
        log('no srt cells to write');
        return { plan, payload: null, written: 0 };
    }

    const index = new Map(headers.map((h, i) => [String(h).trim().toLowerCase(), i]));
    const colIndex = index.get('srt');
    if (colIndex === undefined) throw new Error('sheet is missing the "srt" column');

    const payload = {
        valueInputOption: 'RAW',
        data: plan.map((item) => ({
            range: `${quoteSheetTitle(sheetTitle)}!${columnLetter(colIndex)}${item.sheetRow}`,
            values: [[item.value]],
        })),
    };
    await batchUpdate({ spreadsheetId: sheetId, requestBody: payload });
    for (const item of payload.data) log(`WROTE ${item.range}`);
    log(`wrote ${plan.length} srt cell(s)`);
    return { plan, payload, written: payload.data.length };
}

const HELP = `Write the pipeline-computed srt column from video_data.csv into the
master sheet (one batchUpdate; overwrites srt unconditionally).

Usage:
  node scripts/write-srt-to-sheet.mjs --csv=<path> [options]

Options:
  --csv=<path>       video_data.csv downloaded from R2 (required)
  --sheet-id=<id>    Spreadsheet id (default: GOOGLE_SHEET_ID)
  --tab=<name>       Sheet/tab name (default: the tab whose gid the published
                     CSV URL pins, ${PUBLISHED_GID})
  --help, -h         Show this help

Requires GOOGLE_SERVICE_ACCOUNT_JSON. The key is read in memory only.`;

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }

    const csvPath = flagValue(args, '--csv');
    const sheetId = flagValue(args, '--sheet-id') || process.env.GOOGLE_SHEET_ID;
    const tab = flagValue(args, '--tab');

    if (!csvPath) {
        console.error('ERROR: --csv=<path> is required.');
        process.exit(1);
    }
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        console.error('ERROR: GOOGLE_SERVICE_ACCOUNT_JSON is not set. Add the service-account JSON key as a secret.');
        process.exit(1);
    }
    if (!sheetId) {
        console.error('ERROR: missing sheet id. Pass --sheet-id=<id> or set GOOGLE_SHEET_ID.');
        process.exit(1);
    }

    const csvText = await readFile(csvPath, 'utf8');
    const seams = createSheetsSeams(process.env);
    await runWriteSrtToSheet({ sheetId, tab, csvText, ...seams });
}

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((e) => {
        console.error('ERROR:', e.message);
        process.exit(1);
    });
}
