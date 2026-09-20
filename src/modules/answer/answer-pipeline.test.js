import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnswerPipeline } from './answer-pipeline.js';
import { appStore } from '../store/store.js';

// Suppress whisper worker load in test environment (no Worker API in JSDOM)
vi.mock('../workers/whisper/app-vad-asr-web.js', () => ({ preloadWhisperEngine: vi.fn(), transcribeAudioBuffer: vi.fn() }));
vi.mock('./speech.js', () => ({ warmUpSpeechCamStream: vi.fn() }));

function createTestPipeline() {
    return createAnswerPipeline({
        showChat: vi.fn(),
        clearChat: vi.fn(),
        addAIFeedbackMessages: vi.fn(),
        playSound: vi.fn(),
        enableAudioSystem: vi.fn(),
        preloadVideo: vi.fn(),
        warmUpSpeechCam: vi.fn(),
    });
}

describe('Answer Pipeline Integration', () => {
    let pipeline;

    beforeEach(() => {
        appStore.setState({
            configData: {
                courseLevel: 'A1',
                lessons: [{
                    lessonId: 'test-lesson',
                    steps: [
                        { responseType: 'lessonIntro', cue: 'Welcome' },
                        { responseType: 'openResponse', cue: 'Hello' }
                    ]
                }]
            },
            currentLessonIndex: 0,
            currentStepIndex: 0,
            userData: { display_name: 'Test User' },
            courseId: 'test-course',
            activeLessonId: 'test-lesson',
            hintsVisible: false,
            topState: 'topBarWithStats'
        });
        pipeline = createTestPipeline();
    });

    it('showFeedbackAndProceed should not throw ReferenceError (catches missing imports)', () => {
        const deps = { loadNextStep: vi.fn(), callLoadStep: vi.fn() };
        const stepData = { responseType: 'closedResponse', cue: 'hello' };
        expect(() => pipeline.showFeedbackAndProceed(stepData, true, deps)).not.toThrow();
    });

    it('showFeedbackAndProceed should not throw for lessonIntro step', () => {
        const deps = { loadNextStep: vi.fn(), callLoadStep: vi.fn() };
        const stepData = { responseType: 'lessonIntro', cue: 'Welcome' };
        expect(() => pipeline.showFeedbackAndProceed(stepData, true, deps)).not.toThrow();
    });

    it('submitAnswerPrecheck should accept _deps at position 7', async () => {
        const stepData = { responseType: 'closedResponse', cue: 'hello', explanation: '', translation: null };
        const _deps = { loadNextStep: vi.fn(), callLoadStep: vi.fn() };
        await expect(pipeline.submitAnswerPrecheck('hello', 'hello', stepData, null, '', null, { pauseCount: 0, netDuration: 0 }, _deps, appStore.getState().userData, appStore.getState().configData, 'test-course')).resolves.not.toThrow();
    });

    it('handleAnswer should accept _deps at position 7', async () => {
        const stepData = { responseType: 'closedResponse', cue: 'hello', explanation: '', translation: null, interactiveVideoUrl: null };
        const _deps = { loadNextStep: vi.fn(), callLoadStep: vi.fn() };
        await expect(pipeline.handleAnswer('hello', 'hello', stepData, null, '', null, { pauseCount: 0, netDuration: 0 }, _deps, appStore.getState().userData, appStore.getState().configData, 'test-course')).resolves.not.toThrow();
    });

});

describe('friendClosedResponse auto-advance', () => {
    let pipeline;

    const friendStep = {
        step: 'friend-1',
        responseType: 'friendClosedResponse',
        cue: 'I would rather have a million dollars.',
        interactiveVideoUrl: 'testvideo01',
        explanation: '',
        translation: null,
    };

    const closedStep = {
        step: 'closed-1',
        responseType: 'closedResponse',
        cue: 'I would rather have a million dollars.',
        interactiveVideoUrl: 'testvideo01',
        explanation: '',
        translation: null,
    };

    function setupStore(step) {
        appStore.setState({
            configData: {
                courseLevel: 'A1',
                lessons: [{ lessonId: 'test-lesson', steps: [step] }]
            },
            currentLessonIndex: 0,
            currentStepIndex: 0,
            userData: { display_name: 'Test User', native_language: 'en' },
            courseId: 'test-course',
            activeLessonId: 'test-lesson',
            hintsVisible: false,
            topState: 'topBarWithStats',
            stepCount: 0,
            chatHistory: [],
            appPhase: 'loading',
        });
    }

    beforeEach(() => {
        pipeline = createTestPipeline();
    });

    it('auto-advances on a correct friendClosedResponse answer without feedback', async () => {
        setupStore(friendStep);
        const loadNextStep = vi.fn();
        const _deps = { loadNextStep, callLoadStep: vi.fn() };

        await pipeline.handleAnswer(
            'I would rather have a million dollars',
            friendStep.cue,
            friendStep,
            null,
            '',
            { pauseCount: 0, netDuration: 0 },
            _deps,
            appStore.getState().userData,
            appStore.getState().configData,
            'test-course'
        );

        expect(loadNextStep).toHaveBeenCalledTimes(1);
        expect(loadNextStep).toHaveBeenCalledWith(friendStep);
        expect(appStore.getState().stepCount).toBe(1);
        const chatHistory = appStore.getState().chatHistory;
        expect(chatHistory.some(m => m.type === 'continueWidget')).toBe(false);
        expect(chatHistory.some(m => m.type === 'praise')).toBe(false);
        expect(chatHistory.some(m => m.botName === 'Joe Walsh')).toBe(false);
        expect(appStore.getState().appPhase).not.toBe('feedback');
    });

    it('keeps the hangman retry path on an incorrect friendClosedResponse answer', async () => {
        setupStore(friendStep);
        const loadNextStep = vi.fn();
        const _deps = { loadNextStep, callLoadStep: vi.fn() };

        await pipeline.handleAnswer(
            'I would rather eat pizza',
            friendStep.cue,
            friendStep,
            null,
            '',
            { pauseCount: 0, netDuration: 0 },
            _deps,
            appStore.getState().userData,
            appStore.getState().configData,
            'test-course'
        );

        expect(loadNextStep).not.toHaveBeenCalled();
        expect(appStore.getState().appPhase).toBe('recording/answering');
    });

    it('keeps the feedback step for a correct closedResponse answer (regression)', async () => {
        setupStore(closedStep);
        const loadNextStep = vi.fn();
        const _deps = { loadNextStep, callLoadStep: vi.fn() };

        await pipeline.handleAnswer(
            'I would rather have a million dollars',
            closedStep.cue,
            closedStep,
            null,
            '',
            { pauseCount: 0, netDuration: 0 },
            _deps,
            appStore.getState().userData,
            appStore.getState().configData,
            'test-course'
        );

        expect(loadNextStep).not.toHaveBeenCalled();
        expect(appStore.getState().appPhase).toBe('feedback');
        expect(appStore.getState().chatHistory.some(m => m.type === 'continueWidget')).toBe(true);
    });

    it('falls back to the feedback path when progression deps are missing', async () => {
        setupStore(friendStep);

        await pipeline.handleAnswer(
            'I would rather have a million dollars',
            friendStep.cue,
            friendStep,
            null,
            '',
            { pauseCount: 0, netDuration: 0 },
            {},
            appStore.getState().userData,
            appStore.getState().configData,
            'test-course'
        );

        expect(appStore.getState().appPhase).toBe('feedback');
        expect(appStore.getState().chatHistory.some(m => m.type === 'continueWidget')).toBe(true);
    });

});
