import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveStepPhase } from './step-phase-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('resolveStepPhase', () => {
    it('sends a friend lesson first response step with a simple clip to simpleVideo', () => {
        for (const responseType of ['closedResponse', 'openResponse', 'friendClosedResponse']) {
            expect(resolveStepPhase({
                step: { responseType, simpleVideoUrl: 'clip' },
                isFirstResponseStep: true,
                isRetry: false,
                isFriendLesson: true,
            })).toBe('simpleVideo');
        }
    });

    it('sends a friend lesson first response step with an interactive clip to its per-type interactive phase', () => {
        expect(resolveStepPhase({
            step: { responseType: 'friendClosedResponse', interactiveVideoUrl: 'clip' },
            isFirstResponseStep: true, isRetry: false, isFriendLesson: true,
        })).toBe('interactiveVideo+friendClosedResponse');

        expect(resolveStepPhase({
            step: { responseType: 'openResponse', interactiveVideoUrl: 'clip' },
            isFirstResponseStep: true, isRetry: false, isFriendLesson: true,
        })).toBe('interactiveVideo+openResponse');

        expect(resolveStepPhase({
            step: { responseType: 'closedResponse', interactiveVideoUrl: 'clip' },
            isFirstResponseStep: true, isRetry: false, isFriendLesson: true,
        })).toBe('interactiveVideo+closedResponse');
    });

    it('sends a friend lesson first response step with no clip to recording/answering', () => {
        expect(resolveStepPhase({
            step: { responseType: 'friendClosedResponse' },
            isFirstResponseStep: true, isRetry: false, isFriendLesson: true,
        })).toBe('recording/answering');
    });

    it('keeps the firstResponse chooser for a non-friend lesson first response step', () => {
        for (const responseType of ['closedResponse', 'friendClosedResponse']) {
            expect(resolveStepPhase({
                step: { responseType, simpleVideoUrl: 'clip' },
                isFirstResponseStep: true, isRetry: false, isFriendLesson: false,
            })).toBe('firstResponse');
            expect(resolveStepPhase({
                step: { responseType, interactiveVideoUrl: 'clip' },
                isFirstResponseStep: true, isRetry: false, isFriendLesson: false,
            })).toBe('firstResponse');
        }
    });

    it('ignores the firstResponse branch on a retry (friend and non-friend)', () => {
        for (const isFriendLesson of [true, false]) {
            expect(resolveStepPhase({
                step: { responseType: 'closedResponse', simpleVideoUrl: 'clip' },
                isFirstResponseStep: true, isRetry: true, isFriendLesson,
            })).toBe('simpleVideo');
        }
    });

    it('leaves later (non-first) response steps unchanged', () => {
        expect(resolveStepPhase({
            step: { responseType: 'friendClosedResponse', simpleVideoUrl: 'clip' },
            isFirstResponseStep: false, isRetry: false, isFriendLesson: true,
        })).toBe('simpleVideo');
    });

    it('resolves lessonIntro and success regardless of friend-ness', () => {
        for (const isFriendLesson of [true, false]) {
            expect(resolveStepPhase({ step: { responseType: 'lessonIntro' }, isFriendLesson })).toBe('lessonIntro');
            expect(resolveStepPhase({ step: { responseType: 'success' }, isFriendLesson })).toBe('lessonSuccess');
        }
    });

    it('resolves a viewAndContinue step with a simple clip to viewAndContinueVideo', () => {
        expect(resolveStepPhase({
            step: { responseType: 'viewAndContinue', simpleVideoUrl: 'clip' },
        })).toBe('viewAndContinueVideo');
    });

    it('falls back to interactiveVideo+closedResponse for an unknown/omitted response type', () => {
        expect(resolveStepPhase({ step: { interactiveVideoUrl: 'clip' } })).toBe('interactiveVideo+closedResponse');
        expect(resolveStepPhase({ step: { responseType: 'mystery', interactiveVideoUrl: 'clip' } })).toBe('interactiveVideo+closedResponse');
    });
});

describe('step-executor-webonly.js phase wiring', () => {
    const source = read('src/modules/lesson/step-executor-webonly.js');

    it('uses the pure resolver', () => {
        expect(source).toMatch(/resolveStepPhase\(/);
        expect(source).toContain("from './step-phase-logic.js'");
    });

    it('detects friend lessons from the route', () => {
        expect(source).toMatch(/isFriendLesson\(/);
        expect(source).toContain("from '../user/friend-lesson-detection.js'");
    });

    it('no longer assigns the firstResponse phase inline', () => {
        expect(source).not.toContain("phase = 'firstResponse'");
    });
});
