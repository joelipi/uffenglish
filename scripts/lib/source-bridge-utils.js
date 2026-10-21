// scripts/lib/source-bridge-utils.js
// Pure transform: a friend-course source config (`wouldyourather.source.txt`)
// -> master-shape sheet rows for the EXISTING pipeline (recorder, Modal render,
// generate-config-from-sheet.mjs). This is the Option-A bridge: the source file
// stays the authoring truth, and everything downstream keeps working unchanged
// until each consumer learns to read the source natively.
//
// Every derivation rule here mirrors the source file's `_doc` contract:
//   step video slugs:   {course}-{lesson}-{step:02}      (step = the lesson's
//                       own take-group ordinal; reuse steps keep the ask slug,
//                       branching steps carry the friend ref as their key)
//   take slugs:         {video}-{take:02}
//   friend refs:        {friendCode}{selfCode}-{course}-{askId}-{topic:02}
//                       (topic = the question's 1-based index in the ask lesson)
//   overlay HTML:       rungs template; take N shows rungs 1..N-1 plain, rung N
//                       filled + bold (the spoken line), the rest blank
//                       (`___________`, 11 underscores — the sheet's marker)
//   routing:            the branch's k-th choice targets the k-th option group
//                       (offsets 1..k); option m of k advances past its group
//                       (offset k-m)
//   lesson framing:     intro_video = the lesson's first video (the old
//                       generator synthesizes the lessonIntro opener from it);
//                       recap ask=none/shareCta, answer=friend/shareCta
//                       (mirrors the code-owned recap rules); no success_*
//                       columns (the success step is app-injected at runtime)
//   levels:             the course patterns ride a1..c1 on every row; the old
//                       generator reads those headers when present
//   title_text:         the course video_title, verbatim
//
// Deliberate deviations from byte-fidelity with the hand sheet (all render the
// same): take 1's overlay drops the sheet's stray `>` before `</aside>`; the
// new slug convention replaces `wouldyourather_a01`-style keys (old R2 objects
// are orphaned — the app is in development and re-renders everything).

/** Blank rung marker: 11 underscores (measured from the sheet, not recalled). */
export const BLANK_RUNG = '___________';

/** Recorder teleprompter default (the pipeline never reads this column). */
export const DEFAULT_CHARACTER = 'CasualTeacher';

import { LOCALIZATION_FIELDS, SHEET_LANGUAGES, TRANSLATABLE_FIELDS, localizedColumn } from './sheet-translate-utils.js';
import { LEVEL_PATTERN_COLUMNS, csvField as sharedCsvField, serializeCsv } from './sheet-config-utils.js';

// Re-exported (single implementation lives in sheet-config-utils.js) so the
// bridge CLI and existing importers keep working unchanged.
export { sharedCsvField as csvField };

// The master sheet's BASE columns: the recorder's teleprompter fields and the
// render pipeline's media/overlay inputs, in the live sheet's order. Two
// deliberate deviations from the live header, both documented:
//   * the sound-effect columns keep the CamelCase the PYTHON pipeline reads
//     them with (`safe_get_value` is case-sensitive, video_pipeline.py). The
//     live sheet spells them lower-case, which that reader silently ignores, so
//     a filled `bgMusic` cell would do nothing; the JS readers lower-case
//     headers, so nothing else is affected.
//   * `dutch_tilt` is read by the pipeline (video_pipeline.py) but was missing
//     from the live header entirely.
export const LIVE_BASE_COLUMNS = [
    'title_text', 'order', 'app-repeat', 'app-ai', 'mirror', 'background',
    'character', 'phrase', 'directions', 'props', 'effect', 'bgSound',
    'endSoundEffect', 'h3', 'previousline', 'filename', 'join', 'video_file',
    'footer_text', 'bgMusic', 'subtitle_text', 'foreground', 'overlay', 'image',
    'dutch_tilt',
];

