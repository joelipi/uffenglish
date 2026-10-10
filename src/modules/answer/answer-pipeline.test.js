import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnswerPipeline, resolveAnswerLanguage } from './answer-pipeline.js';
import { appStore } from '../store/store.js';
import { saveSpeechRecording, getAllSpeechRecordingsForLesson } from '../storage/storage.js';

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
        await expect(pipeline.submitAnswerPrecheck('hello', 'hello', stepData, null, '', { pauseCount: 0, netDuration: 0 }, _deps, appStore.getState().userData, appStore.getState().configData, 'test-course')).resolves.not.toThrow();
    });

    it('handleAnswer should accept _deps at position 7', async () => {
        const stepData = { responseType: 'closedResponse', cue: 'hello', explanation: '', translation: null, interactiveVideoUrl: null };
        const _deps = { loadNextStep: vi.fn(), callLoadStep: vi.fn() };
        await expect(pipeline.handleAnswer('hello', 'hello', stepData, null, '', { pauseCount: 0, netDuration: 0 }, _deps, appStore.getState().userData, appStore.getState().configData, 'test-course')).resolves.not.toThrow();
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

    it('re-shows the correction card with a new diff after a mic-press dismissal and another mistake', async () => {
        // No interactiveVideoUrl → the hangman correction card branch runs.
        const hangmanStep = {
            step: 'friend-hangman',
            responseType: 'friendClosedResponse',
            cue: 'I would rather have a million dollars.',
            interactiveVideoUrl: null,
            explanation: '',
            translation: null,
        };
        setupStore(hangmanStep);
        const _deps = { loadNextStep: vi.fn(), callLoadStep: vi.fn() };

        await pipeline.handleAnswer(
            'I would rather eat pizza',
            hangmanStep.cue,
            hangmanStep,
            null,
            '',
            { pauseCount: 0, netDuration: 0 },
            _deps,
            appStore.getState().userData,
            appStore.getState().configData,
            'test-course'
        );

        expect(appStore.getState().hintsVisible).toBe(true);
        const firstOps = appStore.getState().hangmanOps;
        expect(firstOps).toBeTruthy();

        // Simulate the learner pressing the mic button to re-record.
        appStore.setState({ hintsVisible: false });
        expect(appStore.getState().hintsVisible).toBe(false);

        await pipeline.handleAnswer(
            'I would rather fly a kite',
            hangmanStep.cue,
            hangmanStep,
            null,
            '',
            { pauseCount: 0, netDuration: 0 },
            _deps,
            appStore.getState().userData,
            appStore.getState().configData,
            'test-course'
        );

        expect(appStore.getState().hintsVisible).toBe(true);
        expect(appStore.getState().hangmanOps).toBeTruthy();
        expect(appStore.getState().hangmanOps).not.toEqual(firstOps);
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
        // showFeedbackAndProceed performs the single increment on the fallback path.
        expect(appStore.getState().stepCount).toBe(1);
    });

});

// Story 058: the burned recap/UGC subtitle's translation must be computed with
// the same guest-first session language the recap uses. Reading
// `userData.native_language` alone made it 'en' for a guest whose chosen
// language lives in `guestNativeLanguage`, so the clip showed English only.
describe('resolveAnswerLanguage', () => {
    it('prefers the guest/adopted session language over the profile', () => {
        appStore.setState({ guestNativeLanguage: 'es', userData: { native_language: 'en' } });
        expect(resolveAnswerLanguage(appStore.getState().userData)).toBe('es');
    });

    it('falls back to the profile language when no guest language is set', () => {
        appStore.setState({ guestNativeLanguage: null, userData: { native_language: 'es' } });
        expect(resolveAnswerLanguage(appStore.getState().userData)).toBe('es');
    });

    it('falls back to the explicit userData argument when the store has none', () => {
        appStore.setState({ guestNativeLanguage: null, userData: null });
        expect(resolveAnswerLanguage({ native_language: 'bn' })).toBe('bn');
    });

    it('defaults to English when nothing is set', () => {
        appStore.setState({ guestNativeLanguage: null, userData: null });
        expect(resolveAnswerLanguage(null)).toBe('en');
    });
});

describe('burned-subtitle translation uses the guest-first session language', () => {
    let pipeline;

    const cue = [
        { en: 'A million dollars today.', es: 'Un millón de dólares hoy.', pt: 'Um milhão de dólares hoje.', bn: 'আজ এক মিলিয়ন ডলার।' },
        { en: 'I would rather a million dollars today.', es: 'Preferiría un millón de dólares hoy.', pt: 'Eu preferiria um milhão de dólares hoje.', bn: 'আমি বরং আজ এক মিলিয়ন ডলার চাই।' },
    ];
    const step = { step: 'b-1', responseType: 'friendClosedResponse', cue, interactiveVideoUrl: null, explanation: '' };

    beforeEach(() => {
        pipeline = createTestPipeline();
    });

    // Each case uses its own lessonId so the module-level recordingsMap cannot
    // leak a record from a previous case when two saves share a millisecond.
    function setup({ guestLang, profileLang, lessonId }) {
        appStore.setState({
            configData: { courseLevel: 'A1', lessons: [{ lessonId, steps: [step] }] },
            currentLessonIndex: 0,
            currentStepIndex: 0,
            userData: { display_name: 'Test User', native_language: profileLang },
            guestNativeLanguage: guestLang,
            courseId: 'test-course',
            activeLessonId: lessonId,
            chatHistory: [],
            appPhase: 'loading',
            stepCount: 0,
        });
    }

    async function answerAndReadRecording(lessonId) {
        await saveSpeechRecording(null, { lessonId, stepIndex: 0, userResponse: 'A million dollars today' });
        await pipeline.handleAnswer(
            'A million dollars today',
            cue,
            step,
            null,
            '',
            { pauseCount: 0, netDuration: 0 },
            { loadNextStep: vi.fn(), callLoadStep: vi.fn() },
            appStore.getState().userData,
            appStore.getState().configData,
            'test-course'
        );
        const recordings = await getAllSpeechRecordingsForLesson(lessonId);
        return recordings.find((r) => r.originalStepIndex === 0);
    }

    it('stores the localized cue translation when only the guest language is set', async () => {
        setup({ guestLang: 'es', profileLang: 'en', lessonId: 'test-lesson-guest' });
        const rec = await answerAndReadRecording('test-lesson-guest');
        expect(rec.matchedCue).toBe('A million dollars today.');
        expect(rec.translation).toBe('Un millón de dólares hoy.');
    });

    it('falls back to the profile language when no guest language is set', async () => {
        setup({ guestLang: null, profileLang: 'es', lessonId: 'test-lesson-profile' });
        const rec = await answerAndReadRecording('test-lesson-profile');
        expect(rec.translation).toBe('Un millón de dólares hoy.');
    });

    it('stores no translation for an English session', async () => {
        setup({ guestLang: null, profileLang: 'en', lessonId: 'test-lesson-english' });
        const rec = await answerAndReadRecording('test-lesson-english');
        expect(rec.translation).toBeUndefined();
    });
});
