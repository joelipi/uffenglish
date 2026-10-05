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
// English-only for now. es/pt/bn localization is a later pass (the DeepSeek
// translateReal path in scripts/generate-captions.mjs).

// Canonical vocabulary (mirrors the app; a guard pins these to the browser
// module, which imports runtime deps and so is not importable from Node).
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
 * The subtitles for a group: `srt` (JSON-escaped) wins, else `subtitle_text`
 * verbatim; both blank -> undefined (the key is omitted). First non-empty
 * value across the group's rows wins.
 */
function subtitlesFor(groupRows) {
    for (const row of groupRows) {
        const srt = cell(row, 'srt').trim();
        if (srt) return { en: unescapeSrt(srt) };
    }
    for (const row of groupRows) {
        const text = cell(row, 'subtitle_text');
        if (text.trim()) return { en: text };
    }
    return undefined;
}

/** Group's `cue`: `cue` (single) or `cue_alt` (newline-separated alternatives). */
function cueFor(groupRows, videoFile) {
    const singles = [];
    const alts = [];
    for (const row of groupRows) {
        if (cell(row, 'cue').trim()) singles.push(cell(row, 'cue').trim());
        if (cell(row, 'cue_alt').trim()) alts.push(cell(row, 'cue_alt'));
    }
    if (singles.length && alts.length) {
        throw new Error(`video_file "${videoFile}": cue and cue_alt are mutually exclusive`);
    }
    if (alts.length) {
        const lines = alts
            .flatMap((v) => String(v).split('\n'))
            .map((l) => l.trim())
            .filter(Boolean);
        return lines.map((en) => ({ en }));
    }
    if (singles.length) return { en: singles[0] };
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
 * @returns {object} the course config (English-only)
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
        const title = singleValue(rowsForLesson, 'lesson_title', `lesson "${lessonId}"`);
        if (!title) throw new Error(`lesson "${lessonId}": missing lesson_title`);

        const recapSources = singleValue(rowsForLesson, 'recap_sources', `lesson "${lessonId}"`) || 'none';
        if (!RECAP_SOURCES.includes(recapSources)) {
            throw new Error(`lesson "${lessonId}": invalid recap_sources "${recapSources}"`);
        }
        const recapOverlay = singleValue(rowsForLesson, 'recap_overlay', `lesson "${lessonId}"`) || 'shareCta';
        if (!RECAP_OVERLAYS.includes(recapOverlay)) {
            throw new Error(`lesson "${lessonId}": invalid recap_overlay "${recapOverlay}"`);
        }

        const lesson = { lessonId, recapSources, recapOverlay, title: { en: title } };

        const unit = singleValue(rowsForLesson, 'unit', `lesson "${lessonId}"`);
        if (unit) lesson.unit = unit;
        const mission = singleValue(rowsForLesson, 'mission', `lesson "${lessonId}"`);
        if (mission) lesson.mission = { en: mission };

        lesson.steps = buildSteps(rowsForLesson);
        return lesson;
    });

    return { courseId, courseName, lessons };
}
