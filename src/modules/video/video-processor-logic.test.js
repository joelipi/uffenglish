import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { VideoRenderPlanner, resolveRecapOverlay, resolveRecapSources, isDroppedStep, markFirstRenderable, resolveSegmentBounds, UNRESOLVED_SEGMENT_CAP_MS, STALL_GRACE_MS, resolvePublishLessonId, assignSegmentTargets, buildUgcSegmentKey, isPublishableClip, calibrateSegmentRanges, resolveHeaderLayout, HEADER_BAND_RATIO, HEADER_TOP_MARGIN_RATIO, MIN_SEGMENT_SECONDS, MAX_CALIBRATION_OFFSET_SEC } from './video-processor-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const LOGIC_PATH = path.join(__dirname, 'video-processor-logic.js');

const SYSTEM_STEPS = [
    { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
    { responseType: 'closedResponse', interactiveVideoUrl: 'testvideo02', cue: 'Q1' },
    { responseType: 'closedResponse', interactiveVideoUrl: 'testvideo03', cue: 'Q2' },
    { responseType: 'closedResponse', interactiveVideoUrl: 'testvideo04', cue: 'Q3' },
];

const FRIEND_STEPS = [
    { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
    { responseType: 'friendClosedResponse', interactiveVideoUrl: 'ab12-model-w-response-01', cue: 'Q1' },
    { responseType: 'friendClosedResponse', interactiveVideoUrl: 'ab12-model-w-response-02', cue: 'Q2' },
    { responseType: 'friendClosedResponse', interactiveVideoUrl: 'ab12-model-w-response-03', cue: 'Q3' },
];

function makeConfig({ recapSources, recapOverlay, webcamOnly = false, steps = SYSTEM_STEPS } = {}) {
    return {
        lessons: [
            {
                lessonId: 'w',
                ...(recapSources ? { recapSources } : {}),
                ...(recapOverlay ? { recapOverlay } : {}),
                ...(webcamOnly ? { webcamOnly: true } : {}),
                steps,
            },
        ],
    };
}

function makeRecordings(count = 3) {
    return Array.from({ length: count }, (_, i) => ({
        originalLessonId: 'w',
        originalStepIndex: i + 1,
        blob: { size: 100 },
        userResponse: `answer ${i + 1}`,
    }));
}

// Named step builders for the response-subtitle rules. Each carries an explicit
// `responseType` so the planner's classification is unambiguous (reusing
// SYSTEM_STEPS would hide the type under generic steps).
function closedResponseStep(cue) {
    return { responseType: 'closedResponse', interactiveVideoUrl: 'testvideo02', cue };
}

function friendClosedResponseStep(cue) {
    return { responseType: 'friendClosedResponse', interactiveVideoUrl: 'testvideo02', cue };
}

function openResponseStep(cue) {
    return { responseType: 'openResponse', interactiveVideoUrl: 'testvideo02', cue };
}

// A single-recording plan whose recorded step is `step` at the recording's
// originalStepIndex 0. `configData` overrides the default single-step lesson.
function planForStep(step, rec = {}, { userLang = 'en', configData } = {}) {
    const recordings = [{
        originalLessonId: 'w',
        originalStepIndex: 0,
        blob: { size: 1 },
        ...rec,
    }];
    const config = configData ?? { lessons: [{ lessonId: 'w', steps: [step] }] };
    return new VideoRenderPlanner(recordings, config, { total: 80 }, userLang, 'ab12').generatePlan();
}

function webcamSubtitle(step, rec = {}, opts) {
    return planForStep(step, rec, opts).find(s => s.type === 'webcam').subtitle;
}

describe('resolveRecapSources', () => {
    it('passes through valid values', () => {
        expect(resolveRecapSources({ recapSources: 'system' })).toBe('system');
        expect(resolveRecapSources({ recapSources: 'friend' })).toBe('friend');
        expect(resolveRecapSources({ recapSources: 'none' })).toBe('none');
    });

    it('defaults to system for absent, empty, or unrecognized values', () => {
        expect(resolveRecapSources({})).toBe('system');
        expect(resolveRecapSources(null)).toBe('system');
        expect(resolveRecapSources(undefined)).toBe('system');
        expect(resolveRecapSources({ recapSources: 'bogus' })).toBe('system');
        expect(resolveRecapSources({ recapSources: '' })).toBe('system');
        expect(resolveRecapSources({ recapSources: true })).toBe('system');
    });
});

describe('resolveRecapOverlay', () => {
    it('passes through valid values', () => {
        expect(resolveRecapOverlay({ recapOverlay: 'fluency' })).toBe('fluency');
        expect(resolveRecapOverlay({ recapOverlay: 'shareCta' })).toBe('shareCta');
        expect(resolveRecapOverlay({ recapOverlay: 'none' })).toBe('none');
    });

    it('defaults to fluency for absent, empty, or unrecognized values', () => {
        expect(resolveRecapOverlay({})).toBe('fluency');
        expect(resolveRecapOverlay(null)).toBe('fluency');
        expect(resolveRecapOverlay(undefined)).toBe('fluency');
        expect(resolveRecapOverlay({ recapOverlay: 'bogus' })).toBe('fluency');
        expect(resolveRecapOverlay({ recapOverlay: '' })).toBe('fluency');
        expect(resolveRecapOverlay({ recapOverlay: true })).toBe('fluency');
    });
});

describe('VideoRenderPlanner.generatePlan — recapSources clip selection', () => {
    it('interleaves system prompts when recapSources is system (default)', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ recapSources: 'system' }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.map(s => s.type)).toEqual([
            'remote', 'webcam', 'remote', 'webcam', 'remote', 'webcam', 'tailing',
        ]);
        expect(plan.filter(s => s.type === 'remote').map(s => s.targetId)).toEqual([
            'testvideo02', 'testvideo03', 'testvideo04',
        ]);
    });

    it('interleaves only friend prompts when recapSources is friend', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ recapSources: 'friend', steps: FRIEND_STEPS }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.map(s => s.type)).toEqual([
            'remote', 'webcam', 'remote', 'webcam', 'remote', 'webcam', 'tailing',
        ]);
        const remotes = plan.filter(s => s.type === 'remote').map(s => s.targetId);
        expect(remotes).toEqual([
            'ab12-model-w-response-01',
            'ab12-model-w-response-02',
            'ab12-model-w-response-03',
        ]);
    });

    it('drops system prompts in a friend lesson (mixed steps)', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'friendClosedResponse', interactiveVideoUrl: 'ab12-model-w-response-01', cue: 'Q1' },
            { responseType: 'closedResponse', interactiveVideoUrl: 'testvideo02', cue: 'Q2' },
        ];
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'a' },
            { originalLessonId: 'w', originalStepIndex: 2, blob: { size: 1 }, userResponse: 'b' },
        ];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        const remotes = plan.filter(s => s.type === 'remote');
        expect(remotes).toHaveLength(1);
        expect(remotes[0].targetId).toBe('ab12-model-w-response-01');
        expect(plan.map(s => s.type)).toEqual(['remote', 'webcam', 'webcam', 'tailing']);
    });

    it('emits zero remote steps when recapSources is none', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ recapSources: 'none' }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.filter(s => s.type === 'remote')).toHaveLength(0);
        expect(plan.map(s => s.type)).toEqual(['webcam', 'webcam', 'webcam', 'tailing']);
    });

    it('concatenates friend prompts regardless of other lesson flags', () => {
        // A stale webcamOnly flag must not suppress friend prompts.
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ recapSources: 'friend', webcamOnly: true, steps: FRIEND_STEPS }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.filter(s => s.type === 'remote')).toHaveLength(3);
        expect(plan.filter(s => s.type === 'remote').map(s => s.targetId)).toEqual([
            'ab12-model-w-response-01',
            'ab12-model-w-response-02',
            'ab12-model-w-response-03',
        ]);
    });

    it('dedupes the friend prompt for a retry pair', () => {
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'a' },
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'b' },
        ];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps: FRIEND_STEPS }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.filter(s => s.type === 'remote')).toHaveLength(1);
        expect(plan.map(s => s.type)).toEqual(['remote', 'webcam', 'webcam', 'tailing']);
    });

    it('falls back to a fluency tailing step when there are no recordings', () => {
        const planner = new VideoRenderPlanner(
            [], makeConfig({ recapSources: 'friend', steps: FRIEND_STEPS }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan).toHaveLength(1);
        expect(plan[0].type).toBe('tailing');
        expect(plan[0].variant).toBe('fluency');
    });

    it('borrows the preceding click-through friend clip for a system response step', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' },
        ];
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 2, blob: { size: 1 }, userResponse: 'a' },
        ];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.map(s => s.type)).toEqual(['remote', 'webcam', 'tailing']);
        const remote = plan.find(s => s.type === 'remote');
        expect(remote.targetId).toBe('ab12-model-w-response-01');
        // The friend clip already carries its own burned-in caption, so the
        // recap draws no subtitle over it (not the response step's cue).
        expect(remote.subtitle).toBeNull();
    });

    it('borrows the branching step’s friend clip for either alternative response step', () => {
        // A `branching` step plays the friend's question, then jumps to one of
        // two alternative response steps. Both answer the SAME question, so the
        // friend clip must lead the recap whichever one the learner picks —
        // including the second, whose sibling response step sits immediately
        // before it (the case that used to drop the friend's half).
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            {
                responseType: 'branching',
                simpleVideoUrl: 'ab12-model-w-response-01',
                chooseStep: [
                    { nextStep: 1, text: { en: 'A' } },
                    { nextStep: 2, text: { en: 'B' } },
                ],
            },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1a' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo06', cue: 'Q1b' },
        ];
        for (const chosenStep of [2, 3]) {
            const recordings = [
                { originalLessonId: 'w', originalStepIndex: chosenStep, blob: { size: 1 }, userResponse: 'a' },
            ];
            const plan = new VideoRenderPlanner(
                recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
            ).generatePlan();

            expect(plan.map(s => s.type), `branch target ${chosenStep}`).toEqual(['remote', 'webcam', 'tailing']);
            expect(plan.find(s => s.type === 'remote').targetId).toBe('ab12-model-w-response-01');
        }
    });

    it('does not borrow a friend clip for a response that starts a new phase', () => {
        // No branching step here: the second recording follows the first
        // question's response sequentially (the "record the original" phase), so
        // the scan-back must still stop at that response boundary rather than
        // reusing the previous question's friend clip.
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo06', cue: 'repeat the original' },
        ];
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 3, blob: { size: 1 }, userResponse: 'a' },
        ];
        const plan = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        ).generatePlan();

        expect(plan.map(s => s.type)).toEqual(['webcam', 'tailing']);
    });

    it('pairs each click-through friend clip with its own response question', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-02' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo06', cue: 'Q2' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-03' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo07', cue: 'Q3' },
        ];
        const recordings = [2, 4, 6].map(i => ({
            originalLessonId: 'w', originalStepIndex: i, blob: { size: 1 }, userResponse: `a${i}`,
        }));
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.map(s => s.type)).toEqual([
            'remote', 'webcam', 'remote', 'webcam', 'remote', 'webcam', 'tailing',
        ]);
        expect(plan.filter(s => s.type === 'remote').map(s => s.targetId)).toEqual([
            'ab12-model-w-response-01',
            'ab12-model-w-response-02',
            'ab12-model-w-response-03',
        ]);
    });

    it('keeps the recorded step’s own friend clip when it already has one', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'ab12-model-w-response-09', cue: 'Q1' },
        ];
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'a' },
        ];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        );
        const remote = planner.generatePlan().find(s => s.type === 'remote');

        expect(remote.targetId).toBe('ab12-model-w-response-09');
    });

    it('does not borrow a friend clip in a system lesson', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' },
        ];
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 2, blob: { size: 1 }, userResponse: 'a' },
        ];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'system', steps }), { total: 80 }, 'en', 'ab12'
        );
        const remote = planner.generatePlan().find(s => s.type === 'remote');

        expect(remote.targetId).toBe('testvideo05');
    });

    it('emits no remote step in a none lesson with a friend clip present', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' },
        ];
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 2, blob: { size: 1 }, userResponse: 'a' },
        ];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'none', steps }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.filter(s => s.type === 'remote')).toHaveLength(0);
    });

    it('finds no fallback when no friend clip precedes the response step', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' },
        ];
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'a' },
        ];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.filter(s => s.type === 'remote')).toHaveLength(0);
    });

    it('stops the fallback scan at a response-step boundary', () => {
        const steps = [
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo06', cue: 'Q2' },
        ];
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'a' },
            { originalLessonId: 'w', originalStepIndex: 2, blob: { size: 1 }, userResponse: 'b' },
        ];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        );
        const remotes = planner.generatePlan().filter(s => s.type === 'remote');

        // Only the index-1 recording borrows friend-01; the index-2 recording
        // must not reuse it across the response boundary.
        expect(remotes).toHaveLength(1);
        expect(remotes[0].targetId).toBe('ab12-model-w-response-01');
    });

    it('borrows the friend clip once for a retry pair at the same response step', () => {
        const steps = [
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' },
        ];
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'a' },
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'b' },
        ];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.filter(s => s.type === 'remote')).toHaveLength(1);
        expect(plan.map(s => s.type)).toEqual(['remote', 'webcam', 'webcam', 'tailing']);
    });
});

