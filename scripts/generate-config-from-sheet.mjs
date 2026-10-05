#!/usr/bin/env node
// scripts/generate-config-from-sheet.mjs
// Fetch the published Google-Sheet CSV and write one NEW English-only
// `src/config/<courseId>.json` per course the sheet defines
// (stories/042-generate-config-from-sheet, multi-course story 046). The sheet is
// the source of truth for both videos and configs. This is an operator-invoked
// tool (also run by .github/workflows/configs.yml).
//
// Best-effort: a course whose required columns are incomplete is SKIPPED WHOLE
// (no partial config) with a report of exactly which columns are missing; other
// courses are unaffected. The sheet is authoritative: the generator OVERWRITES
// src/config/<courseId>.json (stories/047-overwrite-configs).
//
// Usage:
//   node scripts/generate-config-from-sheet.mjs [--course=<id>] [--out=<dir>] [--sheet-url=<url>] [--dry-run] [--check]
//
// The default sheet URL is the same published CSV the recorder reads
// (public/recorder.html); a source guard pins the two literals together.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagValue } from './lib/cli-utils.js';
import { parseCsv, buildCourseConfigs, isValidCourseId } from './lib/sheet-config-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Default output directory for generated configs (test seam).
const CONFIG_DIR = process.env.CONFIG_OUT_DIR || path.join(ROOT, 'src', 'config');

// Keep in sync with public/recorder.html (source-guarded).
export const SHEET_URL =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZ7jFMJNnmylDoHxaqb1W8VyXi0OV4pSubCbqMGYkRgGimqWx3cs74n43-cFxqfue4KCiqWlhzvPkK/pub?gid=242913338&single=true&output=csv';

const HELP = `Generate an English-only src/config/<courseId>.json per sheet course.

Usage:
  node scripts/generate-config-from-sheet.mjs [options]

Options:
  --course=<courseId>   Only this course (from the sheet's course_id column)
  --out=<dir>           Output DIRECTORY (default src/config)
  --sheet-url=<url>     Override the published CSV URL (default: the recorder's)
  --dry-run             Print the plan; write nothing
  --check               CI mode: skips are non-fatal (exit 0); still writes the rest
  --help, -h            Show this help

The sheet is the source of truth: an existing src/config/<courseId>.json is
OVERWRITTEN. A course with any missing required column is skipped whole (no
partial config), reported on stderr, and does not block the other courses.`;

function missingReport(missing) {
    return missing.map((m) => `${m.column} (${m.where})`).join(', ');
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }

    // Flag validation first so a bad invocation fails with the flag error.
    const courseFilter = flagValue(args, '--course');
    const outOverride = flagValue(args, '--out');
    const sheetUrl = flagValue(args, '--sheet-url') || SHEET_URL;
    const dryRun = args.includes('--dry-run');
    const check = args.includes('--check');

    const outDir = outOverride ? path.resolve(outOverride) : CONFIG_DIR;

    const res = await fetch(sheetUrl);
    if (!res.ok) throw new Error(`sheet fetch failed HTTP ${res.status}`);
    const csv = await res.text();

    const { rows } = parseCsv(csv);
    let results = buildCourseConfigs(rows);
    if (results.length === 0) throw new Error('no video rows found in the sheet');

    if (courseFilter) {
        const match = results.find((r) => r.courseId === courseFilter);
        if (!match) throw new Error(`no course "${courseFilter}" in the sheet`);
        results = [match];
    }

    let wrote = 0;
    let skipped = 0;

    for (const result of results) {
        const { courseId } = result;

        if (result.error) {
            skipped++;
            if (result.error.kind === 'missing-columns') {
                console.error(`SKIP course "${courseId}": missing required column(s): ${missingReport(result.error.missing)}`);
            } else {
                console.error(`SKIP course "${courseId}": ${result.error.message}`);
            }
            continue;
        }

        // A remote-controlled courseId becomes a filename.
        if (!isValidCourseId(courseId)) {
            skipped++;
            console.error(`SKIP course "${courseId}": invalid courseId: expected [A-Za-z0-9][A-Za-z0-9_-]*`);
            continue;
        }

        const outPath = path.join(outDir, `${courseId}.json`);

        if (dryRun) {
            console.log(`[dry-run] would write ${outPath} (courseId=${courseId} lessons=${result.config.lessons.length})`);
            continue;
        }

        // The sheet is authoritative: overwrite unconditionally. Write to a
        // same-directory temp file then rename (atomic on POSIX), so a reader or
        // a killed process never sees a partial config; remove the temp on
        // failure so a stray *.tmp file is never staged by `git add src/config`.
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        const tmpPath = `${outPath}.tmp-${process.pid}`;
        try {
            await fs.writeFile(tmpPath, JSON.stringify(result.config, null, 2) + '\n');
            await fs.rename(tmpPath, outPath);
        } catch (err) {
            await fs.rm(tmpPath, { force: true });
            throw err;
        }
        console.log(`WROTE ${outPath}`);
        wrote++;

        // Register in the allow-list the contract guard reads, only for the real
        // src/config output — a --out/test run must not touch the tracked file.
        if (!outOverride) await registerGeneratedCourse(courseId);
    }

    if (dryRun) return;

    if (check) {
        console.log(`SKIPPED ${skipped} course(s), WROTE ${wrote}`);
    } else if (skipped > 0) {
        console.error(`ERROR: ${skipped} course(s) skipped`);
        process.exit(1);
    }
}

/** Append `courseId` to the generated-configs allow-list (idempotent). */
async function registerGeneratedCourse(courseId) {
    const listPath = process.env.GENERATED_CONFIGS_ALLOWLIST
        || path.join(ROOT, 'scripts', 'lib', 'generated-configs.json');
    let list = [];
    try {
        list = JSON.parse(await fs.readFile(listPath, 'utf8'));
        if (!Array.isArray(list)) list = [];
    } catch { /* missing/corrupt -> start fresh */ }
    if (!list.includes(courseId)) {
        list.push(courseId);
        list.sort();
        await fs.writeFile(listPath, JSON.stringify(list, null, 2) + '\n');
        console.log(`REGISTERED ${courseId} in generated-configs.json`);
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
