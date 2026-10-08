#!/usr/bin/env node
// Writes docs/video-pipeline/sample-sheet.csv with correct RFC-4180 quoting, so
// multi-line cells (cue_alt, srt) stay in one field. Run:
//   node scripts/write-sample-sheet.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/video-pipeline/sample-sheet.csv');

const HEADER = [
    'course_id', 'course_name', 'lesson_id', 'lesson_title', 'unit', 'mission',
    'response_type', 'video_file', 'filename', 'order', 'cue', 'cue_alt',
    'next_step', 'choose_step_next', 'choose_step_text',
    'subtitle_text', 'srt', 'recap_sources', 'recap_overlay',
    // Story 049 localization targets (one column per language per field). Blank
    // in the sample: a fresh import shows the operator where translations land,
    // and `translate-sheet.mjs` fills them.
    'lesson_title_es', 'lesson_title_pt', 'lesson_title_bn',
    'mission_es', 'mission_pt', 'mission_bn',
    'cue_es', 'cue_pt', 'cue_bn',
    'cue_alt_es', 'cue_alt_pt', 'cue_alt_bn',
    'choose_step_text_es', 'choose_step_text_pt', 'choose_step_text_bn',
    'subtitle_text_es', 'subtitle_text_pt', 'subtitle_text_bn',
    // SRT cue-text translations (timings preserved); blank so the translator
    // fills them and the app localizes captions.
    'srt_es', 'srt_pt', 'srt_bn',
];

const MISSION = 'Ask and answer with WOULD YOU RATHER.';
const SRT_INTRO = '1\n00:00:00,000 --> 00:00:04,040\nWelcome. Let us begin.\n\n2\n00:00:04,040 --> 00:00:09,080\nRepeat after me.';
const SRT_END = '1\n00:00:00,000 --> 00:00:06,180\nGreat, you are almost done.\n\n2\n00:00:06,180 --> 00:00:11,300\nNow create and share your video.';

// Every lesson-level field (unit, mission, recap_*) is identical on all rows of
// a lesson; a video_file is exactly one step, so its rows share response_type.
const rows = [
    // Lesson intro (course-wide lesson): a lessonIntro step + a viewAndContinue step.
    { lesson_id: 'intro', lesson_title: 'Lesson Intro', unit: 'Getting Started', response_type: 'lessonIntro', video_file: 'demo-intro', filename: 'demo-intro01', order: '1' },
    { lesson_id: 'intro', lesson_title: 'Lesson Intro', unit: 'Getting Started', response_type: 'viewAndContinue', video_file: 'demo-intro-instructions', filename: 'demo-intro02', order: '2', srt: SRT_INTRO },

    // Lesson A: three friend questions, a branching question with two
    // alternatives that converge on the success step, then success.
    { lesson_id: 'a', lesson_title: 'Lesson A', unit: 'Asking', recap_sources: 'none', response_type: 'friendClosedResponse', video_file: 'demo-a01', filename: 'demo-a0101', order: '1', cue: 'Would you rather have a million dollars or live five years longer?' },
    { lesson_id: 'a', lesson_title: 'Lesson A', unit: 'Asking', recap_sources: 'none', response_type: 'friendClosedResponse', video_file: 'demo-a02', filename: 'demo-a0201', order: '2', cue: 'Would you rather have great food or great conversation?' },
    { lesson_id: 'a', lesson_title: 'Lesson A', unit: 'Asking', recap_sources: 'none', response_type: 'friendClosedResponse', video_file: 'demo-a03', filename: 'demo-a0301', order: '3', cue_alt: 'Would you rather a beach vacation?\nWould you rather a mountain vacation?' },
    // Branching: each choice jumps to one of the two alternative steps; both
    // alternatives carry `next_step` so they converge on `demo-enda` (the choice
    // offsets 1/2 land on the two alternatives, each then advances by 2/1).
    { lesson_id: 'a', lesson_title: 'Lesson A', unit: 'Asking', recap_sources: 'none', response_type: 'branching', video_file: 'demo-branch', filename: 'demo-branch01', order: '4', cue: 'Which would you rather?', choose_step_next: '1\n2', choose_step_text: 'Go to the beach\nGo to the mountains' },
    { lesson_id: 'a', lesson_title: 'Lesson A', unit: 'Asking', recap_sources: 'none', response_type: 'viewAndContinue', video_file: 'demo-branch-beach', filename: 'demo-branch-beach01', order: '5', next_step: '2', subtitle_text: 'The beach it is.' },
    { lesson_id: 'a', lesson_title: 'Lesson A', unit: 'Asking', recap_sources: 'none', response_type: 'viewAndContinue', video_file: 'demo-branch-mountain', filename: 'demo-branch-mountain01', order: '6', next_step: '1', subtitle_text: 'The mountains it is.' },
    { lesson_id: 'a', lesson_title: 'Lesson A', unit: 'Asking', recap_sources: 'none', response_type: 'success', video_file: 'demo-enda', filename: 'demo-enda01', order: '7', srt: SRT_END },

    // Lesson B: a friend recap lesson (friend-slug steps live here).
    { lesson_id: 'b', lesson_title: 'Lesson B', unit: 'Responding', recap_sources: 'friend', response_type: 'lessonIntro', video_file: 'demo-b-intro', filename: 'demo-b-intro01', order: '1' },
    { lesson_id: 'b', lesson_title: 'Lesson B', unit: 'Responding', recap_sources: 'friend', response_type: 'viewAndContinue', video_file: 'demo-b-resp', filename: 'demo-b-resp01', order: '2', srt: SRT_INTRO },
    { lesson_id: 'b', lesson_title: 'Lesson B', unit: 'Responding', recap_sources: 'friend', response_type: 'friendClosedResponse', video_file: 'demo-b01', filename: 'demo-b0101', order: '3', cue: 'I would rather live five years longer.' },
    { lesson_id: 'b', lesson_title: 'Lesson B', unit: 'Responding', recap_sources: 'friend', response_type: 'success', video_file: 'demo-enda-b', filename: 'demo-enda02', order: '4', srt: SRT_END },
];

function csvField(value) {
    const s = value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const lines = [HEADER.join(',')];
for (const r of rows) {
    const full = {
        course_id: 'demo', course_name: 'Demo Course', mission: MISSION,
        recap_overlay: 'shareCta', ...r,
    };
    lines.push(HEADER.map((c) => csvField(full[c])).join(','));
}

await fs.writeFile(OUT, lines.join('\n') + '\n');
console.log(`WROTE ${OUT} (${rows.length} rows)`);