// Config columns: the contract the generator's master path consumes (course
// scalars, lesson framing, step routing, subtitles). Pinned by the parity test
// below, so neither side can drift silently.
// `hero` is the course-level banner the generator emits as `courseHeroImage`
// (resolved against bundled assets by friend-course-configs.js). It rides the
// bridge like `course_name` — a plain scalar, never a translated field.
export const BRIDGE_CONFIG_COLUMNS = [
    'course_id', 'course_name', 'hero', 'tags', 'lesson_id', 'lesson_title', 'response_type',
    'unit', 'mission', 'recap_sources', 'recap_overlay', 'intro_video',
    'success_video', 'success_srt', 'success_srt_es', 'success_srt_pt',
    'success_srt_bn', 'success_srt_fr', 'success_srt_hi', 'srt', 'next_step', 'choose_step_next', 'choose_step_text',
    'publish_lesson_id',
    // Structural columns: the course's shape, so the generator can rebuild the
    // ABABAB lesson chain instead of re-deriving it from the row order.
    //   pair_index    1-based pair number
    //   set_role      'question' (the pair's question takes) | 'answer' (its answer takes)
    //   topic_index   1-based topic within the set
    //   group_index   1-based group within the topic (questions: the phrasing
    //                 itself; answers: the option)
    //   variant_index 1-based take within the group (the phrasing)
    'pair_index', 'set_role', 'topic_index', 'group_index', 'variant_index',
];

// Localization columns are DERIVED from the shared field map (the same source
// the translator and the seed use), never hand-copied: adding a translatable
// field can no longer leave the bridge CSV without its columns.
export const LOCALIZATION_COLUMNS = LOCALIZATION_FIELDS.flatMap((f) =>
    SHEET_LANGUAGES.map((lang) => localizedColumn(f.field, lang)));

// The full emitted header. Named reads make the order irrelevant to every
// consumer, but a stable order keeps the CSV diffable. LEVEL_PATTERN_COLUMNS is
// imported from the generator, never re-declared, so a new rung column cannot
// leave the bridge CSV without it.
export const MASTER_HEADER = [
    ...LIVE_BASE_COLUMNS,
    ...BRIDGE_CONFIG_COLUMNS,
    ...LOCALIZATION_COLUMNS,
    ...LEVEL_PATTERN_COLUMNS,
];
/**
 * Parse a source file: strip full-line `//` comments, then strict JSON.parse.
 * Pure; throws with context on invalid input.
 *
 * @param {string} text raw file text
 * @returns {object} the source config
 */
export function parseSourceConfig(text) {
    const body = String(text ?? '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    try {
        return JSON.parse(body);
    } catch (err) {
        throw new Error(`source config is not valid JSON (after comment-strip): ${err.message}`);
    }
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * The burned-in overlay for take `takeIndex` (0-based) of a step: rungs above
 * are filled plain, the spoken rung is filled + bold, the rest are blank.
 * Pure; throws naming the step when phrases and rungs disagree in count.
 *
 * @param {string[]} phrases ordered simple-first
 * @param {string[]} rungs course rung labels
 * @param {number} takeIndex 0-based take position
 * @param {string} context step label for error messages
 * @returns {string} the `<aside>` overlay HTML
 */
export function overlayFor(phrases, rungs, takeIndex, context = 'step') {
    if (!Array.isArray(phrases) || phrases.length === 0) {
        throw new Error(`${context}: a response step needs at least one phrase`);
    }
    if (!Array.isArray(rungs) || rungs.length !== phrases.length) {
        throw new Error(
            `${context}: ${phrases.length} phrase(s) but ${Array.isArray(rungs) ? rungs.length : 'no'} rung(s) — extend "rungs" first`
        );
    }
    if (!Number.isInteger(takeIndex) || takeIndex < 0 || takeIndex >= phrases.length) {
        throw new Error(`${context}: take index ${takeIndex} is out of range for ${phrases.length} phrase(s)`);
    }
    const lines = phrases.map((p, i) => {
        const label = `<b>${rungs[i]}</b> `;
        if (i < takeIndex) return label + p;
        if (i === takeIndex) return `<strong>${label}${p}</strong>`;
        return label + BLANK_RUNG;
    });
    return `<aside>${lines.join('<br>')}</aside>`;
}

/** A level pattern as a plain string: accepts `"X"` or `{en: "X"}` (the app
 * config shape the values were backfilled from), and throws on anything else
 * rather than serializing `"[object Object]"` into the CSV. Pure. */
function levelPattern(value, key, context) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.en === 'string') return value.en;
    if (value === undefined || value === null) return '';
    throw new Error(`${context}: level "${key}" must be a string or {en} object`);
}

/**
 * Serialize rows to an RFC-4180 CSV string with the master header. Pure.
 *
 * @param {Array<Record<string,string>>} rows
 * @returns {string}
 */
