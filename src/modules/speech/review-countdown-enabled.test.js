// The review countdown is OFF by default, but the code is deliberately kept:
// flipping `REVIEW_COUNTDOWN_ENABLED` in review-countdown-logic.js must restore
// the whole behaviour with no other change. This file drives the orchestrator
// with the switch forced ON, so "kept, not deleted" stays true.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../store/store.js';

vi.mock('../answer/answers.js', async (importOriginal) => ({
    ...await importOriginal(),
    validateAnswerPrecheck: vi.fn().mockResolvedValue({ isValid: true, warningMessage: null }),
    findMatchingCueText: vi.fn().mockResolvedValue(null),
}));

// Force the switch on for this file only. The real rules still decide; they just
// see `enabled: true`, which is what the one constant would do in production.
vi.mock('../lesson/review-countdown-logic.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        resolveReviewCountdownStart: () => actual.REVIEW_COUNTDOWN_SECONDS,
        shouldAutoAcceptReview: (options) => actual.shouldAutoAcceptReview({ ...options, enabled: true }),
    };
});

import { createSpeechOrchestrator } from './speech-orchestrator.js';
import { REVIEW_COUNTDOWN_SECONDS } from '../lesson/review-countdown-logic.js';

const SPEECH_SAMPLES = new Float32Array(32000).fill(0.2);

function makeRecordingOrchestrator() {
    return createSpeechOrchestrator({
        startSpeechCamRecording: vi.fn().mockResolvedValue(undefined),
        startDeferredSpeechCamRecording: vi.fn().mockResolvedValue(undefined),
        stopSpeechCamRecording: vi.fn().mockResolvedValue({ size: 1024 }),
        getSpeechCamStream: vi.fn().mockReturnValue({ id: 'cam' }),
        safelyStopStream: vi.fn(),
        startLocalAudioTap: vi.fn().mockResolvedValue(undefined),
        stopLocalAudioTap: vi.fn().mockResolvedValue(SPEECH_SAMPLES),
        transcribeAudioBuffer: vi.fn().mockResolvedValue('a clear sentence'),
        preloadWhisperEngine: vi.fn().mockResolvedValue(undefined),
        updateSpeechRecording: vi.fn().mockResolvedValue(null),
    });
}

function reviewHooks() {
    return {
        onRecordingStart: vi.fn(),
        onMediaError: vi.fn(),
        onReviewStart: vi.fn(),
        onReviewUpdate: vi.fn(),
        onTranscriptRejected: vi.fn(),
        onReviewEnd: vi.fn(),
    };
}

function baseParams(handleAnswer, uiHooks) {
    return {
        button: { disabled: true },
        step: { cue: 'hello', responseType: 'openResponse' },
        micStatusText: 'Listening…',
        userData: { native_language: 'en' },
        configData: { lessons: [{ lessonId: 'L', steps: [] }] },
        currentLessonIndex: 0,
        currentStepIndex: 0,
        player: null,
        handleAnswer,
        uiHooks,
    };
}

async function runTakeToReview(orchestrator, params) {
    const start = orchestrator.toggleSpeechRecognition(params);
    await vi.advanceTimersByTimeAsync(3000); // the 3-2-1 pre-roll
    await start;

    const stop = orchestrator.toggleSpeechRecognition(params);
    await vi.advanceTimersByTimeAsync(250); // post-stop settle before Whisper
    await stop;
}

describe('with the switch on, the review countdown still works', () => {
    let warnSpy;

    beforeEach(() => {
        vi.useFakeTimers();
        appStore.setState({
            appPhase: 'loading',
            isWhisperReady: true,
            isWhisperEngineFailed: false,
            isMicActive: false,
            userData: { native_language: 'en' },
            flowScore: 100,
            recordingCountdown: null,
        });
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('starts at the documented number of seconds and ticks down every second', async () => {
        const orchestrator = makeRecordingOrchestrator();
        const hooks = reviewHooks();
        await runTakeToReview(orchestrator, baseParams(vi.fn(), hooks));

        expect(hooks.onReviewStart.mock.calls[0][1]).toBe(REVIEW_COUNTDOWN_SECONDS);

        await vi.advanceTimersByTimeAsync(3000);
        expect(hooks.onReviewUpdate.mock.calls.map((c) => c[0]))
            .toEqual([6, 5, 4]);
    });

    it('auto-accepts when it reaches zero, and only then', async () => {
        const orchestrator = makeRecordingOrchestrator();
        const handleAnswer = vi.fn();
        const hooks = reviewHooks();
        await runTakeToReview(orchestrator, baseParams(handleAnswer, hooks));

        // One second short of zero: still the learner's decision.
        await vi.advanceTimersByTimeAsync((REVIEW_COUNTDOWN_SECONDS - 1) * 1000);
        expect(handleAnswer).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1000);
        expect(handleAnswer).toHaveBeenCalledTimes(1);
        expect(hooks.onReviewEnd).toHaveBeenCalledWith('feedback');
        expect(hooks.onReviewUpdate.mock.calls.map((c) => c[0]).at(-1)).toBe(0);
    });

    it('an accept before the timer runs out cancels it', async () => {
        const orchestrator = makeRecordingOrchestrator();
        const handleAnswer = vi.fn();
        const hooks = reviewHooks();
        await runTakeToReview(orchestrator, baseParams(handleAnswer, hooks));

        hooks.onReviewStart.mock.calls[0][2](); // ✓ accept
        await vi.advanceTimersByTimeAsync(REVIEW_COUNTDOWN_SECONDS * 1000 + 1000);

        expect(handleAnswer).toHaveBeenCalledTimes(1);
        expect(hooks.onReviewUpdate).not.toHaveBeenCalled();
    });
});
