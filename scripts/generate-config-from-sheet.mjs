#!/usr/bin/env node
// scripts/generate-config-from-sheet.mjs
// Read the committed master CSV (`public/wouldyourather.master.csv`) and write
// one `src/config/<courseId>.json` per course it defines
// (stories/042-generate-config-from-sheet, multi-course story 046). The
// committed CSV is the source of truth for both videos and configs (story
// 065): the recorder fetches it same-origin, the Modal render fetches it over
// HTTP, and this generator reads it from disk. This is an operator-invoked
// tool (also run by .github/workflows/configs.yml).
//
// Best-effort: a course whose required columns are incomplete is SKIPPED WHOLE
// (no partial config) with a report of exactly which columns are missing; other
// courses are unaffected. The CSV is authoritative: the generator OVERWRITES
// src/config/<courseId>.json (stories/047-overwrite-configs).
//
// Usage:
//   node scripts/generate-config-from-sheet.mjs [--course=<id>] [--out=<dir>] [--csv=<path>] [--dry-run] [--check]

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagValue } from './lib/cli-utils.js';
import { parseCsv, buildCourseConfigs, isValidCourseId, partitionRowsByCourse, incompleteVideoSteps } from './lib/sheet-config-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Default output directory for generated configs (test seam).
const CONFIG_DIR = process.env.CONFIG_OUT_DIR || path.join(ROOT, 'src', 'config');

// The committed store every consumer reads. The literal path is pinned by the
// pipeline parity test — keep it byte-identical across the three readers
// (recorder, generator, Modal render).
export const MASTER_CSV_REL = 'public/wouldyourather.master.csv';

const HELP = `Generate a src/config/<courseId>.json per master-CSV course.

Usage:
  node scripts/generate-config-from-sheet.mjs [options]

Options:
  --course=<courseId>   Only this course (from the CSV's course_id column)
  --out=<dir>           Output DIRECTORY (default src/config)
  --csv=<path>          Master CSV file (default: all public/*.master.csv)
  --require-videos      Skip a course whole until every one of its steps
                        carries an srt (i.e. every step rendered+published);
                        friend clips, authoring-shape courses, and intro_video
                        slugs (which reuse an already-gated step video) never
                        block
  --dry-run             Print the plan; write nothing
  --check               CI mode: skips are non-fatal (exit 0); still writes the rest
  --help, -h            Show this help

The committed CSV is the source of truth: an existing src/config/<courseId>.json is
OVERWRITTEN. A course with any missing required column is skipped whole (no
partial config), reported on stderr, and does not block the other courses.`;

function missingReport(missing) {
    return missing.map((m) => `${m.column} (${m.where})`).join(', ');
}

function pendingReport(pending) {
    // One entry per step; a reused video lists every lesson waiting on it
    // (e.g. an answer lesson replaying an ask step still pending render).
    const order = [];
    const byKey = new Map();
    for (const p of pending) {
        if (!byKey.has(p.key)) { byKey.set(p.key, []); order.push(p.key); }
        if (!byKey.get(p.key).includes(p.lesson)) byKey.get(p.key).push(p.lesson);
    }
    return order.map((k) => `step "${k}" (lessons ${byKey.get(k).map((l) => `"${l}"`).join(', ')})`).join(', ');
}

/**
 * Build and write configs from parsed rows. Extracted so tests can drive it
 * with in-memory rows and compare the written files. `register` appends
 * courseIds to the allow-list (only for the real src/config output).
 *
 * @returns {Promise<{wrote: number, skipped: number}>}
 */
