import { describe, it, expect, vi, beforeEach } from 'vitest';
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
                languageLevel: 'A1',
                lessons: [{
                    lessonId: 'test-lesson',
                    steps: [
                        { stepType: 'lessonIntro', cue: 'Welcome' },
                        { stepType: 'openResponse', cue: 'Hello' }
                    ]
                }]
            },
            currentLessonIndex: 0,
            currentStepIndex: 0,
            userData: { display_name: 'Test User' },
            courseId: 'test-course',
            activeLessonId: 'test-lesson',
            hintsVisible: false,
            statsVisible: true
        });
        pipeline = createTestPipeline();
    });

    it('showFeedbackAndProceed should not throw ReferenceError (catches missing imports)', () => {
        const deps = { loadNextStep: vi.fn(), callLoadStep: vi.fn() };
        const stepData = { stepType: 'closedResponse', cue: 'hello' };
        expect(() => pipeline.showFeedbackAndProceed(stepData, true, deps)).not.toThrow();
    });

    it('showFeedbackAndProceed should not throw for lessonIntro step', () => {
        const deps = { loadNextStep: vi.fn(), callLoadStep: vi.fn() };
        const stepData = { stepType: 'lessonIntro', cue: 'Welcome' };
        expect(() => pipeline.showFeedbackAndProceed(stepData, true, deps)).not.toThrow();
    });

    it('submitAnswerPrecheck should accept _deps at position 7', async () => {
        const stepData = { stepType: 'closedResponse', cue: 'hello', explanation: '', translation: null };
        const _deps = { loadNextStep: vi.fn(), callLoadStep: vi.fn() };
        await expect(pipeline.submitAnswerPrecheck('hello', 'hello', stepData, null, '', null, { pauseCount: 0, netDuration: 0 }, _deps, appStore.getState().userData, appStore.getState().configData, 'test-course')).resolves.not.toThrow();
    });

    it('handleAnswer should accept _deps at position 7', async () => {
        const stepData = { stepType: 'closedResponse', cue: 'hello', explanation: '', translation: null, videoUrl: null };
        const _deps = { loadNextStep: vi.fn(), callLoadStep: vi.fn() };
        await expect(pipeline.handleAnswer('hello', 'hello', stepData, null, '', null, { pauseCount: 0, netDuration: 0 }, _deps, appStore.getState().userData, appStore.getState().configData, 'test-course')).resolves.not.toThrow();
    });

});