export function rowsToCsv(rows) {
    return serializeCsv(MASTER_HEADER, rows);
}

/**
 * The carry-over key for a master row: takes are keyed by `filename`, every
 * other row (reuse rows, branching rows) by lesson + step + phrase. Takes and
 * non-takes live in separate key spaces so a take can never inherit a reuse
 * row's cells, and the lesson qualifier keeps identical video+phrase reuse
 * rows in different lessons from colliding.
 */
export function translationCarryKey(row) {
    const filename = String(row?.filename ?? '').trim();
    if (filename) return `file:${filename}`;
    const lesson = String(row?.lesson_id ?? '').trim();
    const videoFile = String(row?.video_file ?? '').trim();
    return `step:${lesson}\0${videoFile}\0${String(row?.phrase ?? '').trim()}`;
}

// Every localizable cell and the English source column it follows: the generic
// fields plus `srt` (planned by its own pass but carried by the same rule).
const CARRY_SOURCES = [
    ...TRANSLATABLE_FIELDS.map((f) => ({ field: f.field, source: f.source })),
    { field: 'srt', source: 'srt' },
];

/**
 * Group rows into render steps: `join` else `video_file`, qualified by lesson
 * (the same grouping the generator builds config steps from). Rows with
 * neither key define no step and are skipped.
 */
function groupRowsBySrtStep(rows) {
    const order = [];
    const groups = new Map();
    for (const row of rows || []) {
        const join = String(row?.join ?? '').trim();
        const videoFile = String(row?.video_file ?? '').trim();
        const key = join || videoFile;
        if (!key) continue;
        const stepKey = `${String(row?.lesson_id ?? '').trim()}\0${key}`;
        if (!groups.has(stepKey)) { groups.set(stepKey, []); order.push(stepKey); }
        groups.get(stepKey).push(row);
    }
    return { order, groups };
}

/**
 * The cue phrases the render actually consumes for one step's rows: trimmed,
 * non-blank phrases in `Order` order within each `video_file` sub-group,
 * sub-groups concatenated in first-seen order. Mirrors `masterCueFor` /
 * `sortByOrder` (`scripts/lib/sheet-config-utils.js`) — the SRT is timed
 * against exactly this sequence, so the carry comparison must use it too (a
 * bare array-order compare would miss an `Order`-column retiming).
 */
function stepCueProjection(stepRows) {
    const subOrder = [];
    const subs = new Map();
    for (const row of stepRows) {
        const vf = String(row?.video_file ?? '').trim();
        if (!subs.has(vf)) { subs.set(vf, []); subOrder.push(vf); }
        subs.get(vf).push(row);
    }
    const out = [];
    for (const vf of subOrder) {
        const sorted = subs.get(vf)
            .map((row, index) => ({ row, index, order: Number(String(row?.order ?? '').trim()) }))
            .sort((a, b) => (a.order - b.order) || (a.index - b.index));
        for (const { row } of sorted) {
            const phrase = String(row?.phrase ?? '').trim();
            if (phrase) out.push(phrase);
        }
    }
    return out;
}

/**
 * Step-level English `srt` carry (runs before the per-row translation pass).
 * The render computes one SRT per step from that step's cue projection (see
 * `stepCueProjection`), so a stored `srt` stays valid **iff** the projection
 * is byte-identical between the committed and regenerated rows — a reworded,
 * added, removed, reordered, or `Order`-retimed step blanks the cell for the
 * next render (the `--require-videos` gate then holds the course until it
 * re-renders). Steps absent from either side carry nothing. A committed step
 * holding divergent `srt` values across its rows (manual edit, partial
 * re-render) is treated as corrupt and blanks rather than picking one
 * silently. Returns the rows, the filled-cell count, and the set of step keys
 * whose `srt` was kept (so the translation pass can gate `srt_<lang>` on the
 * same step verdict instead of per-row `srt` equality, keeping English and
 * translation an atomic pair). Pure; inputs untouched.
 */
