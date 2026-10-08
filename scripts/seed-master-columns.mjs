#!/usr/bin/env node
// scripts/seed-master-columns.mjs
// Story 050, Task 4: fetch the published overlay-master CSV, append the config
// columns (course_id … srt), and pre-fill the current course from friendchain.json
// so it runs out of the box. The script WRITES NOTHING to the sheet — it emits a
// CSV the operator imports by hand (the sandbox has no Google credentials).
//
// Usage:
//   node scripts/seed-master-columns.mjs [--sheet-url=<url>] [--out=<path>] [--friendchain=<path>]
//
// The default sheet URL is the same published master CSV the generator reads
// (SHEET_URL in scripts/generate-config-from-sheet.mjs); the source guard pins
// it against public/recorder.html.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagValue } from './lib/cli-utils.js';
import { parseCsv } from './lib/sheet-config-utils.js';
import {
    SHEET_LANGUAGES,
    LOCALIZATION_FIELDS,
    localizedColumn,
} from './lib/sheet-translate-utils.js';
import { SHEET_URL } from './generate-config-from-sheet.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// The current course's pre-fill values (best judgment; the operator edits cells
// later — the story's Notes).
export const SEED_COURSE_ID = 'wouldyourather';
export const SEED_SUCCESS_VIDEO = 'success';

// The config columns appended to the master, in the order the operator sees them.
export const CONFIG_COLUMNS = [
    'course_id', 'course_name', 'lesson_id', 'lesson_title', 'response_type',
    'unit', 'mission', 'recap_sources', 'recap_overlay', 'intro_video',
    'success_video', 'success_srt', 'success_srt_es', 'success_srt_pt',
    'success_srt_bn', 'srt', 'next_step', 'choose_step_next', 'choose_step_text',
];

// The localization targets every shared translatable field needs, so the seeded
// master can be translated: without them the translator's `buildBatchUpdatePayload`
// throws `column "<field>_<lang>" not found in headers`.
export const LOCALIZATION_COLUMNS = LOCALIZATION_FIELDS.flatMap((f) =>
    SHEET_LANGUAGES.map((lang) => localizedColumn(f.field, lang)));

// Ask lessons a/c/e (single question videos) have no friend recap; answer
// lessons b/d/f (two option videos joined) do.
export const ASK_LESSONS = ['a', 'c', 'e'];

// Friend-chain intro pattern: lesson a uses the plain `intro`, b–f borrow the
// preceding friend response slug (see src/config/wouldrather.json).
export const INTRO_VIDEOS = {
    a: 'intro',
    b: '{friendCode}wouldyourather-a-response-01',
    c: '{friendCode}wouldyourather-b-response-04',
    d: '{friendCode}wouldyourather-c-response-04',
    e: '{friendCode}wouldyourather-d-response-04',
    f: '{friendCode}wouldyourather-e-response-04',
};

// No source exists in the master, so these are best-judgment titles.
export const LESSON_TITLES = {
    a: 'Ask: money vs. time, food vs. talk, beach vs. mountains',
    b: 'Answer: money vs. time, food vs. talk, beach vs. mountains',
    c: 'Ask: rich vs. free, cook vs. restaurant, alone vs. friends',
    d: 'Answer: rich vs. free, cook vs. restaurant, alone vs. friends',
    e: 'Ask: time vs. money, sweet vs. salty, home vs. out',
    f: 'Answer: time vs. money, sweet vs. salty, home vs. out',
};

export function lessonIdFromVideoFile(videoFile) {
    const match = /^[^_]*_([a-z])/i.exec(String(videoFile ?? '').trim());
    return match ? match[1].toLowerCase() : '';
}

export function courseNameFromTitle(title) {
    return String(title ?? '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function lessonTitleFor(lesson) {
    return LESSON_TITLES[lesson] || `Lesson ${String(lesson).toUpperCase()}`;
}

export function introVideoFor(lesson) {
    return INTRO_VIDEOS[lesson] ?? '';
}

/**
 * The canonical friend-lesson success subtitles (`{en,es,pt,bn}`) from
 * friendchain.json. Asserts every success step carries the same subtitles, so
 * copying the first one cannot silently pick a divergent lesson.
 */
export function successSubtitlesFromFriendchain(config) {
    let canonical;
    for (const lesson of config?.lessons || []) {
        for (const step of lesson?.steps || []) {
            if (step?.responseType !== 'success' || !step.subtitles) continue;
            if (canonical === undefined) { canonical = step.subtitles; continue; }
            if (JSON.stringify(canonical) !== JSON.stringify(step.subtitles)) {
                throw new Error('friendchain.json success subtitles are not identical across lessons');
            }
        }
    }
    if (canonical === undefined) throw new Error('friendchain.json has no success step with subtitles');
    return canonical;
}

function firstNonBlank(rows, name) {
    for (const row of rows) {
        const v = String(row?.[name] ?? '').trim();
        if (v) return v;
    }
    return '';
}

/** Quote a CSV field (RFC 4180) when it contains a comma, quote, or newline. */
function csvField(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

/** Serialize headers + header-keyed rows to RFC-4180 CSV text. */
export function serializeCsv(headers, rows) {
    const lines = [headers.map(csvField).join(',')];
    for (const row of rows) lines.push(headers.map((h) => csvField(row[h])).join(','));
    return `${lines.join('\n')}\n`;
}

/**
 * Append the config columns to `csvText` and pre-fill every content row. Pure:
 * no fetch/write. The success constants come from `friendchain`.
 *
 * @param {string} csvText the published master CSV
 * @param {object} opts
 * @param {object} opts.friendchain parsed friendchain.json
 * @returns {string} the seeded CSV
 */
export function buildSeededCsv(csvText, { friendchain } = {}) {
    const { headers, rows } = parseCsv(csvText);
    const success = successSubtitlesFromFriendchain(friendchain);
    const courseName = courseNameFromTitle(firstNonBlank(rows, 'title_text'));
    const appended = [...CONFIG_COLUMNS, ...LOCALIZATION_COLUMNS].filter((c) => !headers.includes(c));
    const outHeaders = [...headers, ...appended];

    const outRows = rows.map((row) => {
        const lesson = lessonIdFromVideoFile(row.video_file);
        const seedValues = {
            course_id: SEED_COURSE_ID,
            course_name: courseName,
            lesson_id: lesson,
            lesson_title: lesson ? lessonTitleFor(lesson) : '',
            response_type: 'friendClosedResponse',
            recap_sources: ASK_LESSONS.includes(lesson) ? 'none' : 'friend',
            recap_overlay: 'shareCta',
            intro_video: lesson ? introVideoFor(lesson) : '',
            success_video: SEED_SUCCESS_VIDEO,
            success_srt: success.en,
            success_srt_es: success.es,
            success_srt_pt: success.pt,
            success_srt_bn: success.bn,
        };
        const out = {};
        for (const header of outHeaders) {
            // `srt` is machine-derived (the pipeline writes it back); never
            // clobber an existing value with the seed.
            out[header] = header in seedValues ? seedValues[header] : (row[header] ?? '');
        }
        return out;
    });

    return serializeCsv(outHeaders, outRows);
}

const HELP = `Append the config columns to the published master CSV and pre-fill the
current course (writes nothing to the sheet). Emits CSV on stdout, or --out.

Usage:
  node scripts/seed-master-columns.mjs [options]

Options:
  --sheet-url=<url>     Override the published master CSV URL
  --out=<path>          Write the CSV to a file (default: stdout)
  --friendchain=<path>  friendchain.json (default: src/config/friendchain.json)
  --help, -h            Show this help`;

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }

    const sheetUrl = flagValue(args, '--sheet-url') || SHEET_URL;
    const outPath = flagValue(args, '--out');
    const friendchainPath = flagValue(args, '--friendchain')
        || path.join(ROOT, 'src', 'config', 'friendchain.json');

    const friendchain = JSON.parse(await readFile(friendchainPath, 'utf8'));
    const res = await fetch(sheetUrl);
    if (!res.ok) throw new Error(`sheet fetch failed HTTP ${res.status}`);
    const seeded = buildSeededCsv(await res.text(), { friendchain });

    if (outPath) {
        await writeFile(outPath, seeded);
        console.log(`WROTE ${outPath}`);
    } else {
        process.stdout.write(seeded);
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