describe('VideoRenderPlanner.generatePlan — friend remote subtitle', () => {
    // A friend (UGC) clip is published per-segment with its own speaker's cue
    // burned in, so the recap must not draw the response step's cue over it.
    it('draws no subtitle over a recorded step’s own friend clip', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'ab12-model-w-response-09', cue: 'Q1' },
        ];
        const recordings = [{
            originalLessonId: 'w',
            originalStepIndex: 1,
            blob: { size: 1 },
            matchedCue: 'I would rather have a million dollars.',
            userResponse: 'i would rather have a million dollars',
        }];
        const plan = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        ).generatePlan();

        const remote = plan.find(s => s.type === 'remote');
        expect(remote.targetId).toBe('ab12-model-w-response-09');
        expect(remote.subtitle).toBeNull();
        // The webcam (current user) rule is unchanged.
        expect(plan.find(s => s.type === 'webcam').subtitle.en).toBe('I would rather have a million dollars.');
    });

    it('draws no subtitle over a borrowed click-through friend clip', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' },
        ];
        const recordings = [{
            originalLessonId: 'w',
            originalStepIndex: 2,
            blob: { size: 1 },
            matchedCue: 'Q1 matched',
            userResponse: 'q1 matched',
        }];
        const plan = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        ).generatePlan();

        const remote = plan.find(s => s.type === 'remote');
        expect(remote.targetId).toBe('ab12-model-w-response-01');
        expect(remote.subtitle).toBeNull();
        expect(plan.find(s => s.type === 'webcam').subtitle.en).toBe('Q1 matched');
    });

    it('does not fall back to the configured cue when the friend clip has no match', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'ab12-model-w-response-09', cue: 'Q1' },
        ];
        const recordings = [{
            originalLessonId: 'w',
            originalStepIndex: 1,
            blob: { size: 1 },
            userResponse: 'answer 1',
        }];
        const remote = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        ).generatePlan().find(s => s.type === 'remote');

        expect(remote.subtitle).toBeNull();
    });

    it('draws no subtitle over any of three interleaved friend clips', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-02' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo06', cue: 'Q2' },
            { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-03' },
            { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo07', cue: 'Q3' },
        ];
        const recordings = [2, 4, 6].map((i) => ({
            originalLessonId: 'w',
            originalStepIndex: i,
            blob: { size: 1 },
            matchedCue: `Q${i / 2}`,
            userResponse: `a${i}`,
        }));
        const plan = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'friend', steps }), { total: 80 }, 'en', 'ab12'
        ).generatePlan();

        expect(plan.map(s => s.type)).toEqual([
            'remote', 'webcam', 'remote', 'webcam', 'remote', 'webcam', 'tailing',
        ]);
        const remotes = plan.filter(s => s.type === 'remote');
        expect(remotes.map(s => s.targetId)).toEqual([
            'ab12-model-w-response-01',
            'ab12-model-w-response-02',
            'ab12-model-w-response-03',
        ]);
        for (const remote of remotes) expect(remote.subtitle).toBeNull();
    });

    it('keeps the cue subtitle on a system prompt remote', () => {
        const steps = [
            { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
            { responseType: 'closedResponse', interactiveVideoUrl: 'testvideo02', cue: 'Q1' },
        ];
        const recordings = [{
            originalLessonId: 'w',
            originalStepIndex: 1,
            blob: { size: 1 },
            userResponse: 'answer 1',
        }];
        const remote = new VideoRenderPlanner(
            recordings, makeConfig({ recapSources: 'system', steps }), { total: 80 }, 'en', 'ab12'
        ).generatePlan().find(s => s.type === 'remote');

        expect(remote.subtitle.en).toBe('Q1');
    });
});

