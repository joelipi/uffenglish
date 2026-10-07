import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadNextStep, jumpToStep, replaySimpleVideo } from './lesson-progression.js';
import { getNextStep } from './lesson-routing.js';
import { appStore, setCurrentVideoPlayer } from '../store/store.js';

function makeLesson(count) {
    return {
        lessonId: 'L',
        steps: Array.from({ length: count }, (_, i) => ({ responseType: 'friendClosedResponse', step: `s${i}` })),
    };
}

function seed(lesson, currentStepIndex) {
    appStore.setState({
        configData: { lessons: [lesson] },
        currentLessonIndex: 0,
        currentStepIndex,
        stepsAnswered: 0,
        completionMessage: null,
        pendingVideoPlayType: null,
        appPhase: 'feedback',
    });
}

const deps = (callLoadStep) => ({ callLoadStep, loadLessonContent: vi.fn() });

describe('loadNextStep honors the step-level nextStep override', () => {
    it('advances by the offset and loads the target step', () => {
        const lesson = makeLesson(8);
        lesson.steps[6] = { responseType: 'friendClosedResponse', step: 's6', simpleVideoUrl: 'clip6' };
        seed(lesson, 3);

        const callLoadStep = vi.fn();
        loadNextStep({ responseType: 'friendClosedResponse', nextStep: 3 }, null, deps(callLoadStep));

        expect(appStore.getState().currentStepIndex).toBe(6);
        expect(callLoadStep).toHaveBeenCalledWith(lesson.steps[6], lesson, null);
        expect(appStore.getState().pendingVideoPlayType).toBe('simple');
    });

    it('defaults to +1 when nextStep is absent', () => {
        const lesson = makeLesson(8);
        seed(lesson, 3);

        const callLoadStep = vi.fn();
        loadNextStep({ responseType: 'friendClosedResponse' }, null, deps(callLoadStep));

        expect(appStore.getState().currentStepIndex).toBe(4);
        expect(callLoadStep).toHaveBeenCalledWith(lesson.steps[4], lesson, null);
    });

    it('advances by exactly 1 for nextStep 0 or 1.5', () => {
        for (const nextStep of [0, 1.5]) {
            const lesson = makeLesson(8);
            seed(lesson, 3);
            const callLoadStep = vi.fn();
            loadNextStep({ responseType: 'friendClosedResponse', nextStep }, null, deps(callLoadStep));
            expect(appStore.getState().currentStepIndex).toBe(4);
        }
    });

    it('ends the lesson when the target is past the last step', () => {
        const lesson = makeLesson(8);
        seed(lesson, 6);

        const callLoadStep = vi.fn();
        loadNextStep({ responseType: 'friendClosedResponse', nextStep: 5 }, null, deps(callLoadStep));

        expect(callLoadStep).not.toHaveBeenCalled();
        expect(appStore.getState().completionMessage).toBeTruthy();
    });
});

describe('getNextStep uses the shared offset resolver', () => {
    it('returns the target step for a step-level nextStep', () => {
        const lesson = makeLesson(8);
        const configData = { lessons: [lesson] };
        appStore.setState({ currentStepIndex: 3 });
        expect(getNextStep({ nextStep: 3 }, configData, 0)).toBe(lesson.steps[6]);
    });

    it('returns the immediately following step when nextStep is absent', () => {
        const lesson = makeLesson(8);
        const configData = { lessons: [lesson] };
        appStore.setState({ currentStepIndex: 3 });
        expect(getNextStep({}, configData, 0)).toBe(lesson.steps[4]);
    });
});

describe('jumpToStep', () => {
    it('sets the index and loads the target step', () => {
        const lesson = makeLesson(8);
        lesson.steps[5] = { responseType: 'viewAndContinue', step: 's5', simpleVideoUrl: 'clip5' };
        seed(lesson, 2);

        const callLoadStep = vi.fn();
        jumpToStep(5, deps(callLoadStep));

        expect(appStore.getState().currentStepIndex).toBe(5);
        expect(callLoadStep).toHaveBeenCalledWith(lesson.steps[5], lesson, null);
        expect(appStore.getState().pendingVideoPlayType).toBe('simple');
    });

    it('ignores an out-of-range or negative target', () => {
        const lesson = makeLesson(8);
        for (const target of [8, -1]) {
            seed(lesson, 2);
            const callLoadStep = vi.fn();
            jumpToStep(target, deps(callLoadStep));
            expect(appStore.getState().currentStepIndex).toBe(2);
            expect(callLoadStep).not.toHaveBeenCalled();
        }
    });

    it('jumps to the last step', () => {
        const lesson = makeLesson(8);
        seed(lesson, 2);

        const callLoadStep = vi.fn();
        jumpToStep(7, deps(callLoadStep));

        expect(appStore.getState().currentStepIndex).toBe(7);
        expect(callLoadStep).toHaveBeenCalledWith(lesson.steps[7], lesson, null);
    });
});

describe('replaySimpleVideo', () => {
    afterEach(() => {
        setCurrentVideoPlayer(null);
    });

    it('returns to simpleVideo and replays the mounted player', () => {
        const player = { replay: vi.fn() };
        setCurrentVideoPlayer(player);
        appStore.setState({ appPhase: 'simpleVideo-decisionTime-branching' });

        replaySimpleVideo();

        expect(appStore.getState().appPhase).toBe('simpleVideo');
        expect(player.replay).toHaveBeenCalledTimes(1);
    });

    it('leaves the phase unchanged when no player is mounted', () => {
        setCurrentVideoPlayer(null);
        appStore.setState({ appPhase: 'simpleVideo-decisionTime-branching' });

        replaySimpleVideo();

        expect(appStore.getState().appPhase).toBe('simpleVideo-decisionTime-branching');
    });
});

beforeEach(() => {
    setCurrentVideoPlayer(null);
});
