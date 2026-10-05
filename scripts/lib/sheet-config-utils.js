// scripts/lib/sheet-config-utils.js
// Pure transform: published Google-Sheet rows -> a `src/config/<courseId>.json`
// course config (stories/042-generate-config-from-sheet). Everything here is
// pure — no fs/fetch/process — so the whole transform is unit-testable with an
// in-memory CSV string. The CLI (scripts/generate-config-from-sheet.mjs) owns
// all I/O.
//
// The sheet is the source of truth for both videos and configs. Rows are
// per-sentence (keyed by `filename`) and roll up into one config step per
// `video_file` (the step's simpleVideoUrl). Grouping is by COLUMN VALUE, never
// by row position, so rows may be sorted freely.
//
// English is always emitted. When the sheet also carries the per-language
// columns (`lesson_title_es`, `mission_pt`, `cue_es`, `cue_alt_es`,
// `subtitle_text_bn`, … — the 15 columns the story-049 translate-sheet Action
// fills), they are consumed into the existing `{en,es,pt,bn}` objects. The
// language columns are optional: a sheet with none of them still generates
// English-only output.

import {
    SHEET_LANGUAGES,
    TRANSLATABLE_FIELDS,
    localizedColumn,
    groupCueAltLines,
} from './sheet-translate-utils.js';

// English source columns are looked up in the shared field map, so a field
// removed or renamed in sheet-translate-utils.js fails loudly here instead of
// being silently dropped from generated configs.
const FIELD_SOURCES = new Map(TRANSLATABLE_FIELDS.map((f) => [f.field, f.source]));

/** The English source column for a shared translatable field. */
function sourceOf(field) {
    const source = FIELD_SOURCES.get(field);
    if (!source) throw new Error(`sheet-config-utils: unknown translatable field "${field}"`);
    return source;
}

// Canonical vocabulary (mirrors the app; a guard pins these to the browser
// module).
export const RESPONSE_TYPES = [
    'friendClosedResponse',
    'viewAndContinue',
    'closedResponse',
    'success',
    'lessonIntro',
    'openResponse',
];
export const RECAP_SOURCES = ['system', 'friend', 'none'];
export const RECAP_OVERLAYS = ['fluency', 'shareCta', 'none'];

// Columns a generated config cannot do without. Anything else (recap_sources,
// recap_overlay, unit, mission, cue, cue_alt, subtitle_text, srt) is optional
// and never reported missing. Add a column here AND to the sheet header when a
// new required field is introduced.
export const REQUIRED_COLUMNS = [
    'course_id', 'course_name', 'lesson_id', 'lesson_title',
    'response_type', 'video_file', 'order',
];

// A courseId becomes a filename, so it must be a safe single path segment: no
// separators, no traversal, no leading dot/underscore. Matches the app's config
// filenames.
export const COURSE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isValidCourseId(value) {
    return typeof value === 'string' && COURSE_ID_PATTERN.test(value);
}

// Columns whose presence marks a row as video-related (everything else is a
// blank spacer row and is skipped).
const VIDEO_COLUMNS = ['video_file', 'filename', 'subtitle_text', 'srt'];

/**
 * Parse RFC-4180-style CSV into `{ headers, rows }`. Quoted fields may contain
 * commas, newlines, and `""` escapes; `\r` is tolerated; a trailing newline and
 * blank lines are ignored. Header keys are trimmed and lower-cased (matching
 * the recorder's own parser). A short row resolves every missing header to "".
 *
 * @param {string} text raw CSV
 * @returns {{ headers: string[], rows: Array<Record<string,string>> }}
 */