describe('VideoRenderPlanner.generatePlan — recapOverlay tailing variant', () => {
    it('tags the tailing step as shareCta with duration, fluencyData and shareCode', () => {
        const fluencyData = { total: 80 };
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ recapOverlay: 'shareCta' }), fluencyData, 'en', 'ab12'
        );
        const tailing = planner.generatePlan().find(s => s.type === 'tailing');

        expect(tailing.variant).toBe('shareCta');
        expect(tailing.durationMs).toBe(2000);
        expect(tailing.fluencyData).toBe(fluencyData);
        expect(tailing.shareCode).toBe('ab12');
    });

    it('tags the tailing step as none when recapOverlay is none', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ recapOverlay: 'none' }), { total: 80 }, 'en', 'ab12'
        );
        const tailing = planner.generatePlan().find(s => s.type === 'tailing');

        expect(tailing.variant).toBe('none');
    });

    it('tags the tailing step as fluency when recapOverlay is absent', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig(), { total: 80 }, 'en', 'ab12'
        );
        const tailing = planner.generatePlan().find(s => s.type === 'tailing');

        expect(tailing.variant).toBe('fluency');
    });

    it('does not derive the overlay from webcamOnly', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ webcamOnly: true }), { total: 80 }, 'en', 'ab12'
        );
        const tailing = planner.generatePlan().find(s => s.type === 'tailing');

        expect(tailing.variant).toBe('fluency');
    });

    it('defaults shareCode to null when the constructor is called with 4 args', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ recapOverlay: 'shareCta' }), { total: 80 }, 'en'
        );
        const tailing = planner.generatePlan().find(s => s.type === 'tailing');

        expect(tailing.shareCode).toBeNull();
    });
});