function carryStepSrt(prevRows, nextRows) {
    const prevGrouped = groupRowsBySrtStep(prevRows);
    const nextGrouped = groupRowsBySrtStep(nextRows);
    const prevSrt = new Map();
    const prevCues = new Map();
    for (const [key, rows] of prevGrouped.groups) {
        prevCues.set(key, stepCueProjection(rows));
        const values = new Set();
        for (const r of rows) {
            const v = String(r?.srt ?? '');
            if (v.trim()) values.add(v);
        }
        // Exactly one distinct SRT: keep it. Zero, or divergent manual edits:
        // carry nothing (fail-closed).
        if (values.size === 1) prevSrt.set(key, [...values][0]);
    }
    const groupOf = new Map();
    for (const [key, rows] of nextGrouped.groups) {
        for (const r of rows) groupOf.set(r, key);
    }
    const nextCues = new Map();
    for (const [key, rows] of nextGrouped.groups) {
        nextCues.set(key, stepCueProjection(rows));
    }
    let carried = 0;
    const keptKeys = new Set();
    const fillSrt = new Map();
    for (const [key, rows] of nextGrouped.groups) {
        const srt = prevSrt.get(key);
        if (!srt) continue;
        const prevCue = prevCues.get(key) || [];
        const nextCue = nextCues.get(key) || [];
        if (prevCue.length !== nextCue.length) continue;
        if (!prevCue.every((p, i) => p === nextCue[i])) continue;
        // The kept step must already be uniform: every non-blank English cell
        // agrees with the carried value. A divergent cell stays untouched and
        // the step is not kept (its translations drop below).
        if (!rows.every((r) => {
            const v = String(r?.srt ?? '').trim();
            return !v || v === srt;
        })) continue;
        fillSrt.set(key, srt);
        keptKeys.add(key);
    }
    const out = (nextRows || []).map((row) => {
        const key = groupOf.get(row);
        const srt = key ? fillSrt.get(key) : undefined;
        if (!srt || String(row?.srt ?? '').trim()) return { ...row };
        carried++;
        return { ...row, srt };
    });
    return { rows: out, carried, keptKeys };
}

/**
 * Carry translations forward across a regeneration: for each regenerated row,
 * a `*_<lang>` cell keeps the previously committed value **iff** its English
 * source cell is byte-identical; otherwise it stays blank for the translator
 * to refill (blanks-only does the rest, so a missed carry-over self-heals
 * through the translate job). Rows with no previous match keep blank cells.
 * The English `srt` itself is carried at STEP granularity first (see
 * `carryStepSrt`): the render derives one SRT per step from that step's
 * ordered phrases, so a reworded step blanks its `srt` (and the gate holds the
 * course until it re-renders) while an untouched step keeps its captions.
 * Pure; returns new row objects (inputs untouched) plus the carried count.
 *
 * @param {Array<Record<string,string>>} prevRows previously committed rows
 * @param {Array<Record<string,string>>} nextRows regenerated rows
 * @returns {{ rows: Array<Record<string,string>>, carried: number }}
 */
export function carryOverTranslations(prevRows, nextRows) {
    const stepped = carryStepSrt(prevRows, nextRows);
    const prevByKey = new Map();
    for (const row of prevRows || []) {
        const key = translationCarryKey(row);
        if (!prevByKey.has(key)) prevByKey.set(key, row);
    }
    const stepOf = new Map();
    {
        const grouped = groupRowsBySrtStep(stepped.rows);
        for (const [key, rows] of grouped.groups) {
            for (const r of rows) stepOf.set(r, key);
        }
    }
    let carried = stepped.carried;
    const rows = stepped.rows.map((row) => {
        const prev = prevByKey.get(translationCarryKey(row));
        if (!prev) return { ...row };
        const next = { ...row };
        const stepKey = stepOf.get(row);
        for (const { field, source } of CARRY_SOURCES) {
            if (field === 'srt') {
                // Step verdict, not per-row English equality: the whole step
                // kept or lost its English together, so the translation
                // follows atomically (never a carried English with a dropped
                // translation, or vice versa, within one step).
                if (!stepped.keptKeys.has(stepKey)) continue;
            } else if (String(prev[source] ?? '') !== String(next[source] ?? '')) {
                // The English source must be byte-identical — a reworded
                // source invalidates the stored translation by design.
                continue;
            }
            for (const lang of SHEET_LANGUAGES) {
                const target = localizedColumn(field, lang);
                const prevValue = String(prev[target] ?? '');
                if (!prevValue.trim()) continue;
                if (String(next[target] ?? '').trim()) continue;
                next[target] = prevValue;
                carried++;
            }
        }
        return next;
    });
    return { rows, carried };
}