export function parseCsv(text) {
    const records = [];
    let field = '';
    let record = [];
    let inQuotes = false;
    let sawQuote = false;
    const source = String(text ?? '');

    const pushField = () => { record.push(field); field = ''; sawQuote = false; };
    const pushRecord = () => { pushField(); records.push(record); record = []; };

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (inQuotes) {
            if (ch === '"') {
                if (source[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += ch;
            }
            continue;
        }
        if (ch === '"') { inQuotes = true; sawQuote = true; continue; }
        if (ch === ',') { pushField(); continue; }
        if (ch === '\n' || ch === '\r') {
            // Swallow a CRLF pair as one terminator.
            if (ch === '\r' && source[i + 1] === '\n') i++;
            pushRecord();
            continue;
        }
        field += ch;
    }
    // A trailing field/record with no final newline.
    if (field !== '' || record.length > 0 || sawQuote) pushRecord();

    const nonBlank = records.filter((r) => r.some((c) => c.trim() !== ''));
    if (nonBlank.length === 0) return { headers: [], rows: [] };

    const headers = nonBlank[0].map((h) => h.trim().toLowerCase());
    const rows = [];
    for (const raw of nonBlank.slice(1)) {
        const row = {};
        for (let i = 0; i < headers.length; i++) {
            // A field may legitimately contain external whitespace; keep it,
            // but a missing field is "" not undefined.
            row[headers[i]] = raw[i] === undefined ? '' : raw[i];
        }
        rows.push(row);
    }
    return { headers, rows };
}

/**
 * Whether a row carries any video-related value. Blank spacer rows (and the
 * like) are skipped.
 */
export function isVideoRow(row) {
    return VIDEO_COLUMNS.some((col) => String(row?.[col] ?? '').trim() !== '');
}

/** Trim a cell to a string (missing -> ""). */
function cell(row, name) {
    const v = row?.[name];
    return v === undefined || v === null ? '' : String(v);
}

/**
 * Un-escape the JSON-string form the pipeline writes into the `srt` column
 * (`\n`->newline, `"`->quote, `\\`->backslash) back to literal SRT text. Only
 * JSON string escapes are decoded, so a literal backslash survives.
 */
export function unescapeSrt(value) {
    const s = String(value ?? '');
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 1 < s.length) {
            const next = s[i + 1];
            if (next === 'n') { out += '\n'; i++; continue; }
            if (next === 't') { out += '\t'; i++; continue; }
            if (next === 'r') { out += '\r'; i++; continue; }
            if (next === '"') { out += '"'; i++; continue; }
            if (next === '\\') { out += '\\'; i++; continue; }
        }
        out += s[i];
    }
    return out;
}

/**
 * First non-blank `<field>_<lang>` value across the group's rows ("" if none).
 * Language columns are not conflict-guarded: a translation may legitimately
 * appear on only one row of a lesson/step, and first-seen wins.
 */
function firstLocalized(groupRows, field, lang) {
    for (const row of groupRows) {
        const v = cell(row, localizedColumn(field, lang)).trim();
        if (v) return v;
    }
    return '';
}

/** English value plus each present language, e.g. `{ en, es, pt }` (blanks omitted). */
function localizedObject(rows, field, enValue) {
    sourceOf(field); // validate the field exists in the shared map
    const obj = { en: enValue };
    for (const lang of SHEET_LANGUAGES) {
        const v = firstLocalized(rows, field, lang);
        if (v) obj[lang] = v;
    }
    return obj;
}

/**
 * The subtitles for a group: `srt` (JSON-escaped) wins, else `subtitle_text`
 * verbatim; both blank -> undefined (the key is omitted). First non-empty
 * value across the group's rows wins.
 *
 * `srt` is NOT translated (the caption pipeline owns SRT timings), so the
 * `srt` branch stays `{en}`. The `subtitle_text` branch picks up the
 * `subtitle_text_<lang>` columns.
 */
function subtitlesFor(groupRows) {
    for (const row of groupRows) {
        const srt = cell(row, 'srt').trim();
        if (srt) return { en: unescapeSrt(srt) };
    }
    for (const row of groupRows) {
        const text = cell(row, sourceOf('subtitle_text'));
        if (text.trim()) return localizedObject(groupRows, 'subtitle_text', text);
    }
    return undefined;
}