describe('isDroppedStep / markFirstRenderable', () => {
    it('treats only failed remote prompts as dropped', () => {
        expect(isDroppedStep({ type: 'remote', remoteFailed: true })).toBe(true);
        expect(isDroppedStep({ type: 'remote', loadFailed: true })).toBe(true);
        expect(isDroppedStep({ type: 'remote' })).toBe(false);
        expect(isDroppedStep({ type: 'webcam', remoteFailed: true })).toBe(false);
        expect(isDroppedStep({ type: 'tailing', remoteFailed: true })).toBe(false);
        expect(isDroppedStep(null)).toBe(false);
        expect(isDroppedStep(undefined)).toBe(false);
    });

    it('marks the first renderable step, skipping dropped remotes and the tail', () => {
        const plan = [
            { type: 'remote', remoteFailed: true },
            { type: 'webcam', isFirst: false },
            { type: 'tailing' },
        ];
        expect(markFirstRenderable(plan, 0)).toBe(1);
        expect(plan[1].isFirst).toBe(true);
    });

    it('marks the first step when nothing is dropped', () => {
        const plan = [{ type: 'remote' }, { type: 'webcam' }, { type: 'tailing' }];
        expect(markFirstRenderable(plan, 0)).toBe(0);
        expect(plan[0].isFirst).toBe(true);
    });

    it('returns -1 when every renderable step is dropped or only the tail remains', () => {
        expect(markFirstRenderable([{ type: 'tailing' }], 0)).toBe(-1);
        expect(markFirstRenderable([
            { type: 'remote', remoteFailed: true },
            { type: 'remote', loadFailed: true },
            { type: 'tailing' },
        ], 0)).toBe(-1);
    });

    it('honours fromIndex when passing "first" past a failed opening step', () => {
        const plan = [{ type: 'webcam', isFirst: true }, { type: 'remote', remoteFailed: true }, { type: 'webcam' }, { type: 'tailing' }];
        expect(markFirstRenderable(plan, 2)).toBe(2);
        expect(plan[2].isFirst).toBe(true);
        // The helper clears any previous "first" so only one step carries it.
        expect(plan[0].isFirst).toBe(false);
    });
});

describe('VideoRenderPlanner.generatePlan — UGC poster thumb carry-through', () => {
    it('carries rec.thumbBlob into the webcam step', () => {
        const thumb = { size: 42, type: 'image/jpeg' };
        const recordings = [{
            originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 },
            userResponse: 'a', thumbBlob: thumb,
        }];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig(), { total: 80 }, 'en', 'ab12'
        );
        const webcam = planner.generatePlan().find(s => s.type === 'webcam');

        expect(webcam.thumbBlob).toBe(thumb);
        // Storage never surfaces the raw ArrayBuffer to the planner; restored
        // records carry a Blob (storage.web.js).
        expect(webcam).not.toHaveProperty('thumbArrayBuffer');
    });

    it('defaults thumbBlob to null when there is no thumb', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(1), makeConfig(), { total: 80 }, 'en', 'ab12'
        );
        const webcam = planner.generatePlan().find(s => s.type === 'webcam');

        expect(webcam.thumbBlob).toBeNull();
        expect(webcam).not.toHaveProperty('thumbArrayBuffer');
    });
});

