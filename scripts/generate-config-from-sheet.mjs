#!/usr/bin/env node
// scripts/generate-config-from-sheet.mjs
// Fetch the published Google-Sheet CSV and write a NEW English-only
// `src/config/<courseId>.json` (stories/042-generate-config-from-sheet). The
// sheet is the source of truth for both videos and configs. This is an
// operator-invoked, manual tool (like posters / videos:optimize): it fetches
// the network and is not run in CI.
//
// It NEVER overwrites an existing config unless `--force` is passed.
//
// Usage:
//   node scripts/generate-config-from-sheet.mjs [--course=<courseId>] [--out=<path>] [--sheet-url=<url>] [--dry-run] [--force]
//
// The default sheet URL is the same published CSV the recorder reads
// (public/recorder.html); a source guard pins the two literals together.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagValue } from './lib/cli-utils.js';
import { parseCsv, buildCourseConfig, isValidCourseId } from './lib/sheet-config-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Default output directory for the generated config (test seam).
const CONFIG_DIR = process.env.CONFIG_OUT_DIR || path.join(ROOT, 'src', 'config');

// Keep in sync with public/recorder.html (source-guarded).
export const SHEET_URL =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vSDgWLQRezvKde57LsHzm6YPrwanYJgCBOXkz_1r6GxEilauIudDxsg5IUjiQ7F7CP4OwZQg82LSbfT/pub?gid=289451687&single=true&output=csv';

const HELP = `Generate an English-only src/config/<courseId>.json from the published sheet.

Usage:
  node scripts/generate-config-from-sheet.mjs [options]

Options:
  --course=<courseId>   Override the course_id from the sheet (sets the filename)
  --out=<path>          Output path (default src/config/<courseId>.json)
  --sheet-url=<url>     Override the published CSV URL (default: the recorder's)
  --dry-run             Print the plan; write nothing
  --force               Overwrite an existing config (otherwise refused)
  --help, -h            Show this help

Groups sheet rows by the video_file column value; English only. Existing
configs are never overwritten without --force.`;

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }

    // Flag validation first so a bad invocation fails with the flag error.
    const courseOverride = flagValue(args, '--course');
    const outOverride = flagValue(args, '--out');
    const sheetUrl = flagValue(args, '--sheet-url') || SHEET_URL;
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');

    const res = await fetch(sheetUrl);
    if (!res.ok) throw new Error(`sheet fetch failed HTTP ${res.status}`);
    const csv = await res.text();

    const { rows } = parseCsv(csv);
    const config = buildCourseConfig(rows);
    const courseId = courseOverride || config.courseId;
    if (!courseId) throw new Error('no course_id column value and no --course given');
    // A remote-controlled courseId becomes a filename, so reject anything that
    // could escape src/config (traversal, separators, leading dot).
    if (!isValidCourseId(courseId)) {
        throw new Error(`invalid courseId "${courseId}": expected [A-Za-z0-9][A-Za-z0-9_-]*`);
    }
    config.courseId = courseId;

    const outPath = outOverride
        ? path.resolve(outOverride)
        : path.join(CONFIG_DIR, `${courseId}.json`);

    const exists = await fs.access(outPath).then(() => true, () => false);
    if (exists && !force) {
        throw new Error(`${outPath} already exists; refusing to overwrite (use --force to replace)`);
    }

    const serialized = JSON.stringify(config, null, 2) + '\n';
    if (dryRun) {
        console.log(`[dry-run] would write ${outPath}`);
        console.log(`[dry-run] courseId=${config.courseId} lessons=${config.lessons.length}`);
        return;
    }

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, serialized);
    console.log(`WROTE ${outPath}`);

    // Register the course in the allow-list the English-only contract guard
    // reads, so a generated config is covered automatically. Only for the real
    // src/config output — a test/`--out` run must not touch the tracked file.
    if (!outOverride) await registerGeneratedCourse(courseId);
}

/** Append `courseId` to scripts/lib/generated-configs.json (idempotent). */
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

main().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
});
