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
// English is always emitted. When the CSV also carries the per-language
// columns (`lesson_title_es`, `mission_pt`, `cue_es`, `cue_alt_es`,
// `choose_step_text_es`, `subtitle_text_bn`, `srt_es`, … — the columns the
// translate-master-csv Action fills), they are consumed into the existing
// `{en,es,pt,bn}` objects. The language columns are optional: a sheet with none
// of them still generates English-only output. Subtitles come from `srt`
// (localized by `srt_<lang>`, timings preserved) or, when `srt` is blank,
// `subtitle_text` (localized by `subtitle_text_<lang>`).

import {
    SHEET_LANGUAGES,
    TRANSLATABLE_FIELDS,
    localizedColumn,
    groupCueAltLines,
    unescapeSrt,
    validateSrtCell,
} from './sheet-translate-utils.js';
// A friend/UGC clip has its speaker's caption burned into the video, so it must
// get no app `subtitles` — the player would draw a second caption over it. In
// the sheet a friend clip is the step whose key is a `{friendCode}` reference,
// so it is identified by that placeholder (the runtime UGC classifier in
// video-source.js matches share codes, which a sheet-level ref does not have).
function isFriendVideoSlug(key) {
    return String(key ?? '').includes('{friendCode}');
}

// A friend clip's sheet key is `{friendCode}<course>-<lesson>-response-NN`; the
// app's UGC key is `{recorder}-{inviter}-<course>-<lesson>-<step>` (see
// buildUgcSegmentKey). The emitted slug therefore carries BOTH code placeholders
// — `{friendCode}` (the friend who recorded it) then `{selfCode}` (the viewer who
// invited them), resolved at load time by config-normalizer.js. Exported for the
// normalizer/builder contract test.
export function appSlug(key) {
    const s = String(key ?? '');
    if (!s.startsWith('{friendCode}')) return s;
    let rest = s.slice('{friendCode}'.length);
    // Legacy `-response-NN` suffix becomes the bare step number…
    const match = /^(.*)-response-(\d+)$/.exec(rest);
    if (match) rest = `${match[1]}-${match[2]}`;
    // …and a ref authored without the viewer slot gains it, so the emitted slug
    // always carries both codes and can match a two-code key.
    if (!rest.startsWith('{selfCode}')) rest = `{selfCode}-${rest}`;
    return `{friendCode}${rest}`;
}


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
    'branching',
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
 * Quote one CSV field (RFC-4180): fields containing a comma, quote, or newline
 * are wrapped in quotes with `"` escaped as `""`. Shared by the bridge and the
 * file-commit writers so every CSV the repo owns is serialized one way.
 */