/** Group's `cue`: `cue` (single) or `cue_alt` (newline-separated alternatives). */
function cueFor(groupRows, videoFile) {
    const cueField = sourceOf('cue');
    const cueAltField = sourceOf('cue_alt');
    const singles = [];
    const alts = [];
    for (const row of groupRows) {
        if (cell(row, cueField).trim()) singles.push(cell(row, cueField).trim());
        if (cell(row, cueAltField).trim()) alts.push(cell(row, cueAltField));
    }
    if (singles.length && alts.length) {
        throw new Error(`video_file "${videoFile}": cue and cue_alt are mutually exclusive`);
    }
    if (alts.length) {
        // English alternatives, one per non-blank line across the group's rows.
        const enLines = groupRows.flatMap((row) => groupCueAltLines(cell(row, cueAltField)));
        // Per-language lines, paired to the English lines by index. A shorter or
        // blank language simply omits that language for the extra elements.
        const langLines = {};
        for (const lang of SHEET_LANGUAGES) {
            langLines[lang] = groupRows.flatMap((row) => groupCueAltLines(cell(row, localizedColumn('cue_alt', lang))));
        }
        return enLines.map((en, i) => {
            const obj = { en };
            for (const lang of SHEET_LANGUAGES) {
                const t = langLines[lang][i];
                if (t) obj[lang] = t;
            }
            return obj;
        });
    }
    if (singles.length) {
        // A group is one step, so all its rows must agree on the single cue.
        const unique = [...new Set(singles)];
        if (unique.length > 1) {
            throw new Error(
                `video_file "${videoFile}": conflicting cue values ("${unique[0]}" vs "${unique[1]}")`
            );
        }
        // `cue_<lang>` is read only here (never for a `cue_alt` step), so a stray
        // language column on the wrong shape is ignored.
        return localizedObject(groupRows, 'cue', unique[0]);
    }
    return undefined;
}

/** First non-empty value of a single-valued column within a group, else "". */
function singleValue(groupRows, name, context) {
    let value = '';
    for (const row of groupRows) {
        const v = cell(row, name).trim();
        if (!v) continue;
        if (value && value !== v) {
            throw new Error(`${context}: conflicting "${name}" values ("${value}" vs "${v}")`);
        }
        value = v;
    }
    return value;
}

/**
 * Build the ordered step list for one lesson's groups. Steps are ordered by the
 * numeric `Order` column (ascending), ties by first-seen CSV order.
 * @returns {Array<object>} step objects
 */
export function buildSteps(lessonRows) {
    // Group rows by video_file value (order of first appearance preserved).
    const groups = new Map();
    for (const row of lessonRows) {
        const videoFile = cell(row, 'video_file').trim();
        if (!videoFile) throw new Error(`row "${cell(row, 'filename')}" is missing video_file`);
        if (!groups.has(videoFile)) groups.set(videoFile, []);
        groups.get(videoFile).push(row);
    }

    const steps = [];
    for (const [videoFile, groupRows] of groups) {
        const responseType = singleValue(groupRows, 'response_type', `video_file "${videoFile}"`);
        if (!responseType) {
            throw new Error(`video_file "${videoFile}": missing response_type`);
        }
        if (!RESPONSE_TYPES.includes(responseType)) {
            throw new Error(`video_file "${videoFile}": unknown response_type "${responseType}"`);
        }

        // Order is mandatory and numeric for every row in the group.
        let order = null;
        for (const row of groupRows) {
            const raw = cell(row, 'order').trim();
            if (!/^-?\d+$/.test(raw)) {
                throw new Error(
                    `video_file "${videoFile}" row "${cell(row, 'filename')}": missing/non-numeric Order`
                );
            }
            const n = Number(raw);
            if (order === null || n < order) order = n;
        }

        const step = {};
        if (responseType === 'lessonIntro') {
            step.cue = '';
            step.responseType = 'lessonIntro';
            step.introBackgroundVideoUrl = videoFile;
        } else {
            const cue = cueFor(groupRows, videoFile);
            if (cue !== undefined) step.cue = cue;
            step.responseType = responseType;
            step.simpleVideoUrl = videoFile;
        }
        const subtitles = subtitlesFor(groupRows);
        if (subtitles !== undefined) step.subtitles = subtitles;

        steps.push({ __order: order, __seq: steps.length, step });
    }

    steps.sort((a, b) => (a.__order - b.__order) || (a.__seq - b.__seq));
    return steps.map((s) => s.step);
}