describe('resolveSegmentBounds', () => {
    it('prefers an explicit trim end', () => {
        expect(resolveSegmentBounds({ trimEnd: 4, rawDuration: 10, start: 1 }))
            .toEqual({ endTime: 4, wallClockCapMs: 3000 });
    });

    it('treats a falsy trim end as absent (preserves step.trim?.end || ...)', () => {
        expect(resolveSegmentBounds({ trimEnd: 0, rawDuration: 12, start: 0 }))
            .toEqual({ endTime: 12, wallClockCapMs: 12000 });
    });

    it('uses the element media duration and subtracts the start offset', () => {
        expect(resolveSegmentBounds({ rawDuration: 12, start: 2 }))
            .toEqual({ endTime: 12, wallClockCapMs: 10000 });
    });

    it('falls back to the probed container duration when the element duration is non-finite', () => {
        expect(resolveSegmentBounds({ rawDuration: Infinity, fallbackDurationSec: 8 }))
            .toEqual({ endTime: 8, wallClockCapMs: 8000 });
        expect(resolveSegmentBounds({ rawDuration: Infinity, fallbackDurationSec: 8, start: 3 }))
            .toEqual({ endTime: 8, wallClockCapMs: 5000 });
    });

    it('returns an Infinity end and the anti-freeze cap when nothing resolves', () => {
        const unresolved = { endTime: Infinity, wallClockCapMs: UNRESOLVED_SEGMENT_CAP_MS };
        expect(resolveSegmentBounds({ rawDuration: NaN, fallbackDurationSec: null })).toEqual(unresolved);
        expect(resolveSegmentBounds({ rawDuration: undefined })).toEqual(unresolved);
        expect(resolveSegmentBounds()).toEqual(unresolved);
    });

    it('ignores a non-positive probe result', () => {
        expect(resolveSegmentBounds({ rawDuration: Infinity, fallbackDurationSec: 0 }))
            .toEqual({ endTime: Infinity, wallClockCapMs: UNRESOLVED_SEGMENT_CAP_MS });
    });

    it('defaults a non-finite start to 0', () => {
        expect(resolveSegmentBounds({ rawDuration: 8, start: NaN }))
            .toEqual({ endTime: 8, wallClockCapMs: 8000 });
    });
});

describe('resolvePublishLessonId', () => {
    it('uses a step publishLessonId when set', () => {
        expect(resolvePublishLessonId({ publishLessonId: 'a' }, 'b')).toBe('a');
    });

    it('falls back to the default lesson for absent/empty/non-object', () => {
        expect(resolvePublishLessonId({}, 'b')).toBe('b');
        expect(resolvePublishLessonId(null, 'b')).toBe('b');
        expect(resolvePublishLessonId(undefined, 'b')).toBe('b');
        expect(resolvePublishLessonId({ publishLessonId: '' }, 'b')).toBe('b');
        expect(resolvePublishLessonId({ publishLessonId: null }, 'b')).toBe('b');
    });
});

describe('assignSegmentTargets', () => {
    it('numbers per target lesson, restarting for each target', () => {
        expect(assignSegmentTargets([{}, { publishLessonId: 'a' }, { publishLessonId: 'a' }], 'b'))
            .toEqual([
                { lessonId: 'b', index: 1 },
                { lessonId: 'a', index: 1 },
                { lessonId: 'a', index: 2 },
            ]);
    });

    it('restarts the default lesson numbering when interleaved', () => {
        expect(assignSegmentTargets([{ publishLessonId: 'a' }, { publishLessonId: 'a' }, {}], 'b'))
            .toEqual([
                { lessonId: 'a', index: 1 },
                { lessonId: 'a', index: 2 },
                { lessonId: 'b', index: 1 },
            ]);
    });

    it('handles empty / missing input', () => {
        expect(assignSegmentTargets([], 'b')).toEqual([]);
        expect(assignSegmentTargets(null, 'b')).toEqual([]);
        expect(assignSegmentTargets(undefined, 'b')).toEqual([]);
    });

    it('keeps counting past 9', () => {
        const steps = Array.from({ length: 12 }, () => ({}));
        const targets = assignSegmentTargets(steps, 'b');
        expect(targets[9]).toEqual({ lessonId: 'b', index: 10 });
        expect(targets[11]).toEqual({ lessonId: 'b', index: 12 });
    });
});