export function csvField(value) {
    const s = String(value ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize header-keyed rows to RFC-4180 CSV text in `headers` order. A row
 * missing a header resolves it to "". The inverse of `parseCsv` for dense rows
 * (both sides agree on lower-cased header keys).
 */
export function serializeCsv(headers, rows) {
    const cols = [...(headers || [])];
    const lines = [cols.map(csvField).join(',')];
    for (const row of rows || []) {
        lines.push(cols.map((h) => csvField(row?.[h])).join(','));
    }
    return `${lines.join('\n')}\n`;
}

/**
 * The exact first physical line of CSV text, without splitting a quoted
 * header cell on an embedded newline. Pure.
 */
export function rawHeaderLine(text) {
    const source = String(text ?? '');
    let inQuotes = false;
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (ch === '"') {
            if (source[i + 1] === '"') i++;
            else inQuotes = !inQuotes;
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            return source.slice(0, i);
        }
    }
    return source;
}

/**
 * Serialize rows under an existing header line, preserving its exact bytes.
 * `parseCsv` normalizes header keys (trim + lower-case), but the committed
 * file's casing is load-bearing — the pipeline reads `bgSound` case-
 * sensitively — so a file-commit writer must never rewrite the header row.
 * Body cells are RFC-4180-quoted in `headers` (normalized) order. Pure.
 */
export function serializeWithHeaderLine(headerLine, headers, rows) {
    const body = serializeCsv(headers, rows).split('\n').slice(1).join('\n');
    return `${headerLine}\n${body}`;
}

/**
 * Whether a row carries any video-related value. Blank spacer rows (and the
 * like) are skipped.
 */
export function isVideoRow(row) {
    return VIDEO_COLUMNS.some((col) => String(row?.[col] ?? '').trim() !== '');
}

/**
 * Whether a sheet header is the overlay-master shape. The master carries a
 * `phrase` column (one phrase per take); the authoring sheet carries `cue` /
 * `cue_alt` instead. Header names are normalized, so `Phrase` also matches.
 */
export function isMasterFormat(headers) {
    return (headers || []).some((h) => String(h).trim().toLowerCase() === 'phrase');
}

/** Every header key present across the rows (parseCsv gives each row all keys). */
function headerKeys(rows) {
    const keys = new Set();
    for (const row of rows || []) for (const key of Object.keys(row || {})) keys.add(key);
    return [...keys];
}

/** Trim a cell to a string (missing -> ""). */
function cell(row, name) {
    const v = row?.[name];
    return v === undefined || v === null ? '' : String(v);
}

/** First non-blank value of a column across `rows`, else "" (never throws). */
function firstNonBlank(rows, name) {
    for (const row of rows || []) {
        const v = cell(row, name).trim();
        if (v) return v;
    }
    return '';
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
function localizedObject(rows, field, enValue, { validateField = true } = {}) {
    // Level-pattern columns (`a1`..`c1`) skip validation: they are pattern
    // templates that deliberately stay out of TRANSLATABLE_FIELDS (machine
    // translation would mangle their `[verb stem X]` placeholders), so there
    // is no shared-map entry for them — everything else still fails loudly.
    if (validateField) sourceOf(field);
    const obj = { en: enValue };
    for (const lang of SHEET_LANGUAGES) {
        const v = firstLocalized(rows, field, lang);
        if (v) obj[lang] = v;
    }
    return obj;
}

// Lesson-level CEFR pattern columns for the course mission dropdown
// (`a1`..`c1`, with optional `a1_es`-style language columns). Deliberately NOT
// registered in TRANSLATABLE_FIELDS: the values are pattern templates whose
// `[verb stem X]` placeholders machine translation would mangle, so they stay
// English-source; hand-filled `<col>_<lang>` cells are still read when present.
// Like `mission`, conflicts throw on the authoring path (`singleValue`) and
// first-win on the master path (`firstNonBlank`).
export const LEVEL_PATTERN_COLUMNS = ['a1', 'a2', 'b1', 'b2', 'c1'];

// Sheet column -> courseMission key. Uppercase CEFR codes match the course
// metadata the app renders (the mission dropdown labels unknown keys as-is).
export const LEVEL_PATTERN_KEYS = { a1: 'A1', a2: 'A2', b1: 'B1', b2: 'B2', c1: 'C1' };

/** English value plus each present language for a level-pattern column. */
function levelPatternObject(rows, field, enValue) {
    return localizedObject(rows, field, enValue, { validateField: false });
}

/**
 * The course mission dropdown content from the first shareCta lesson (the
 * course entry lesson): its mission/setting/roles plus the A1..C1 level
 * patterns. Undefined when that lesson carries none of these, so the key
 * stays out of the config entirely. Values are copied, never aliased: the
 * emitted courseMission must not share object identity with the lessons.
 */
export function courseMissionFromLessons(lessons) {
    const list = lessons || [];
    const first = list.find((l) => l && l.recapOverlay === 'shareCta') || list[0];
    if (!first) return undefined;
    const copy = (value) => (
        value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : value
    );
    const mission = {};
    for (const key of ['mission', 'setting', 'roleUser', 'roleOther']) {
        if (first[key]) mission[key] = copy(first[key]);
    }
    for (const col of LEVEL_PATTERN_COLUMNS) {
        if (first[col]) mission[LEVEL_PATTERN_KEYS[col]] = copy(first[col]);
    }
    return Object.keys(mission).length > 0 ? mission : undefined;
}

/**
 * The step's subtitles from `srt`/`srt_<lang>`, or undefined when the English
 * `srt` is blank. The English `srt` is the pipeline-written JSON-escaped string
 * (`unescapeSrt`); `srt_<lang>` is a literal SRT document (translation text,
 * timings preserved) and is taken verbatim. First non-blank value across the
 * group's rows wins (a joined step's SRT is written to every row).
 *
 * A non-blank `srt_<lang>` whose cue count/timings do not match the English SRT
 * is a structural error, not silently emitted: the app would render captions
 * against the wrong timings. This is the same check the translate step applies
 * when it writes `srt_<lang>`, so a stale cell (e.g. configs generated without a
 * preceding translate run) fails the course loudly instead of shipping. The
 * generator is pure, so it throws; `buildCourseConfigs` reports the skip.
 */
function srtSubtitlesFor(rows, context) {
    const en = firstNonBlank(rows, 'srt');
    if (!en) return undefined;
    const obj = { en: unescapeSrt(en) };
    for (const lang of SHEET_LANGUAGES) {
        const v = firstNonBlank(rows, localizedColumn('srt', lang));
        if (!v) continue;
        const validation = validateSrtCell(en, v);
        if (!validation.ok) {
            throw new Error(`${context}: srt_${lang} is not a timing-consistent translation of srt (${validation.reason})`);
        }
        obj[lang] = v;
    }
    return obj;
}

/**
 * The subtitles for a group: `srt`/`srt_<lang>` (JSON-escaped English, localized
 * by the `srt_<lang>` columns) wins, else `subtitle_text` verbatim (localized by
 * `subtitle_text_<lang>`); both blank -> undefined (the key is omitted).
 */
function subtitlesFor(groupRows, context) {
    const fromSrt = srtSubtitlesFor(groupRows, context);
    if (fromSrt) return fromSrt;
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
        // Pair each row's English cue_alt lines with that same row's
        // cue_alt_<lang> lines (by index within the row), then concatenate the
        // rows in group order. Pairing per row matters when an earlier row's
        // language cell is blank: a global flatMap would compact a later row's
        // translation upward onto the wrong English alternative. A blank or
        // out-of-range language line simply omits that language for the element.
        return groupRows.flatMap((row) => {
            const enLines = groupCueAltLines(cell(row, cueAltField));
            const langLines = {};
            for (const lang of SHEET_LANGUAGES) {
                langLines[lang] = groupCueAltLines(cell(row, localizedColumn('cue_alt', lang)));
            }
            return enLines.map((en, i) => {
                const obj = { en };
                for (const lang of SHEET_LANGUAGES) {
                    const t = langLines[lang][i];
                    if (t) obj[lang] = t;
                }
                return obj;
            });
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
 * The step's `nextStep` number from the `next_step` column, or undefined when
 * blank. `next_step` is an optional step-level advance override (an offset from
 * the step's own index) emitted for any response type — a `branching` step's
 * empty-choices Continue fallback honors it too. A non-blank value must be an
 * integer >= 1 (a structural error otherwise; bad data is never dropped).
 */
function nextStepFor(groupRows, videoFile) {
    const value = singleValue(groupRows, 'next_step', `video_file "${videoFile}"`);
    if (!value) return undefined;
    if (!/^\d+$/.test(value) || Number(value) < 1) {
        throw new Error(`video_file "${videoFile}": next_step must be an integer >= 1 ("${value}")`);
    }
    return Number(value);
}

/**
 * The step's `chooseStep` array from the `choose_step_next` (1-based offsets) and
 * `choose_step_text` (labels) columns, or undefined when neither is set. Both
 * source columns are newline-separated cells flattened across the step's rows in
 * row order, paired by index — the same shape as `cue_alt`. Per-row language
 * pairing mirrors `cueFor`: row *r*'s English line *i* pairs with that same row's
 * `choose_step_text_<lang>` line *i* (a blank/out-of-range line omits the
 * language for that choice, never an empty-string locale).
 *
 * Malformed choice data is a structural error: the offending course is not
 * generated and the message names the `video_file`. `chooseStep` is only valid on
 * a `branching` step.
 *
 * @param {Array<Record<string,string>>} stepRows the step's rows (all sub-groups
 *   for a master `join`)
 * @param {string} videoFile the step key, for error messages
 * @param {string} responseType the step's response type
 * @returns {Array<{nextStep: number, text: object}>|undefined}
 */
function chooseStepFor(stepRows, videoFile, responseType) {
    const textField = sourceOf('choose_step_text');
    const nextLines = [];
    const textEntries = [];
    for (const row of stepRows) {
        for (const line of groupCueAltLines(cell(row, 'choose_step_next'))) nextLines.push(line);
        groupCueAltLines(cell(row, textField)).forEach((text, localIndex) => {
            textEntries.push({ text, row, localIndex });
        });
    }
    if (nextLines.length === 0 && textEntries.length === 0) return undefined;
    if (nextLines.length === 0 || textEntries.length === 0) {
        throw new Error(`video_file "${videoFile}": choose_step_next and choose_step_text must both be set`);
    }
    if (nextLines.length !== textEntries.length) {
        throw new Error(
            `video_file "${videoFile}": choose_step_next has ${nextLines.length} lines ` +
            `but choose_step_text has ${textEntries.length}`
        );
    }
    const chooseStep = textEntries.map(({ text, row, localIndex }, i) => {
        const line = nextLines[i];
        if (!/^\d+$/.test(line) || Number(line) < 1) {
            throw new Error(
                `video_file "${videoFile}": choose_step_next line ${i + 1} is not an integer >= 1 ("${line}")`
            );
        }
        const obj = { en: text };
        for (const lang of SHEET_LANGUAGES) {
            const t = groupCueAltLines(cell(row, localizedColumn('choose_step_text', lang)))[localIndex];
            if (t) obj[lang] = t;
        }
        return { nextStep: Number(line), text: obj };
    });
    if (responseType !== 'branching') {
        throw new Error(`video_file "${videoFile}": choose_step_* is only valid on a branching step`);
    }
    return chooseStep;
}

/**
 * The single master grouping: a step is one video, keyed by the `join` value
 * when non-blank, else `video_file`. Returns the step groups in first-seen
 * order, each with its `video_file` sub-groups in first-seen order (a joined
 * step concatenates two option videos, so its cue array spans both sub-groups).
 * Rows with neither key are skipped; callers that must fail on them (the
 * builder) check first, so the detector and the builder cannot drift.
 */
function groupMasterRowsByKey(lessonRows) {
    const order = [];
    const byKey = new Map();
    for (const row of lessonRows) {
        const join = cell(row, 'join').trim();
        const videoFile = cell(row, 'video_file').trim();
        const key = join || videoFile;
        if (!key) continue;
        if (!byKey.has(key)) { byKey.set(key, { subOrder: [], subs: new Map() }); order.push(key); }
        const group = byKey.get(key);
        if (!group.subs.has(videoFile)) { group.subs.set(videoFile, []); group.subOrder.push(videoFile); }
        group.subs.get(videoFile).push(row);
    }
    return order.map((key) => {
        const group = byKey.get(key);
        return {
            key,
            subgroups: group.subOrder.map((videoFile) => ({ videoFile, rows: group.subs.get(videoFile) })),
        };
    });
}

/** Rows sorted by numeric `Order` ascending, ties by first-seen (stable). */
function sortByOrder(rows) {
    return rows
        .map((row, index) => ({ row, index, order: Number(cell(row, 'order').trim()) }))
        .sort((a, b) => (a.order - b.order) || (a.index - b.index))
        .map((entry) => entry.row);
}

/**
 * The master step's `cue`: an ordered array of `{en, es?, pt?, bn?}`, one
 * element per non-blank `phrase` row, ordered by `Order` within each
 * `video_file` sub-group and concatenated in sub-group first-seen order.
 */
function masterCueFor(subgroups) {
    const phraseField = sourceOf('phrase');
    const cue = [];
    for (const { rows } of subgroups) {
        for (const row of sortByOrder(rows)) {
            const en = cell(row, phraseField).trim();
            if (!en) continue;
            const obj = { en };
            for (const lang of SHEET_LANGUAGES) {
                const v = cell(row, localizedColumn('phrase', lang)).trim();
                if (v) obj[lang] = v;
            }
            cue.push(obj);
        }
    }
    return cue.length ? cue : undefined;
}

/** Build steps from the overlay master (steps in first-seen group order). */
function buildMasterSteps(lessonRows) {
    const keyless = lessonRows.find((row) => !cell(row, 'join').trim() && !cell(row, 'video_file').trim());
    if (keyless) throw new Error(`row "${cell(keyless, 'filename')}" is missing video_file/join`);

    const steps = [];
    for (const { key, subgroups } of groupMasterRowsByKey(lessonRows)) {
        const stepRows = subgroups.flatMap((group) => group.rows);
        // A step's `response_type` must be unambiguous (mirrors the authoring
        // path's `singleValue`); blanks are ignored, disagreements throw.
        const responseType = singleValue(stepRows, 'response_type', `video_file "${key}"`);
        if (!responseType) throw new Error(`video_file "${key}": missing response_type`);
        if (!RESPONSE_TYPES.includes(responseType)) {
            throw new Error(`video_file "${key}": unknown response_type "${responseType}"`);
        }
        for (const row of stepRows) {
            if (!/^-?\d+$/.test(cell(row, 'order').trim())) {
                throw new Error(
                    `video_file "${key}" row "${cell(row, 'filename')}": missing/non-numeric Order`
                );
            }
        }
        const step = { responseType, simpleVideoUrl: appSlug(key) };
        const cue = masterCueFor(subgroups);
        if (cue !== undefined) step.cue = cue;
        const chooseStep = chooseStepFor(stepRows, key, responseType);
        if (chooseStep !== undefined) step.chooseStep = chooseStep;
        const nextStep = nextStepFor(stepRows, key);
        if (nextStep !== undefined) step.nextStep = nextStep;
        const publishLessonId = singleValue(stepRows, 'publish_lesson_id', `video_file "${key}"`);
        if (publishLessonId) step.publishLessonId = publishLessonId;
        // App subtitles come from `srt`/`srt_<lang>` only — the master's
        // `subtitle_text` is burnt-in overlay markup, never app subtitles. The
        // pipeline writes one SRT per step (the join's cumulative-offset SRT to
        // every row of a join), so `srtSubtitlesFor` reads the first non-blank
        // value and never concatenates sub-groups. A friend/UGC step is skipped
        // whole: its clip already carries the speaker's caption burned in, and
        // skipping the call (not just the result) also skips `srt_<lang>` timing
        // validation, so a stray translation on a friend row can never skip the
        // course.
        if (!isFriendVideoSlug(key)) {
            const subtitles = srtSubtitlesFor(stepRows, `video_file "${key}"`);
            if (subtitles !== undefined) step.subtitles = subtitles;
        }
        steps.push(step);
    }
    return steps;
}

/**
 * Build the ordered step list for one lesson's groups. In master format
 * (`phrase` present) steps follow the master rules (join grouping, cue array);
 * otherwise the authoring-sheet rules apply and steps are ordered by the numeric
 * `Order` column (ascending), ties by first-seen CSV order.
 * @returns {Array<object>} step objects
 */
export function buildSteps(lessonRows, options = {}) {
    const master = options.master ?? headerKeys(lessonRows).includes('phrase');
    const steps = master ? buildMasterSteps(lessonRows) : buildAuthoringSteps(lessonRows);
    // The end-of-lesson success step is code-owned: the app injects it per lesson
    // type (src/modules/lesson/success-step-logic.js), so a sheet success row or
    // success_* column never produces a config step.
    return steps.filter((step) => step.responseType !== 'success');
}

function buildAuthoringSteps(lessonRows) {
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
            step.introBackgroundVideoUrl = appSlug(videoFile);
        } else {
            const cue = cueFor(groupRows, videoFile);
            if (cue !== undefined) step.cue = cue;
            step.responseType = responseType;
            step.simpleVideoUrl = appSlug(videoFile);
        }
        const chooseStep = chooseStepFor(groupRows, videoFile, responseType);
        if (chooseStep !== undefined) step.chooseStep = chooseStep;
        const nextStep = nextStepFor(groupRows, videoFile);
        if (nextStep !== undefined) step.nextStep = nextStep;
        const publishLessonId = singleValue(groupRows, 'publish_lesson_id', `video_file "${videoFile}"`);
        if (publishLessonId) step.publishLessonId = publishLessonId;
        // A friend/UGC step (a `{friendCode}` key) gets no app `subtitles`: its
        // clip already carries the speaker's caption burned in. Skipping the call
        // also skips the `srt_<lang>` timing check and the `subtitle_text`
        // fallback.
        if (!isFriendVideoSlug(videoFile)) {
            const subtitles = subtitlesFor(groupRows, `video_file "${videoFile}"`);
            if (subtitles !== undefined) step.subtitles = subtitles;
        }

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
    if (isMasterFormat(headerKeys(videoRows))) return buildMasterCourseConfig(videoRows);

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
        for (const col of LEVEL_PATTERN_COLUMNS) {
            const pattern = singleValue(rowsForLesson, col, `lesson "${lessonId}"`);
            if (pattern) lesson[col] = levelPatternObject(rowsForLesson, col, pattern);
        }

        lesson.steps = buildSteps(rowsForLesson);
        return lesson;
    });

    const courseMission = courseMissionFromLessons(lessons);
    return courseMission
        ? { courseId, courseName, courseMission, lessons }
        : { courseId, courseName, lessons };
}

/**
 * Assemble a course config from overlay-master rows: course/lesson scalars are
 * first-non-blank across the course/lesson, steps come from `buildMasterSteps`
 * (`join`/`video_file` grouping, `phrase` cue array), and the `lessonIntro` step
 * is synthesized from `intro_video` when present.
 *
 * The end-of-lesson `success` step is NOT emitted: it is code-owned now (see
 * src/modules/lesson/success-step-logic.js), injected by the app per lesson type
 * with its own bundled captions. The sheet's `success_video`/`success_srt`
 * columns are therefore unused by the generator.
 */
function buildMasterCourseConfig(videoRows) {
    const courseId = firstNonBlank(videoRows, 'course_id');
    const courseName = firstNonBlank(videoRows, 'course_name');
    if (!courseId) throw new Error('missing course_id column value');
    if (!courseName) throw new Error('missing course_name column value');

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
        const title = firstNonBlank(rowsForLesson, 'lesson_title');
        if (!title) throw new Error(`lesson "${lessonId}": missing lesson_title`);

        const recapSources = firstNonBlank(rowsForLesson, 'recap_sources') || 'none';
        if (!RECAP_SOURCES.includes(recapSources)) {
            throw new Error(`lesson "${lessonId}": invalid recap_sources "${recapSources}"`);
        }
        const recapOverlay = firstNonBlank(rowsForLesson, 'recap_overlay') || 'shareCta';
        if (!RECAP_OVERLAYS.includes(recapOverlay)) {
            throw new Error(`lesson "${lessonId}": invalid recap_overlay "${recapOverlay}"`);
        }

        const lesson = {
            lessonId, recapSources, recapOverlay,
            title: localizedObject(rowsForLesson, 'lesson_title', title),
        };

        const unit = firstNonBlank(rowsForLesson, 'unit');
        if (unit) lesson.unit = unit;
        const mission = firstNonBlank(rowsForLesson, sourceOf('mission'));
        if (mission) lesson.mission = localizedObject(rowsForLesson, 'mission', mission);
        for (const col of LEVEL_PATTERN_COLUMNS) {
            const pattern = firstNonBlank(rowsForLesson, col);
            if (pattern) lesson[col] = levelPatternObject(rowsForLesson, col, pattern);
        }

        lesson.steps = buildMasterSteps(rowsForLesson);

        const introVideo = firstNonBlank(rowsForLesson, 'intro_video');
        if (introVideo) {
            lesson.steps.unshift({ cue: '', responseType: 'lessonIntro', introBackgroundVideoUrl: appSlug(introVideo) });
        }
        // No success step is emitted: it is code-owned (see
        // src/modules/lesson/success-step-logic.js) and injected by the app per
        // lesson type, so the sheet's success_video/success_srt are unused here.
        return lesson;
    });

    const courseMission = courseMissionFromLessons(lessons);
    return courseMission
        ? { courseId, courseName, courseMission, lessons }
        : { courseId, courseName, lessons };
}

/** Deterministically order + dedupe a missing-columns list, as `findMissingColumns` reports it. */
function sortMissing(missing) {
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
 * Master-format missing-column detector. Mirrors `buildMasterSteps` grouping
 * EXACTLY: a step is `join` (when non-blank) else `video_file`, grouped within a
 * lesson, so a joined step is validated as one step.
 */
function findMissingMasterColumns(videoRows) {
    const missing = [];
    const add = (column, where) => missing.push({ column, where });
    if (videoRows.length === 0) return [];

    if (!firstNonBlank(videoRows, 'course_id')) add('course_id', 'course');
    if (!firstNonBlank(videoRows, 'course_name')) add('course_name', 'course');

    for (const row of videoRows) {
        if (!cell(row, 'lesson_id').trim()) add('lesson_id', `row "${cell(row, 'filename')}"`);
        if (!cell(row, 'video_file').trim() && !cell(row, 'join').trim()) {
            add('video_file', `row "${cell(row, 'filename')}"`);
        }
    }

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
        if (!firstNonBlank(rowsForLesson, 'lesson_title')) add('lesson_title', `lesson "${lessonId}"`);

        // The same grouping buildMasterSteps uses (keyless rows skipped here;
        // this detector must never throw).
        for (const { key, subgroups } of groupMasterRowsByKey(rowsForLesson)) {
            const groupRows = subgroups.flatMap((group) => group.rows);
            if (!firstNonBlank(groupRows, 'response_type')) {
                add('response_type', `video_file "${key}"`);
            }
            for (const row of groupRows) {
                if (!/^-?\d+$/.test(cell(row, 'order').trim())) {
                    add('order', `video_file "${key}" row "${cell(row, 'filename')}"`);
                }
            }
        }
    }

    return sortMissing(missing);
}

/**
 * The required columns that are blank for one course's selected rows, as a
 * deduplicated, deterministically ordered list of `{ column, where }`. Pure and
 * non-throwing — it never builds a config, it only reports what a build would
 * need. `course_id`/`course_name` are course-wide; `lesson_id`/`lesson_title`
 * per lesson; `response_type`/`video_file`/`order` per row/group. In master
 * format the grouping follows `join`/`video_file` (`buildMasterSteps`).
 *
 * @param {Array<Record<string,string>>} rows one course's video rows
 * @returns {Array<{column: string, where: string}>}
 */
export function findMissingColumns(rows) {
    const videoRows = (rows || []).filter(isVideoRow);
    if (isMasterFormat(headerKeys(videoRows))) return findMissingMasterColumns(videoRows);
    const missing = [];
    const add = (column, where) => missing.push({ column, where });

    if (videoRows.length === 0) return [];

    // Existence (first non-blank) — deliberately NOT `singleValue`, which throws
    // on conflicts. This detector must never throw: a conflict is a structural
    // error that `buildCourseConfig` reports per-course, and the detector must
    // not abort the whole multi-course run.

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

    return sortMissing(missing);
}

/**
 * Steps of one course's rows still waiting on the render: a step is complete
 * when at least one of its rows carries a non-blank `srt`. The render writes
 * SRT only for groups it concatenated, and the write-back never clears — so a
 * missing `srt` means that step has no published video yet. Grouping mirrors
 * the builder EXACTLY (master: `join` else `video_file` within a lesson).
 * Never throws; skipped silently:
 * - `success` rows (code-owned step, never rendered),
 * - friend/UGC steps (`{friendCode}` keys carry burned-in captions, never `srt`),
 * - rows with a blank `lesson_id` (unattributable to any lesson),
 * - authoring-shape courses entirely (their subtitles come from
 *   `subtitle_text`, which needs no render),
 * - `intro_video` slugs (the synthesized lessonIntro step reuses an
 *   already-gated step video — `sourceToRows` points it at the lesson's first
 *   video — so no independent render ever owes it an `srt`).
 * Pure; returns `[{ lesson, key }]` in first-seen order.
 */
export function incompleteVideoSteps(rows) {
    const videoRows = (rows || []).filter(isVideoRow);
    if (!isMasterFormat(headerKeys(videoRows))) return [];
    const lessonOrder = [];
    const lessonRows = new Map();
    for (const row of videoRows) {
        const lessonId = cell(row, 'lesson_id').trim();
        if (!lessonId) continue;
        if (!lessonRows.has(lessonId)) { lessonRows.set(lessonId, []); lessonOrder.push(lessonId); }
        lessonRows.get(lessonId).push(row);
    }
    const missing = [];
    for (const lessonId of lessonOrder) {
        for (const { key, subgroups } of groupMasterRowsByKey(lessonRows.get(lessonId))) {
            const stepRows = subgroups
                .flatMap((group) => group.rows)
                .filter((row) => cell(row, 'response_type').trim() !== 'success');
            if (stepRows.length === 0) continue;
            if (isFriendVideoSlug(key)) continue;
            if (!stepRows.some((row) => cell(row, 'srt').trim())) {
                missing.push({ lesson: lessonId, key });
            }
        }
    }
    return missing;
}

/**
 * Partition video rows by the `course_id` column value (first-seen order).
 * `course_id` is course-scoped and may be filled once (blank on later rows),
 * so a blank cell belongs to the most recent non-blank value above it. A
 * leading blank still forms the `""` partition and is reported missing.
 * Pure; shared by the builder and the `--require-videos` completeness check
 * so the two can never partition differently.
 *
 * @param {Array<Record<string,string>>} rows parsed rows
 * @returns {Array<{courseId: string, rows: Array<Record<string,string>>}>}
 */
export function partitionRowsByCourse(rows) {
    const videoRows = (rows || []).filter(isVideoRow);
    const order = [];
    const partitions = new Map();
    let currentCourseId = '';
    for (const row of videoRows) {
        const cellCourseId = cell(row, 'course_id').trim();
        if (cellCourseId) currentCourseId = cellCourseId;
        const courseId = cellCourseId || currentCourseId;
        if (!partitions.has(courseId)) { partitions.set(courseId, []); order.push(courseId); }
        partitions.get(courseId).push(row);
    }
    return order.map((courseId) => ({ courseId, rows: partitions.get(courseId) }));
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
    return partitionRowsByCourse(rows).map(({ courseId, rows: partitionRows }) => {
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
