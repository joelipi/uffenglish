import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { VideoRenderPlanner, resolveRecapOverlay, resolveRecapSources, isDroppedStep, markFirstRenderable, resolveSegmentBounds, UNRESOLVED_SEGMENT_CAP_MS, STALL_GRACE_MS } from './video-processor-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
});

describe('VideoRenderPlanner.generatePlan — recapOverlay tailing variant', () => {
    it('tags the tailing step as shareCta with duration, fluencyData and shareCode', () => {
        const fluencyData = { total: 80 };
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ recapOverlay: 'shareCta' }), fluencyData, 'en', 'ab12'
        );
        const tailing = planner.generatePlan().find(s => s.type === 'tailing');

        expect(tailing.variant).toBe('shareCta');
        expect(tailing.durationMs).toBe(4000);
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