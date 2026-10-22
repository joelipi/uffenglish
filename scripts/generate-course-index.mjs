#!/usr/bin/env node
// scripts/generate-course-index.mjs
// Write the list of authoring courses the recorder's course picker shows.
//
// The list comes from the repo's `*.source.txt` files — the authoring surface
// — so adding a course is one file, and the index follows. The recorder reads
// `public/courses.json` (same-origin) to fill its dropdown; it never guesses a
// course name.
//
// Usage:
//   node scripts/generate-course-index.mjs [--out=<path>] [--dry-run]
//
// Writes public/courses.json by default:
//   { "courses": ["<courseId>", ...] }
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagValue } from './lib/cli-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const COURSE_INDEX_REL = 'public/courses.json';

const HELP = `Write the course index the recorder's course picker reads.

Usage:
  node scripts/generate-course-index.mjs [options]

Options:
  --out=<path>      Output file (default: <repo>/${COURSE_INDEX_REL})
  --dry-run         Print the plan; write nothing
  --help, -h        Show this help`;

/** The course ids the repo can author, in a stable order. */
export async function courseIds(root = ROOT) {
    const entries = await fs.readdir(root);
    return entries
        .filter((f) => f.endsWith('.source.txt'))
        .map((f) => f.replace(/\.source\.txt$/, ''))
        .filter(Boolean)
        .sort();
}

export async function runGenerateCourseIndex({ root = ROOT, outPath, log = console.log } = {}) {
    const courses = await courseIds(root);
    const target = outPath || path.join(root, COURSE_INDEX_REL);
    const json = JSON.stringify({ courses }, null, 2) + '\n';
    log(`COURSES ${courses.length}: ${courses.join(', ') || '(none)'}`);
    log(`WROTE ${target}`);
    return { courses, target, json };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
    const outFlag = flagValue(args, '--out');
    const dryRun = args.includes('--dry-run');
    const { target, json } = await runGenerateCourseIndex({
        root: path.join(ROOT, 'sources'),
        outPath: outFlag ? path.resolve(outFlag) : path.join(ROOT, COURSE_INDEX_REL),
    });
    if (dryRun) return;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, json);
}

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