describe('buildUgcSegmentKey', () => {
    it('builds the videos/ key with a 2-digit index', () => {
        expect(buildUgcSegmentKey({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a', index: 1 }))
            .toBe('videos/ab12-friend-a-response-01.mp4');
    });

    it('does not truncate indices above 9', () => {
        expect(buildUgcSegmentKey({ shareCode: 'ab12', courseId: 'model', lessonId: 'b', index: 12 }))
            .toBe('videos/ab12-model-b-response-12.mp4');
    });
});

describe('isPublishableClip', () => {
    it('accepts a webcam step with a blob that is not text-mode', () => {
        expect(isPublishableClip({ type: 'webcam', blob: { size: 1 } })).toBe(true);
    });

    it('rejects text-mode, blobless, remote and tailing steps', () => {
        expect(isPublishableClip({ type: 'webcam', blob: { size: 1 }, isTextMode: true })).toBe(false);
        expect(isPublishableClip({ type: 'webcam', blob: null })).toBe(false);
        expect(isPublishableClip({ type: 'webcam', blob: undefined })).toBe(false);
        expect(isPublishableClip({ type: 'remote', blob: { size: 1 } })).toBe(false);
        expect(isPublishableClip({ type: 'tailing' })).toBe(false);
    });

    it('rejects null / undefined', () => {
        expect(isPublishableClip(null)).toBe(false);
        expect(isPublishableClip(undefined)).toBe(false);
    });
});

describe('calibrateSegmentRanges', () => {
    const stepA = { type: 'webcam', blob: { size: 1 } };
    const stepB = { type: 'webcam', blob: { size: 1 } };

    it('converts to seconds unchanged when the duration probe is unavailable', () => {
        const raw = [{ step: stepA, startMs: 1000, endMs: 5000 }];
        expect(calibrateSegmentRanges(raw, 12000, null)).toEqual([{ step: stepA, startSec: 1, endSec: 5 }]);
        expect(calibrateSegmentRanges(raw, 12000, 0)).toEqual([{ step: stepA, startSec: 1, endSec: 5 }]);
    });

    it('shifts ranges earlier by the recorder start offset', () => {
        // 12 s elapsed but the recording is only 11.5 s → started 0.5 s late.
        const raw = [{ step: stepA, startMs: 2000, endMs: 6000 }, { step: stepB, startMs: 7000, endMs: 9000 }];
        expect(calibrateSegmentRanges(raw, 12000, 11.5)).toEqual([
            { step: stepA, startSec: 1.5, endSec: 5.5 },
            { step: stepB, startSec: 6.5, endSec: 8.5 },
        ]);
    });

    it('clamps a shifted start to 0 and an end to the probed duration', () => {
        const raw = [{ step: stepA, startMs: 200, endMs: 60000 }];
        expect(calibrateSegmentRanges(raw, 60000, 59.5)).toEqual([
            { step: stepA, startSec: 0, endSec: 59.5 },
        ]);
    });

    it('falls back to raw offsets when the probe is inconsistent', () => {
        // Regression: a MediaRecorder mp4 can report a bogus tiny metadata
        // duration (e.g. 0.115 s for a 4 s recording). Trusting it would shift
        // every range out of bounds and drop all clips.
        expect(MAX_CALIBRATION_OFFSET_SEC).toBeGreaterThan(0);
        const raw = [{ step: stepA, startMs: 2000, endMs: 6000 }];
        expect(calibrateSegmentRanges(raw, 4000, 0.1153)).toEqual([
            { step: stepA, startSec: 2, endSec: 6 },
        ]);
    });

    it('drops sub-floor ranges', () => {
        expect(MIN_SEGMENT_SECONDS).toBeGreaterThan(0);
        const raw = [{ step: stepA, startMs: 1000, endMs: 1100 }];
        expect(calibrateSegmentRanges(raw, 5000, 5)).toEqual([]);
    });

    it('handles empty / malformed input', () => {
        expect(calibrateSegmentRanges(null, 5000, 5)).toEqual([]);
        expect(calibrateSegmentRanges([], 5000, 5)).toEqual([]);
        expect(calibrateSegmentRanges([{ step: stepA, startMs: NaN, endMs: 5 }], 5000, 5)).toEqual([]);
        expect(calibrateSegmentRanges([{ startMs: 0, endMs: 5000 }], 5000, 5)).toEqual([]);
    });
});

describe('VideoRenderPlanner.generatePlan — publishLessonId carry-through', () => {
    function makeConfigWithSteps(steps) {
        return { lessons: [{ lessonId: 'b', recapSources: 'friend', recapOverlay: 'shareCta', steps }] };
    }
    function makeRecs(indexes) {
        return indexes.map((idx) => ({
            originalLessonId: 'b',
            originalStepIndex: idx,
            blob: { size: 100 },
            userResponse: `r${idx}`,
        }));
    }

    it('carries the step publishLessonId onto the webcam plan step', () => {
        const steps = [
            { responseType: 'friendClosedResponse', cue: 'answer' },
            { responseType: 'friendClosedResponse', cue: 'ask', publishLessonId: 'a' },
        ];
        const plan = new VideoRenderPlanner(makeRecs([0, 1]), makeConfigWithSteps(steps)).generatePlan();
        const webcams = plan.filter(s => s.type === 'webcam');
        expect(webcams[0].publishLessonId).toBeNull();
        expect(webcams[1].publishLessonId).toBe('a');
    });

    it('is null when the recording references a missing step', () => {
        const steps = [{ responseType: 'friendClosedResponse', cue: 'only' }];
        const plan = new VideoRenderPlanner(makeRecs([5]), makeConfigWithSteps(steps)).generatePlan();
        expect(plan.find(s => s.type === 'webcam').publishLessonId).toBeNull();
    });

    it('is null when there is no configData', () => {
        const plan = new VideoRenderPlanner(makeRecs([0]), {}, { total: 80 }).generatePlan();
        expect(plan.find(s => s.type === 'webcam').publishLessonId).toBeNull();
    });
});

describe('VideoRenderPlanner.generatePlan — webcam subtitle (matched cue)', () => {
    it('burns the matched cue and its translation, never the transcript', () => {
        const subtitle = webcamSubtitle(closedResponseStep('I like English'), {
            matchedCue: 'I like English',
            userResponse: 'i like inglish',
            translation: 'Me gusta el inglés',
        });

        expect(subtitle.en).toBe('I like English');
        expect(subtitle.translation).toBe('Me gusta el inglés');
        expect(subtitle.en).not.toBe('i like inglish');
    });

    it('burns the matched variant for a template cue, not the raw template', () => {
        const subtitle = webcamSubtitle(
            closedResponseStep({ en: 'I [feeling] English', slots: { feeling: ['love', 'like'] } }),
            { matchedCue: 'I like English' }
        );

        expect(subtitle.en).toBe('I like English');
        expect(subtitle.en).not.toBe('I [feeling] English');
    });

    it('burns the matched variant for an array cue regardless of cue shape', () => {
        const subtitle = webcamSubtitle(
            closedResponseStep(['I love English', 'I like English']),
            { matchedCue: 'I like English' }
        );

        expect(subtitle.en).toBe('I like English');
    });

    it('leaves translation null when the recording has none', () => {
        const subtitle = webcamSubtitle(closedResponseStep('I like English'), {
            matchedCue: 'I like English',
        });

        expect(subtitle.translation).toBeNull();
    });

    it.each([
        {
            label: 'a localized object cue',
            cue: { en: 'I love English', es: 'Amo el inglés' },
            rec: { userResponse: 'i love inglish' },
            opts: { userLang: 'es' },
            forbidden: ['i love inglish', 'I love English', 'Amo el inglés'],
        },
        {
            label: 'a plain-string cue',
            cue: 'Q1',
            rec: { userResponse: 'answer 1' },
            forbidden: ['answer 1', 'Q1'],
        },
        {
            label: 'an array cue',
            cue: ['I love English', 'I like English'],
            rec: { userResponse: 'answer 1' },
            forbidden: ['answer 1', 'I like English'],
        },
        {
            label: 'a template cue',
            cue: { en: 'I [feeling] English', slots: { feeling: ['love'] } },
            rec: { userResponse: 'answer 1' },
            forbidden: ['answer 1', 'I [feeling] English'],
        },
        {
            label: 'an empty-string matchedCue',
            cue: 'Q1',
            rec: { matchedCue: '', userResponse: 'answer 1' },
            forbidden: ['answer 1', 'Q1'],
        },
    ])('burns no subtitle for a closed response with no match ($label)', ({ cue, rec, opts, forbidden }) => {
        const subtitle = webcamSubtitle(closedResponseStep(cue), rec, opts);

        expect(subtitle).toBeNull();
        // Never the transcript and never the configured cue.
        for (const value of forbidden) expect(subtitle).not.toBe(value);
    });

    it('burns no empty-string subtitle object when there is no answer', () => {
        const subtitle = webcamSubtitle(closedResponseStep('Q1'), { userResponse: '' });

        expect(subtitle).toBeNull();
    });

    it('burns the matched cue for a text-mode recording', () => {
        const subtitle = webcamSubtitle(closedResponseStep('Q1'), {
            matchedCue: 'Correct cue',
            isTextMode: true,
            userResponse: 'typed answer',
        });

        expect(subtitle.en).toBe('Correct cue');
    });

    it('applies the cue rule to friendClosedResponse steps too', () => {
        const subtitle = webcamSubtitle(friendClosedResponseStep('Q1'), {
            matchedCue: 'Correct cue',
            userResponse: 'wrong',
        });

        expect(subtitle.en).toBe('Correct cue');
    });

    it('keeps burning the transcript for an open response (no cue to match)', () => {
        const subtitle = webcamSubtitle(openResponseStep('a sample cue'), {
            userResponse: 'my open answer',
        });

        expect(subtitle.en).toBe('my open answer');
    });

    it('keeps the transcript fallback when no step can be resolved (empty configData)', () => {
        const subtitle = webcamSubtitle(undefined, { userResponse: 'answer 1' }, { configData: {} });

        expect(subtitle.en).toBe('answer 1');
    });

    it('keeps the transcript fallback when originalStepIndex has no step', () => {
        const subtitle = webcamSubtitle(closedResponseStep('Q1'), {
            originalStepIndex: 5,
            userResponse: 'answer 1',
        });

        expect(subtitle.en).toBe('answer 1');
    });

    it('leaves the remote prompt subtitle on the existing _getStepCue semantics', () => {
        const plan = planForStep(closedResponseStep('Q1'), { userResponse: 'answer 1' });

        expect(plan.find(s => s.type === 'remote').subtitle.en).toBe('Q1');
        expect(plan.find(s => s.type === 'webcam').subtitle).toBeNull();
    });
});

describe('recap subtitle docs', () => {
    const product = readFileSync(path.join(ROOT, 'docs/product.md'), 'utf8');
    const features = product.slice(product.indexOf('## Features'), product.indexOf('## Non-Goals'));
    const limitations = product.slice(product.indexOf('## Known Limitations'));

    it('links the story and names the matched cue', () => {
        // Assert the section headings first so a renamed heading fails loudly
        // rather than silently shrinking the slices above.
        expect(product).toContain('## Features');
        expect(product).toContain('## Non-Goals');
        expect(product).toContain('## Known Limitations');
        expect(product).toContain('stories/028-burn-cue-not-transcription/story.md');
        expect(product).toContain('matched cue');
    });

    it('states the closed-response rule in a Features bullet', () => {
        expect(features).toMatch(
            /closed-response step is subtitled with the matched cue variant[\s\S]*?no subtitle when none matched[\s\S]*?never the raw speech-to-text transcript/i
        );
    });

    it('states the open-response exception in Known Limitations', () => {
        expect(limitations).toMatch(
            /an open-response answer has no canonical cue to match and still burns the transcript/i
        );
    });

    it('states the friend-clip no-overlay rule in the docs', () => {
        expect(product).toContain('stories/036-fix-friend-lesson-subtitles/story.md');
        expect(features).toContain('Friend clips keep their own caption in the recap');
        expect(features).toContain('gets no subtitle from the recap');
        expect(features).toContain("already carries its own speaker's caption burned in");
        expect(limitations).toContain('no burned-in caption');
        expect(limitations).toContain('shows no subtitle');
        expect(limitations).toContain('never used as a fallback');
    });
});

describe('video-processor-logic.js platform-agnostic guard', () => {
    // Strip comments so prose (e.g. "share window") can't trip the globals check.
    // NOTE: not used for the URL check — this stripper treats the "//" in
    // "https://" as a comment start and would erase the very thing we assert on.
    const stripComments = (src) => src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    it('references no browser globals', () => {
        const code = stripComments(readFileSync(LOGIC_PATH, 'utf8'));

        expect(code).not.toMatch(/\bwindow\b/);
        expect(code).not.toMatch(/\bdocument\b/);
        expect(code).not.toMatch(/\bnavigator\b/);
    });

    it('builds no absolute URL (the share URL is a bare host/path)', () => {
        // Assert against the raw source: a scheme in a string/regex literal is
        // exactly what this guard exists to catch, and comment-stripping would
        // delete it. No comment in this file contains a scheme.
        const source = readFileSync(LOGIC_PATH, 'utf8');

        expect(source).not.toMatch(/https?:\/\//);
    });

    it('resolves the segment end without net speaking time', () => {
        const source = readFileSync(LOGIC_PATH, 'utf8');
        expect(source).toMatch(/export const UNRESOLVED_SEGMENT_CAP_MS = 15000/);
        expect(source).toMatch(/export const STALL_GRACE_MS = 2000/);

        const start = source.indexOf('export function resolveSegmentBounds');
        const body = source.slice(start, source.indexOf('\n}', start));
        // The draw loop must never derive a media length from the recorded
        // net speaking time.
        expect(body).not.toMatch(/step\.duration/);
        expect(body).not.toMatch(/netDuration/);
    });
});

describe('resolveHeaderLayout', () => {
    const HEADER = { naturalWidth: 1600, naturalHeight: 300 };

    it('exports the banner band cap and the top-margin ratio', () => {
        // Literal values (not the constants) so changing either ratio fails here.
        expect(HEADER_BAND_RATIO).toBe(0.18);
        expect(HEADER_TOP_MARGIN_RATIO).toBe(0.08);
    });

    it('no longer exports the dead prompt sizing constants', () => {
        const source = readFileSync(LOGIC_PATH, 'utf8');
        expect(source).not.toMatch(/HEADER_TEXT_SIZE_RATIO/);
        expect(source).not.toMatch(/HEADER_TEXT_LINE_RATIO/);
        expect(source).not.toMatch(/HEADER_GAP_RATIO/);
    });

    it('places the banner below an 8% top margin, within the band and canvas', () => {
        const layout = resolveHeaderLayout({ ...HEADER, canvasWidth: 1080, canvasHeight: 1920 });
        // Math.round(1920 * 0.08) = 154.
        expect(layout.y).toBe(154);
        expect(layout.y).toBe(Math.round(1920 * HEADER_TOP_MARGIN_RATIO));
        expect(layout.y + layout.height).toBeLessThanOrEqual(1920);
        expect(layout.height).toBeLessThanOrEqual(Math.round(1920 * HEADER_BAND_RATIO));
        expect(layout.width).toBeLessThanOrEqual(1080);
        expect(Math.abs(layout.x - (1080 - layout.width) / 2)).toBeLessThanOrEqual(1);
        // headerBottom stays for the invariants: it marks the banner's bottom
        // edge (top margin + banner height) and must stay on-canvas.
        expect(layout.headerBottom).toBe(layout.y + layout.height);
        expect(layout.headerBottom).toBeLessThanOrEqual(1920);
    });

    it('anchors every canvas size at its 8% top margin without overflowing', () => {
        const sizes = [
            [720, 1280], [1080, 1920], [1920, 1080], [608, 1080], [3840, 2160],
        ];
        for (const [canvasWidth, canvasHeight] of sizes) {
            const layout = resolveHeaderLayout({ ...HEADER, canvasWidth, canvasHeight });
            expect(layout.y).toBe(Math.round(canvasHeight * HEADER_TOP_MARGIN_RATIO));
            expect(layout.y).toBeGreaterThan(0);
            expect(layout.y + layout.height).toBeLessThanOrEqual(canvasHeight);
            // Literal 0.18 (not the constant) so changing the cap fails here.
            expect(layout.height).toBeLessThanOrEqual(Math.round(canvasHeight * 0.18));
        }
    });

    it('preserves the banner aspect ratio', () => {
        const layout = resolveHeaderLayout({ ...HEADER, canvasWidth: 1080, canvasHeight: 1920 });
        const scale = layout.width / HEADER.naturalWidth;
        expect(layout.height).toBe(Math.round(HEADER.naturalHeight * scale));
    });

    it('lands in exactly the same spot for the same canvas size', () => {
        const a = resolveHeaderLayout({ ...HEADER, canvasWidth: 1080, canvasHeight: 1920 });
        const b = resolveHeaderLayout({ ...HEADER, canvasWidth: 1080, canvasHeight: 1920 });
        expect(a).toEqual(b);
    });

    it('returns null when there is no drawable image or canvas', () => {
        expect(resolveHeaderLayout({ naturalWidth: 0, naturalHeight: 300, canvasWidth: 720, canvasHeight: 1280 })).toBeNull();
        expect(resolveHeaderLayout({ naturalWidth: 1600, naturalHeight: 0, canvasWidth: 720, canvasHeight: 1280 })).toBeNull();
        expect(resolveHeaderLayout({ naturalWidth: 1600, naturalHeight: 300, canvasWidth: 0, canvasHeight: 1280 })).toBeNull();
        expect(resolveHeaderLayout({ naturalWidth: 1600, naturalHeight: 300, canvasWidth: 720, canvasHeight: 0 })).toBeNull();
        expect(resolveHeaderLayout()).toBeNull();
    });

    it('no longer returns the dead prompt fields', () => {
        const layout = resolveHeaderLayout({ ...HEADER, canvasWidth: 1080, canvasHeight: 1920 });
        expect(layout).not.toHaveProperty('textY');
        expect(layout).not.toHaveProperty('textSize');
    });
});