/**
 * Rows (header-keyed objects) for the whole course, in authoring order: each
 * pair's ask lesson first (question videos), then its answer lesson (topic
 * groups: reuse rows, one branching row, option takes). Pure; throws on any
 * structural problem (choices/answers mismatch, bad rung counts).
 *
 * @param {object} source parsed source config
 * @returns {Array<Record<string,string>>}
 */
export function sourceToRows(source) {
    if (!source || typeof source !== 'object') throw new Error('source config must be an object');
    const { course, title, mission, levels, rungs, pairs } = source;
    if (!course) throw new Error('source config is missing "course"');
    if (!Array.isArray(pairs) || pairs.length === 0) throw new Error('source config needs at least one pair');
    if (!levels || typeof levels !== 'object') throw new Error('source config is missing "levels"');

    const rows = [];
    const cell = (overrides) => {
        const row = {};
        for (const h of MASTER_HEADER) row[h] = '';
        return Object.assign(row, {
            course_id: course,
            course_name: title || '',
            hero: source.hero || '',
            // Course-level tags ride every row as a pipe-separated list (the
            // sheet is flat; the generator turns them back into an array).
            tags: (Array.isArray(source.tags) ? source.tags : []).filter(Boolean).join('|'),
            mission: mission || '',
            a1: levelPattern(levels.A1, 'A1', `course ${course}`),
            a2: levelPattern(levels.A2, 'A2', `course ${course}`),
            b1: levelPattern(levels.B1, 'B1', `course ${course}`),
            b2: levelPattern(levels.B2, 'B2', `course ${course}`),
            c1: levelPattern(levels.C1, 'C1', `course ${course}`),
            title_text: source.video_title || '',
        }, overrides);
    };

    for (const [pairIndex, pair] of pairs.entries()) {
        const askId = pair?.ask?.id;
        const ansId = pair?.answer?.id;
        if (!askId || !ansId) throw new Error('every pair needs ask.id and answer.id');
        // The chain's closing lesson (the LAST pair only): the lesson that
        // answers the pair's questions one more time and then says goodbye
        // instead of recording another question set.
        const closingId = pair?.closing?.id || '';
        if (closingId) {
            if (pairIndex !== pairs.length - 1) {
                throw new Error(
                    `pair ${askId}-${ansId} declares a closing lesson; only the LAST pair can close the chain`
                );
            }
            if (!pair?.closing?.title) {
                throw new Error(`closing lesson "${closingId}" needs a title`);
            }
        }
        const topics = pair?.topics;
        if (!Array.isArray(topics) || topics.length === 0) {
            throw new Error(`pair ${askId}-${ansId} needs at least one topic`);
        }
        // Rows for this pair only, so the intro_video fill below cannot leak
        // across pairs.
        const pairRows = [];
        const push = (row) => { rows.push(row); pairRows.push(row); };
        const pairNo = String(pairIndex + 1);

        // --- ask lesson: one take-group per topic, in order ---
        let askFirstVideo = '';
        topics.forEach((topic, k) => {
            const stepNo = k + 1;
            const video = `${course}-${askId}-${pad2(stepNo)}`;
            if (k === 0) askFirstVideo = video;
            const phrases = topic?.question;
            if (!Array.isArray(phrases) || phrases.length === 0) {
                throw new Error(`pair ${askId}-${ansId} topic ${stepNo}: missing "question" phrases`);
            }
            phrases.forEach((phrase, j) => {
                push(cell({
                    lesson_id: askId,
                    lesson_title: pair.ask.title || '',
                    response_type: 'friendClosedResponse',
                    video_file: video,
                    filename: `${video}-${pad2(j + 1)}`,
                    order: String(j + 1),
                    character: DEFAULT_CHARACTER,
                    phrase,
                    subtitle_text: overlayFor(phrases, rungs, j, `${askId} topic ${stepNo}`),
                    recap_sources: 'none',
                    recap_overlay: 'shareCta',
                    pair_index: pairNo,
                    set_role: 'question',
                    topic_index: String(stepNo),
                    group_index: String(j + 1),
                    variant_index: '1',
                }));
            });
        });

        // --- answer lesson: per topic, reuse rows + branch row + option takes ---
        let ansTakeNo = 0;
        let ansFirstVideo = '';
        topics.forEach((topic, k) => {
            const topicNo = k + 1;
            const askVideo = `${course}-${askId}-${pad2(topicNo)}`;

            // reuse rows: the ask phrases again, no takes, republished home
            phrasesOf(topic, pair, topicNo, 'question').forEach((phrase, j) => {
                push(cell({
                    lesson_id: ansId,
                    lesson_title: pair.answer.title || '',
                    response_type: 'friendClosedResponse',
                    video_file: askVideo,
                    order: String(j + 1),
                    phrase,
                    publish_lesson_id: askId,
                    recap_sources: 'friend',
                    recap_overlay: 'shareCta',
                    pair_index: pairNo,
                    set_role: 'question',
                    topic_index: String(topicNo),
                    group_index: String(j + 1),
                    variant_index: '1',
                }));
            });

            // branching row: friend ref key, choices, positional targets
            const choices = topic?.choices;
            const answers = topic?.answers;
            if (!Array.isArray(choices) || choices.length === 0) {
                throw new Error(`pair ${askId}-${ansId} topic ${topicNo}: missing "choices"`);
            }
            if (!Array.isArray(answers) || answers.length !== choices.length) {
                const got = Array.isArray(answers) ? answers.length : 'no';
                throw new Error(
                    `pair ${askId}-${ansId} topic ${topicNo}: ${choices.length} choice(s) but ${got} answer group(s)`
                );
            }
            const friendVideo = `{friendCode}{selfCode}-${course}-${askId}-${pad2(topicNo)}`;
            if (k === 0) ansFirstVideo = friendVideo;
            const branchRow = (lessonId, lessonTitle) => cell({
                lesson_id: lessonId,
                lesson_title: lessonTitle,
                response_type: 'branching',
                video_file: friendVideo,
                order: '1',
                choose_step_next: choices.map((_, i) => String(i + 1)).join('\n'),
                choose_step_text: choices.join('\n'),
                recap_sources: 'friend',
                recap_overlay: 'shareCta',
                pair_index: pairNo,
                set_role: 'answer',
                topic_index: String(topicNo),
                group_index: '0',
                variant_index: '0',
            });
            push(branchRow(ansId, pair.answer.title || ''));
            // The chain's closing lesson is a SECOND answer lesson of this
            // pair: it plays the same friend clips and the same answer takes
            // (those are per-pair assets, so it needs no take rows and no new
            // render) and closes with the code-owned goodbye block instead of
            // recording another question set. It carries its own branch rows
            // so the generator can read its title and framing.
            if (closingId) push(branchRow(closingId, pair.closing.title || ''));

            // option takes: each group advances past its own group (offset k-m)
            answers.forEach((group, m) => {
                if (!Array.isArray(group) || group.length === 0) {
                    throw new Error(`pair ${askId}-${ansId} topic ${topicNo} answer ${m + 1}: missing phrases`);
                }
                ansTakeNo += 1;
                const video = `${course}-${ansId}-${pad2(ansTakeNo)}`;
                group.forEach((phrase, j) => {
                    push(cell({
                        lesson_id: ansId,
                        lesson_title: pair.answer.title || '',
                        response_type: 'friendClosedResponse',
                        video_file: video,
                        filename: `${video}-${pad2(j + 1)}`,
                        order: String(j + 1),
                        character: DEFAULT_CHARACTER,
                        phrase,
                        subtitle_text: overlayFor(group, rungs, j, `${ansId} topic ${topicNo} answer ${m + 1}`),
                        next_step: String(answers.length - m),
                        recap_sources: 'friend',
                        recap_overlay: 'shareCta',
                        pair_index: pairNo,
                        set_role: 'answer',
                        topic_index: String(topicNo),
                        group_index: String(m + 1),
                        variant_index: String(j + 1),
                    }));
                });
            });
        });

        // The old generator synthesizes the lessonIntro opener from intro_video;
        // point it at each lesson's first video (the new design has no intro key).
        for (const row of pairRows) {
            row.intro_video = row.lesson_id === askId ? askFirstVideo : ansFirstVideo;
        }
    }
    return rows;
}

/** Phrases accessor with a structured error (keeps sourceToRows readable). */
function phrasesOf(topic, pair, topicNo, field) {
    const list = topic?.[field];
    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`pair ${pair?.ask?.id}-${pair?.answer?.id} topic ${topicNo}: missing "${field}" phrases`);
    }
    return list;
}
