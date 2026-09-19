import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { VideoRenderPlanner } from './video-processor-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGIC_PATH = path.join(__dirname, 'video-processor-logic.js');

function makeConfig({ webcamOnly = false } = {}) {
    return {
        lessons: [
            {
                lessonId: 'w',
                ...(webcamOnly ? { webcamOnly: true } : {}),
                steps: [
                    { responseType: 'lessonIntro', introBackgroundVideoUrl: 'testvideo01' },
                    { responseType: 'closedResponse', interactiveVideoUrl: 'testvideo02', cue: 'Q1' },
                    { responseType: 'closedResponse', interactiveVideoUrl: 'testvideo03', cue: 'Q2' },
                    { responseType: 'closedResponse', interactiveVideoUrl: 'testvideo04', cue: 'Q3' },
                ],
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

describe('VideoRenderPlanner.generatePlan — webcamOnly', () => {
    it('skips all remote segments and keeps webcam steps in order', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ webcamOnly: true }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.filter(s => s.type === 'remote')).toHaveLength(0);
        expect(plan.filter(s => s.type === 'webcam')).toHaveLength(3);
        expect(plan.filter(s => s.type === 'tailing')).toHaveLength(1);
        expect(plan.map(s => s.type)).toEqual(['webcam', 'webcam', 'webcam', 'tailing']);
    });

    it('tags the tailing step as shareCta with duration, fluencyData and shareCode', () => {
        const fluencyData = { total: 80 };
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ webcamOnly: true }), fluencyData, 'en', 'ab12'
        );
        const tailing = planner.generatePlan().find(s => s.type === 'tailing');

        expect(tailing.variant).toBe('shareCta');
        expect(tailing.durationMs).toBe(4000);
        expect(tailing.fluencyData).toBe(fluencyData);
        expect(tailing.shareCode).toBe('ab12');
    });

    it('interleaves remote prompts and tags fluency when webcamOnly is absent', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ webcamOnly: false }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.map(s => s.type)).toEqual([
            'remote', 'webcam', 'remote', 'webcam', 'remote', 'webcam', 'tailing',
        ]);
        expect(plan.find(s => s.type === 'tailing').variant).toBe('fluency');
    });

    it('dedupes the remote prompt for a retry pair (non-webcamOnly)', () => {
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'a' },
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'b' },
        ];
        const planner = new VideoRenderPlanner(recordings, makeConfig(), { total: 80 }, 'en', 'ab12');
        const plan = planner.generatePlan();

        expect(plan.filter(s => s.type === 'remote')).toHaveLength(1);
        expect(plan.filter(s => s.type === 'webcam')).toHaveLength(2);
    });

    it('still emits zero remote steps for a retry pair on a webcamOnly lesson', () => {
        const recordings = [
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'a' },
            { originalLessonId: 'w', originalStepIndex: 1, blob: { size: 1 }, userResponse: 'b' },
        ];
        const planner = new VideoRenderPlanner(
            recordings, makeConfig({ webcamOnly: true }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan.filter(s => s.type === 'remote')).toHaveLength(0);
    });

    it('falls back to the fluency variant when there are no recordings', () => {
        const planner = new VideoRenderPlanner(
            [], makeConfig({ webcamOnly: true }), { total: 80 }, 'en', 'ab12'
        );
        const plan = planner.generatePlan();

        expect(plan).toHaveLength(1);
        expect(plan[0].type).toBe('tailing');
        expect(plan[0].variant).toBe('fluency');
    });

    it('defaults shareCode to null when the constructor is called with 4 args', () => {
        const planner = new VideoRenderPlanner(
            makeRecordings(3), makeConfig({ webcamOnly: true }), { total: 80 }, 'en'
        );
        const tailing = planner.generatePlan().find(s => s.type === 'tailing');

        expect(tailing.shareCode).toBeNull();
    });
});

describe('video-processor-logic.js platform-agnostic guard', () => {
    it('references no browser globals', () => {
        const source = readFileSync(LOGIC_PATH, 'utf8');

        // Strip comments so prose (e.g. "share window") can't trip the guard.
        const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

        expect(code).not.toMatch(/\bwindow\b/);
        expect(code).not.toMatch(/\bdocument\b/);
        expect(code).not.toMatch(/\bnavigator\b/);
    });

    it('builds no absolute URL (the share URL is a bare host/path)', () => {
        const source = readFileSync(LOGIC_PATH, 'utf8');
        const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

        expect(code).not.toMatch(/https?:\/\//);
    });
});
