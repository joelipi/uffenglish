#!/usr/bin/env node
// scripts/generate-master-csv.mjs
// Regenerate the committed master CSV (`public/wouldyourather.master.csv`)
// from the source config (`wouldyourather.source.txt`). Run by
// .github/workflows/source-to-csv.yml on every push that touches the source,
// so editing the source on the GitHub web UI is the whole authoring action.
//
// The committed CSV is the only store every consumer reads: the recorder
// fetches it same-origin, the generator reads it from disk, the Modal render
// fetches it over HTTP. Translations survive regeneration via
// `carryOverTranslations` (a `*_<lang>` cell is kept iff its English source is
// byte-identical, else blanked for the translator to refill).
//
// Validation (JSON + structure) runs BEFORE any write, so a bad edit fails red
// with the reason and leaves the committed file untouched.
//
// Usage:
//   node scripts/generate-master-csv.mjs [--source=<path>] [--out=<path>] [--dry-run]

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagValue } from './lib/cli-utils.js';
import {
    MASTER_HEADER,
    parseSourceConfig,
    sourceToRows,
    rowsToCsv,
    carryOverTranslations,
} from './lib/source-bridge-utils.js';
import { parseCsv } from './lib/sheet-config-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// The committed store every consumer reads. The literal path is pinned by the
// pipeline parity test — keep it byte-identical across the three readers
// (recorder, generator, Modal render).
export const MASTER_CSV_REL = 'public/wouldyourather.master.csv';

const HELP = `Regenerate the committed master CSV from the source config.

Usage:
  node scripts/generate-master-csv.mjs [options]

Options:
  --source=<path>   Source .txt file (default: <repo>/wouldyourather.source.txt)
  --out=<path>      Output CSV file (default: <repo>/${MASTER_CSV_REL})
  --dry-run         Validate and print the plan; write nothing
  --help, -h        Show this help

Translations carry over iff their English source cell is byte-identical;
reworded sources come back blank for the translator to refill.`;

/**
 * Pure regeneration: parse + expand the source, carry translations forward
 * from the previously committed text, serialize. Throws (before any write)
 * on invalid source or structural errors.
 *
 * @param {object} opts
 * @param {string} opts.sourceText raw source file text
 * @param {string|null} [opts.prevText] previously committed CSV text (null on first run)
 * @param {Function} [opts.log]
 * @returns {{csv: string, rows: number, takes: number, carried: number}}
 */
export function runGenerateMasterCsv({ sourceText, prevText = null, log = console.log } = {}) {
    const source = parseSourceConfig(sourceText);
    const fresh = sourceToRows(source);
    let rows = fresh;
    let carried = 0;
    if (prevText !== null && prevText !== undefined) {
        const { rows: prevRows } = parseCsv(prevText);
        ({ rows, carried } = carryOverTranslations(prevRows, fresh));
    }
    const csv = rowsToCsv(rows);
    // The emitted header is the contract header (parse lower-cases keys, so
    // compare case-insensitively — casing included).
    const { headers } = parseCsv(csv);
    const want = MASTER_HEADER.map((h) => h.toLowerCase()).join(',');
    if (headers.join(',') !== want) {
        throw new Error('regenerated CSV header drifted from MASTER_HEADER');
    }
    const takes = rows.filter((r) => String(r.filename || '').trim() !== '').length;
    log(`MASTER ${rows.length} rows (${takes} takes, ${carried} carried translations)`);
    return { csv, rows: rows.length, takes, carried };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }

    const sourceFlag = flagValue(args, '--source');
    const sourcePath = sourceFlag ? path.resolve(sourceFlag) : path.join(ROOT, 'wouldyourather.source.txt');
    const outFlag = flagValue(args, '--out');
    const outPath = outFlag ? path.resolve(outFlag) : path.join(ROOT, MASTER_CSV_REL);
    const dryRun = args.includes('--dry-run');

    const sourceText = await fs.readFile(sourcePath, 'utf8');
    let prevText = null;
    try {
        prevText = await fs.readFile(outPath, 'utf8');
    } catch { /* first run: no carry-over */ }

    const { csv, rows, takes, carried } = runGenerateMasterCsv({ sourceText, prevText });

    if (dryRun) {
        console.log(`[dry-run] would write ${outPath} (${rows} rows, ${takes} takes, ${carried} carried)`);
        return;
    }

    // Atomic write (story 047 rule): same-directory temp file + rename, so a
    // killed run never leaves a half-written store.
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const tmpPath = `${outPath}.tmp-${process.pid}`;
    try {
        await fs.writeFile(tmpPath, csv);
        await fs.rename(tmpPath, outPath);
    } catch (err) {
        await fs.rm(tmpPath, { force: true });
        throw err;
    }
    console.log(`WROTE ${outPath} (${rows} rows, ${takes} takes, ${carried} carried)`);
}

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((e) => {
        console.error('ERROR:', e.message);
        process.exit(1);
    });
}