export async function generateConfigsFromRows({
    rows, courseFilter, outDir, dryRun = false, check = false, register = false,
    requireVideos = false, log = console.log, errorLog = console.error,
} = {}) {
    let results = buildCourseConfigs(rows);
    if (results.length === 0) throw new Error('no video rows found in the CSV');

    if (courseFilter) {
        const match = results.find((r) => r.courseId === courseFilter);
        if (!match) throw new Error(`no course "${courseFilter}" in the CSV`);
        results = [match];
    }

    let wrote = 0;
    let skipped = 0;
    // Recomputed here (buildCourseConfigs partitions internally too): the
    // builder stays pure and untouched, and the lookup below stays consistent
    // under --course filtering because the map covers the full row set.
    const partitionsByCourse = new Map(partitionRowsByCourse(rows).map((p) => [p.courseId, p.rows]));

    for (const result of results) {
        const { courseId } = result;

        if (result.error) {
            skipped++;
            if (result.error.kind === 'missing-columns') {
                errorLog(`SKIP course "${courseId}": missing required column(s): ${missingReport(result.error.missing)}`);
            } else {
                errorLog(`SKIP course "${courseId}": ${result.error.message}`);
            }
            continue;
        }

        // A remote-controlled courseId becomes a filename.
        if (!isValidCourseId(courseId)) {
            skipped++;
            errorLog(`SKIP course "${courseId}": invalid courseId: expected [A-Za-z0-9][A-Za-z0-9_-]*`);
            continue;
        }

        // With --require-videos a course waits until every step rendered: a
        // step without an `srt` has no published video yet, so no config is
        // created or pushed for it. Friend clips and authoring-shape courses
        // never block (their subtitles need no render), and neither do
        // `intro_video` slugs (the lessonIntro step reuses an already-gated
        // step video).
        if (requireVideos) {
            const partition = partitionsByCourse.get(courseId) ?? [];
            const pending = incompleteVideoSteps(partition);
            if (pending.length > 0) {
                skipped++;
                errorLog(`SKIP course "${courseId}": videos pending for ${new Set(pending.map((p) => p.key)).size} step(s): ${pendingReport(pending)}`);
                continue;
            }
        }

        const outPath = path.join(outDir, `${courseId}.json`);

        if (dryRun) {
            log(`[dry-run] would write ${outPath} (courseId=${courseId} lessons=${result.config.lessons.length})`);
            continue;
        }

        // The committed CSV is authoritative: overwrite unconditionally. Write to a
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
        log(`WROTE ${outPath}`);
        wrote++;

        // Register in the allow-list the contract guard reads, only for the real
        // src/config output — a --out/test run must not touch the tracked file.
        if (register) await registerGeneratedCourse(courseId);
    }

    if (check && !dryRun) log(`SKIPPED ${skipped} course(s), WROTE ${wrote}`);
    return { wrote, skipped };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }

    // Flag validation first so a bad invocation fails with the flag error.
    const courseFilter = flagValue(args, '--course');
    const outOverride = flagValue(args, '--out');
    const csvFlag = flagValue(args, '--csv');
    const dryRun = args.includes('--dry-run');
    const check = args.includes('--check');
    const requireVideos = args.includes('--require-videos');

    const outDir = outOverride ? path.resolve(outOverride) : CONFIG_DIR;

    let csvPaths = [];
    if (csvFlag) {
        csvPaths = [path.resolve(csvFlag)];
    } else {
        const pubDir = path.join(ROOT, 'public');
        const files = await fs.readdir(pubDir);
        csvPaths = files.filter((f) => f.endsWith('.master.csv')).map((f) => path.join(pubDir, f)).sort();
    }
    if (csvPaths.length === 0) {
        console.error('ERROR: no master CSV files found');
        process.exit(1);
    }

    let rows = [];
    for (const cp of csvPaths) {
        try {
            const { rows: r } = parseCsv(await fs.readFile(cp, 'utf8'));
            rows = rows.concat(r);
        } catch (err) {
            console.error(`ERROR: cannot read master CSV ${cp}: ${err.message}`);
            process.exit(1);
        }
    }

    const { skipped } = await generateConfigsFromRows({
        rows, courseFilter, outDir, dryRun, check, requireVideos, register: !outOverride,
    });

    if (!dryRun && !check && skipped > 0) {
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
