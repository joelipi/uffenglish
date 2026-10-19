#!/usr/bin/env node
// scripts/generate-sheet-from-source.mjs
// Expand a friend-course source config (`wouldyourather.source.txt`) into the
// master-shape sheet CSV the EXISTING pipeline reads (recorder, Modal render,
// generate-config-from-sheet.mjs). The source file stays the authoring truth;
// this bridge lets everything downstream keep working unchanged until each
// consumer learns to read the source natively.
//
// Usage:
//   node scripts/generate-sheet-from-source.mjs [--source=<path>] [--out=<path>]
//
// Defaults: --source=<repo>/wouldyourather.source.txt, CSV to stdout (logs go
// to stderr, so `--out` or a redirect captures a clean CSV).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagValue } from './lib/cli-utils.js';
import { parseSourceConfig, sourceToRows, rowsToCsv } from './lib/source-bridge-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HELP = `Expand a friend-course source config into master-shape sheet CSV.

Usage:
  node scripts/generate-sheet-from-source.mjs [options]

Options:
  --source=<path>   Source .txt file (default: <repo>/wouldyourather.source.txt)
  --out=<path>      Write CSV here (default: stdout; logs go to stderr)
  --help, -h        Show this help

The CSV carries the live master header plus a1..c1, so the recorder, the Modal
render, the config generator, and the translator all accept it unchanged.`;

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }

    const sourcePath = flagValue(args, '--source')
        ? path.resolve(flagValue(args, '--source'))
        : path.join(ROOT, 'wouldyourather.source.txt');
    const outPath = flagValue(args, '--out') ? path.resolve(flagValue(args, '--out')) : null;

    const source = parseSourceConfig(await fs.readFile(sourcePath, 'utf8'));
    const rows = sourceToRows(source);
    const csv = rowsToCsv(rows);

    const takes = rows.filter((r) => String(r.filename || '').trim() !== '').length;
    const log = `BRIDGE ${sourcePath} -> ${outPath || 'stdout'} (${rows.length} rows, ${takes} takes)`;
    if (outPath) {
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, csv);
        console.error(log);
    } else {
        process.stdout.write(csv);
        console.error(log);
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
