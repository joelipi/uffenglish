#!/usr/bin/env node
// scripts/write-srt-to-csv.mjs
// Story 065: write the pipeline-computed `srt` column from `video_data.csv`
// into the committed master CSV, once per group.
//
// The pipeline persists the updated CSV to R2; the sync-srt Action downloads it
// and runs this script. It overwrites `srt` unconditionally (it is derived), so
// blanks-only does not apply — but a group whose `srt` is blank is not cleared.
// Each master row is matched by its own step key (`video_file`, else the
// `filename` prefix) — the key `write_srt_column` grouped under — never by
// `filename` alone (several master rows share a blank `filename`). The value is
// written verbatim (the JSON-escaped string from the CSV), so the generator's
// `unescapeSrt` (sheet-translate-utils.js) still applies. The committed header
// row is preserved byte-identically (casing included).
//
// Usage:
//   node scripts/write-srt-to-csv.mjs --csv=<path> [--master=<path>]

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagValue } from './lib/cli-utils.js';
import { parseCsv, serializeWithHeaderLine, rawHeaderLine } from './lib/sheet-config-utils.js';
import { masterCsvPaths } from './generate-config-from-sheet.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// The pipeline's VIDEO_EXTENSION (`pipeline_lib.VIDEO_EXTENSION`), used by the
// legacy prefix key so the two runtimes cannot drift on the suffix.
const VIDEO_EXTENSION = '_no_silence_bg_removed.mp4';

/**
 * The legacy step key, mirroring `pipeline_lib.group_prefix_for_filename`:
 * everything before the first digit, with trailing `_- ` stripped.
 */
export function groupPrefixForFilename(filename) {
    let base = String(filename ?? '');
    if (!base.endsWith(VIDEO_EXTENSION)) base += VIDEO_EXTENSION;
    const dot = base.lastIndexOf('.');
    const nameWithoutExt = dot === -1 ? base : base.slice(0, dot);
    const match = /^([^\d]*)/.exec(nameWithoutExt);
    const prefix = match ? match[1].replace(/[-_ ]+$/, '') : nameWithoutExt;
    return prefix || nameWithoutExt;
}

/**
 * The step key for a CSV row, mirroring `pipeline_lib.group_key_for_filename`:
 * the non-blank `video_file` value when the CSV carries the column, else the
 * filename prefix. This is exactly the key the pipeline rendered and joined
 * under, so the write-back targets the same groups.
 */
export function groupKeyForRow(row) {
    const videoFile = String(row?.video_file ?? '').trim();
    return videoFile || groupPrefixForFilename(row?.filename);
}

/**
 * Plan one write per master row whose own step key (`video_file`, else the
 * `filename` prefix) belongs to a rendered group with a non-blank `srt`.
 * `write_srt_column` writes the group's value to every CSV row of the group, so
 * the first non-blank value is the group value; the master row is looked up by
 * its own `groupKeyForRow`, NOT by `filename` — several master rows share a
 * blank `filename`, so a `filename` map would collapse them onto one key and
 * stamp an unrelated group's SRT onto the branching/intro rows. A `filename`-less
 * row is written only when its own `video_file` is a rendered group. Pure.
 *
 * @param {object} opts
 * @param {string} opts.csvText the `video_data.csv` text (carrying `srt`)
 * @param {Array<Record<string,string>>} opts.rows parsed master rows
 * @param {number[]} [opts.sheetRows] the physical 1-based row of each entry
 * @returns {Array<{row:number, sheetRow:number, column:string, value:string}>}
 */
export function planSrtWrites({ csvText, rows, sheetRows } = {}) {
    const { rows: csvRows } = parseCsv(csvText);

    const srtOf = (row) => (row.srt === undefined || row.srt === null ? '' : String(row.srt));

    // The group's first non-blank `srt` (the pipeline writes it to every row of
    // the group, so first non-blank is the group value).
    const groupSrt = new Map();
    for (const row of csvRows) {
        const value = srtOf(row);
        const key = groupKeyForRow(row);
        if (value.trim() && !groupSrt.has(key)) groupSrt.set(key, value);
    }

    // Match each master row by its own step key, so a blank-`filename` row is
    // written only when its `video_file` is a rendered group.
    const plan = [];
    (rows || []).forEach((row, i) => {
        const value = groupSrt.get(groupKeyForRow(row));
        if (value === undefined || !value.trim()) return;
        plan.push({ row: i, sheetRow: sheetRows ? sheetRows[i] : i + 2, column: 'srt', value });
    });
    return plan;
}

/**
 * Core, dependency-free merge pass: apply the SRT plan to parsed master rows
 * and serialize with the original header line preserved. Pure apart from
 * returning the CSV text.
 *
 * @param {object} opts
 * @param {string} opts.videoDataText `video_data.csv` text (carrying `srt`)
 * @param {string} opts.masterText committed master CSV text
 * @param {Function} [opts.log]
 * @returns {{plan: Array, applied: number, csv: string|null}}
 */
export function runWriteSrtToCsv({ videoDataText, masterText, log = console.log } = {}) {
    const { headers, rows } = parseCsv(masterText ?? '');
    const plan = planSrtWrites({
        csvText: videoDataText,
        rows,
        sheetRows: rows.map((_, i) => i + 2),
    });
    if (plan.length === 0) {
        log('no srt cells to write');
        return { plan, applied: 0, csv: null };
    }
    for (const item of plan) {
        rows[item.row][item.column] = item.value;
        log(`WROTE ${item.column} (row ${item.sheetRow})`);
    }
    const csv = serializeWithHeaderLine(rawHeaderLine(masterText), headers, rows);
    log(`wrote ${plan.length} srt cell(s)`);
    return { plan, applied: plan.length, csv };
}

const HELP = `Write the pipeline-computed srt column from video_data.csv into the
committed master CSV (overwrites srt unconditionally; never clears a blank).

Usage:
  node scripts/write-srt-to-csv.mjs --csv=<path> [options]

Options:
  --csv=<path>      video_data.csv downloaded from R2 (required)
  --master=<path>   Master CSV file (default: every committed public/*.master.csv)
  --help, -h        Show this help`;

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }

    const csvPath = flagValue(args, '--csv');
    const masterFlag = flagValue(args, '--master');
    // With no --master, every committed master CSV is updated: the step keys
    // are course-prefixed, so one course's SRTs can never land in another's.
    const masterPaths = masterFlag
        ? [path.resolve(masterFlag)]
        : masterCsvPaths(ROOT);

    if (!csvPath) {
        console.error('ERROR: --csv=<path> is required.');
        process.exit(1);
    }
    if (!masterPaths.length) {
        console.error('ERROR: no master CSV files found');
        process.exit(1);
    }

    const videoDataText = await fs.readFile(csvPath, 'utf8');
    for (const masterPath of masterPaths) {
        const masterText = await fs.readFile(masterPath, 'utf8');
        const { csv } = await runWriteSrtToCsv({ videoDataText, masterText });
        if (csv === null) continue;

        // Same-directory temp file + rename (story-047 rule): a killed run never
        // leaves a half-written store.
        const tmpPath = `${masterPath}.tmp-${process.pid}`;
        try {
            await fs.writeFile(tmpPath, csv);
            await fs.rename(tmpPath, masterPath);
        } catch (err) {
            await fs.rm(tmpPath, { force: true });
            throw err;
        }
        console.log(`WROTE ${masterPath}`);
    }
}

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((e) => {
        console.error('ERROR:', e.message);
        process.exit(1);
    });
}
