#!/usr/bin/env node
// scripts/write-source-to-sheet.mjs
// Push a friend-course source config (`wouldyourather.source.txt`) into the
// operator's Google Sheet tab the pipeline reads (recorder, Modal render,
// config generator, translator). Run by .github/workflows/source-to-sheet.yml
// on every push that touches the source file, so editing the source on the
// GitHub web UI is the whole authoring action — no local commands, no middleman.
//
// The source file stays the authoring truth; the sheet tab is a derived
// artifact (same as `src/config/*.json`). Validation (JSON + structure) runs
// BEFORE any sheet write, so a bad edit fails the Action red with the reason
// instead of syncing a half-broken tab.
//
// Usage:
//   node scripts/write-source-to-sheet.mjs [--source=<path>] [--sheet-id=<id>]
//     [--tab=<name>] [--dry-run]
//
// Requires GOOGLE_SERVICE_ACCOUNT_JSON (parsed in memory, never written to
// disk). Sheet id resolution: --sheet-id, else SOURCE_SHEET_ID, else the
// default below. Tab: --tab, else SOURCE_SHEET_TAB, else the default below.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { google } from 'googleapis';
import { flagValue } from './lib/cli-utils.js';
import { parseSourceConfig, sourceToRows, MASTER_HEADER } from './lib/source-bridge-utils.js';
import { quoteSheetTitle } from './lib/sheet-translate-utils.js';
import { SHEETS_SCOPE } from './translate-sheet.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// The operator's sheet ("Main") and the tab this writer owns. Override with
// --sheet-id / --tab (or SOURCE_SHEET_ID / SOURCE_SHEET_TAB) to retarget.
export const DEFAULT_SOURCE_SHEET_ID = '17H9btBVtNAVYmPSxrwO7chN25qlblxstxJKQlX0saKA';
export const DEFAULT_SOURCE_TAB = 'wouldyourather';

const HELP = `Push a friend-course source config into the operator's sheet tab.

Usage:
  node scripts/write-source-to-sheet.mjs [options]

Options:
  --source=<path>   Source .txt file (default: <repo>/wouldyourather.source.txt)
  --sheet-id=<id>   Spreadsheet id (default: SOURCE_SHEET_ID or the owned tab's sheet)
  --tab=<name>      Sheet/tab name (default: SOURCE_SHEET_TAB or "wouldyourather")
  --dry-run         Validate and print the plan; write nothing (still reads the
                    tab list, so the secret is required even for --dry-run)
  --help, -h        Show this help

Requires GOOGLE_SERVICE_ACCOUNT_JSON. Validation runs before any write.`;

function resolveSheetId(args) {
    return flagValue(args, '--sheet-id')
        || process.env.SOURCE_SHEET_ID
        || DEFAULT_SOURCE_SHEET_ID;
}

function resolveTab(args) {
    return flagValue(args, '--tab')
        || process.env.SOURCE_SHEET_TAB
        || DEFAULT_SOURCE_TAB;
}

/**
 * Production Google seams. The service-account JSON is parsed in memory and
 * handed straight to `GoogleAuth`; it is never written to a file.
 */
export function createWriterSeams(env = process.env) {
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
        getSpreadsheet: (params) => sheets.spreadsheets.get(params).then((r) => r.data),
        addSheet: (spreadsheetId, title) => sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: [{ addSheet: { properties: { title } } }] },
        }).then((r) => r.data),
        clearValues: (spreadsheetId, range) => sheets.spreadsheets.values.clear({
            spreadsheetId, range,
        }).then((r) => r.data),
        updateValues: (spreadsheetId, range, values) => sheets.spreadsheets.values.update({
            spreadsheetId, range, valueInputOption: 'RAW',
            requestBody: { values },
        }).then((r) => r.data),
        getValues: (spreadsheetId, range) => sheets.spreadsheets.values.get({
            spreadsheetId, range,
        }).then((r) => r.data),
    };
}

/**
 * Header-keyed bridge rows to the 2D `values` array the Sheets API writes:
 * the master header first, then one row per data row in header order.
 */