/**
 * Assemble a full course config object from parsed CSV rows. Pure; throws with
 * a message naming the offending row/group/lesson on any structural error.
 *
 * @param {Array<Record<string,string>>} rows parsed rows (header-keyed)
 * @returns {object} the course config (`{en}` unless the language columns are present)
 */
export function buildCourseConfig(rows) {
    const videoRows = (rows || []).filter(isVideoRow);

    // Course-level scalars must agree across every non-skipped row ("first
    // non-empty wins, disagreement errors").
    const courseId = singleValue(videoRows, 'course_id', 'course');
    const courseName = singleValue(videoRows, 'course_name', 'course');
    if (!courseId) throw new Error('missing course_id column value');
    if (!courseName) throw new Error('missing course_name column value');

    // Partition by lesson_id (first-seen order), then per-lesson assemble.
    const lessonOrder = [];
    const lessonRows = new Map();
    for (const row of videoRows) {
        const lessonId = cell(row, 'lesson_id').trim();
        if (!lessonId) throw new Error(`row "${cell(row, 'filename')}" is missing lesson_id`);
        if (!lessonRows.has(lessonId)) { lessonRows.set(lessonId, []); lessonOrder.push(lessonId); }
        lessonRows.get(lessonId).push(row);
    }

    const lessons = lessonOrder.map((lessonId) => {
        const rowsForLesson = lessonRows.get(lessonId);
        const title = singleValue(rowsForLesson, sourceOf('lesson_title'), `lesson "${lessonId}"`);
        if (!title) throw new Error(`lesson "${lessonId}": missing lesson_title`);

        const recapSources = singleValue(rowsForLesson, 'recap_sources', `lesson "${lessonId}"`) || 'none';
        if (!RECAP_SOURCES.includes(recapSources)) {
            throw new Error(`lesson "${lessonId}": invalid recap_sources "${recapSources}"`);
        }
        const recapOverlay = singleValue(rowsForLesson, 'recap_overlay', `lesson "${lessonId}"`) || 'shareCta';
        if (!RECAP_OVERLAYS.includes(recapOverlay)) {
            throw new Error(`lesson "${lessonId}": invalid recap_overlay "${recapOverlay}"`);
        }

        const lesson = {
            lessonId, recapSources, recapOverlay,
            title: localizedObject(rowsForLesson, 'lesson_title', title),
        };

        const unit = singleValue(rowsForLesson, 'unit', `lesson "${lessonId}"`);
        if (unit) lesson.unit = unit;
        const mission = singleValue(rowsForLesson, sourceOf('mission'), `lesson "${lessonId}"`);
        if (mission) lesson.mission = localizedObject(rowsForLesson, 'mission', mission);

        lesson.steps = buildSteps(rowsForLesson);
        return lesson;
    });

    return { courseId, courseName, lessons };
}

/**
 * The required columns that are blank for one course's selected rows, as a
 * deduplicated, deterministically ordered list of `{ column, where }`. Pure and
 * non-throwing — it never builds a config, it only reports what a build would
 * need. `course_id`/`course_name` are course-wide; `lesson_id`/`lesson_title`
 * per lesson; `response_type`/`video_file`/`order` per row/group.
 *
 * @param {Array<Record<string,string>>} rows one course's video rows
 * @returns {Array<{column: string, where: string}>}
 */
export function findMissingColumns(rows) {
    const videoRows = (rows || []).filter(isVideoRow);
    const missing = [];
    const add = (column, where) => missing.push({ column, where });

    if (videoRows.length === 0) return [];

    // Existence (first non-blank) — deliberately NOT `singleValue`, which throws
    // on conflicts. This detector must never throw: a conflict is a structural
    // error that `buildCourseConfig` reports per-course, and the detector must
    // not abort the whole multi-course run.
    const firstNonBlank = (rs, name) => {
        for (const r of rs) if (cell(r, name).trim()) return cell(r, name).trim();
        return '';
    };

    // Course-wide: blank on EVERY row.
    if (!firstNonBlank(videoRows, 'course_id')) add('course_id', 'course');
    if (!firstNonBlank(videoRows, 'course_name')) add('course_name', 'course');

    // Per row: lesson_id and video_file must each be present.
    for (const row of videoRows) {
        if (!cell(row, 'lesson_id').trim()) add('lesson_id', `row "${cell(row, 'filename')}"`);
        if (!cell(row, 'video_file').trim()) add('video_file', `row "${cell(row, 'filename')}"`);
    }

    // Grouping mirrors buildSteps EXACTLY: lessons partition by lesson_id, then
    // video_file groups WITHIN each lesson (buildSteps only ever sees one
    // lesson's rows). Grouping video_file across the whole course would merge
    // same-named videos in different lessons and disagree with the builder.
    const lessonOrder = [];
    const lessonRows = new Map();
    for (const row of videoRows) {
        const lessonId = cell(row, 'lesson_id').trim();
        if (!lessonId) continue;
        if (!lessonRows.has(lessonId)) { lessonRows.set(lessonId, []); lessonOrder.push(lessonId); }
        lessonRows.get(lessonId).push(row);
    }

    for (const lessonId of lessonOrder) {
        const rowsForLesson = lessonRows.get(lessonId);
        // lesson_title: present on at least one row of the lesson.
        if (!firstNonBlank(rowsForLesson, 'lesson_title')) add('lesson_title', `lesson "${lessonId}"`);

        const groupOrder = [];
        const groups = new Map();
        for (const row of rowsForLesson) {
            const videoFile = cell(row, 'video_file').trim();
            if (!videoFile) continue;
            if (!groups.has(videoFile)) { groups.set(videoFile, []); groupOrder.push(videoFile); }
            groups.get(videoFile).push(row);
        }
        for (const videoFile of groupOrder) {
            const groupRows = groups.get(videoFile);
            if (!firstNonBlank(groupRows, 'response_type')) {
                add('response_type', `video_file "${videoFile}"`);
            }
            for (const row of groupRows) {
                if (!/^-?\d+$/.test(cell(row, 'order').trim())) {
                    add('order', `video_file "${videoFile}" row "${cell(row, 'filename')}"`);
                }
            }
        }
    }

    // Deterministic: REQUIRED_COLUMNS order, then `where`; deduplicated.
    const rank = new Map(REQUIRED_COLUMNS.map((c, i) => [c, i]));
    const seen = new Set();
    return missing
        .filter((m) => {
            const key = `${m.column}\u0000${m.where}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => (rank.get(a.column) - rank.get(b.column)) || (a.where < b.where ? -1 : a.where > b.where ? 1 : 0));
}

/**
 * Assemble every course the sheet defines. Partitions the video rows by the
 * `course_id` column value (first-seen order), then builds each independently:
 * a course with any missing required column is skipped whole (all-or-nothing),
 * and a structural error in one course never blocks another.
 *
 * @param {Array<Record<string,string>>} rows parsed rows
 * @returns {Array<{courseId: string, config?: object, error?: {kind: 'missing-columns', missing: Array<{column,where}>} | {kind: 'error', message: string}}>}
 */
export function buildCourseConfigs(rows) {
    const videoRows = (rows || []).filter(isVideoRow);

    const order = [];
    const partitions = new Map();
    for (const row of videoRows) {
        const courseId = cell(row, 'course_id').trim();
        if (!partitions.has(courseId)) { partitions.set(courseId, []); order.push(courseId); }
        partitions.get(courseId).push(row);
    }

    return order.map((courseId) => {
        const partitionRows = partitions.get(courseId);
        const missing = findMissingColumns(partitionRows);
        if (missing.length > 0) {
            return { courseId, error: { kind: 'missing-columns', missing } };
        }
        try {
            return { courseId, config: buildCourseConfig(partitionRows) };
        } catch (e) {
            return { courseId, error: { kind: 'error', message: e.message } };
        }
    });
}