export function buildSheetValues(rows) {
    return [
        [...MASTER_HEADER],
        ...(rows || []).map((row) => MASTER_HEADER.map((h) => row[h] ?? '')),
    ];
}

/**
 * Core push. Parses + validates the source BEFORE any sheet call that writes,
 * so a bad edit never leaves a half-synced tab. `seams` are injected so tests
 * run with fakes and no live credential.
 *
 * @returns {Promise<{rows: number, takes: number, written: boolean}>}
 */
export async function runWriteSourceToSheet({
    sourceText, sheetId, tab, dryRun = false,
    getSpreadsheet, addSheet, clearValues, updateValues, getValues,
    log = console.log,
} = {}) {
    if (!sheetId) throw new Error('missing sheet id (--sheet-id or SOURCE_SHEET_ID)');
    if (!tab) throw new Error('missing tab (--tab or SOURCE_SHEET_TAB)');
    // Both throw with the exact structural reason — before any write.
    const source = parseSourceConfig(sourceText);
    const rows = sourceToRows(source);
    const values = buildSheetValues(rows);
    const takes = rows.filter((r) => String(r.filename || '').trim() !== '').length;
    // The write range must fit the header: A1:ZZ is 702 columns.
    if (MASTER_HEADER.length > 702) {
        throw new Error(`master header (${MASTER_HEADER.length} cols) no longer fits the A1:ZZ write range`);
    }

    if (!getSpreadsheet) throw new Error('missing Google Sheets client');
    const meta = await getSpreadsheet({ spreadsheetId: sheetId });
    const exists = (meta?.sheets || []).some((s) => s?.properties?.title === tab);

    if (dryRun) {
        log(`[dry-run] would sync ${rows.length} rows (${takes} takes, ${MASTER_HEADER.length} cols) to tab "${tab}"${exists ? '' : ' (would create tab)'}`);
        return { rows: rows.length, takes, written: false };
    }

    if (!addSheet || !clearValues || !updateValues || !getValues) {
        throw new Error('missing Google Sheets client');
    }
    if (!exists) {
        await addSheet(sheetId, tab);
        log(`CREATED tab "${tab}"`);
    }
    const quoted = quoteSheetTitle(tab);
    // Update FIRST, then clear only the trailing rows below what was written:
    // the tab is never observed empty by a concurrent reader (recorder, Modal
    // render, generator, translator). Column width only ever grows — the master
    // header is stable, so no trailing-column clear is needed.
    await updateValues(sheetId, `${quoted}!A1`, values);
    await clearValues(sheetId, `${quoted}!A${values.length + 1}:ZZ`);
    const back = await getValues(sheetId, `${quoted}!A1:ZZ`);
    const backValues = back?.values || [];
    const backHeader = backValues[0] || [];
    if (backValues.length - 1 !== rows.length
        || backHeader.length !== MASTER_HEADER.length
        || MASTER_HEADER.some((h, i) => backHeader[i] !== h)) {
        throw new Error(
            `read-back mismatch: wrote ${rows.length} rows x ${MASTER_HEADER.length} cols, ` +
            `sheet has ${backValues.length - 1} rows x ${backHeader.length} cols`
        );
    }
    log(`SYNCED ${rows.length} rows (${takes} takes) to tab "${tab}"`);
    return { rows: rows.length, takes, written: true };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }

    const sourceFlag = flagValue(args, '--source');
    const sourcePath = sourceFlag
        ? path.resolve(sourceFlag)
        : path.join(ROOT, 'wouldyourather.source.txt');
    const sheetId = resolveSheetId(args);
    const tab = resolveTab(args);
    const dryRun = args.includes('--dry-run');

    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        console.error('ERROR: GOOGLE_SERVICE_ACCOUNT_JSON is not set. Add the service-account JSON key as a secret.');
        process.exit(1);
    }

    const sourceText = await fs.readFile(sourcePath, 'utf8');
    const seams = createWriterSeams(process.env);
    await runWriteSourceToSheet({ sourceText, sheetId, tab, dryRun, ...seams });
}

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((e) => {
        console.error('ERROR:', e.message);
        process.exit(1);
    });
}
