// A capture with no audio must be answered with guidance and a retry, never
// sent to Whisper (which is what left the learner on a flat waveform and an
// endless "transcribing" screen). (stories/087-no-audio-capture)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../store/store.js';
import { createSpeechOrchestrator } from './speech-orchestrator.js';

// Reaching the transcribe path runs the answer precheck, which reaches the
// network/LLM helpers. Nothing else here needs them.
vi.mock('../answer/answers.js', async (importOriginal) => ({
    ...await importOriginal(),
    validateAnswerPrecheck: vi.fn().mockResolvedValue({ isValid: true, warningMessage: null }),
    findMatchingCueText: vi.fn().mockResolvedValue(null),
}));

function makeOrchestrator(overrides = {}) {
    const deps = {
        startSpeechCamRecording: vi.fn().mockResolvedValue(undefined),
        startDeferredSpeechCamRecording: vi.fn().mockResolvedValue(undefined),
        stopSpeechCamRecording: vi.fn().mockResolvedValue({ size: 1024 }),
        getSpeechCamStream: vi.fn().mockReturnValue({ id: 'cam' }),
        safelyStopStream: vi.fn(),
        startLocalAudioTap: vi.fn().mockResolvedValue(undefined),
        stopLocalAudioTap: vi.fn().mockResolvedValue(new Float32Array(32000).fill(0.2)),
        transcribeAudioBuffer: vi.fn().mockResolvedValue('a clear sentence'),
        preloadWhisperEngine: vi.fn().mockResolvedValue(undefined),
        updateSpeechRecording: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
    return { orchestrator: createSpeechOrchestrator(deps), deps };
}

function baseParams(uiHooks = {}) {
    return {
        button: { disabled: true },
        step: { cue: 'hello', responseType: 'openResponse' },
        micStatusText: 'Listening…',
        userData: { native_language: 'en' },
        configData: { lessons: [{ lessonId: 'L', steps: [] }] },
        currentLessonIndex: 0,
        currentStepIndex: 0,
        player: null,
        handleAnswer: vi.fn(),
        uiHooks,
    };
}

async function runTake(orchestrator, params) {
    const start = orchestrator.toggleSpeechRecognition(params);
    await vi.advanceTimersByTimeAsync(3000); // the 3-2-1 pre-roll
    await start;

    const stop = orchestrator.toggleSpeechRecognition(params);
    await vi.advanceTimersByTimeAsync(250); // post-stop settle before Whisper
    await stop;
}

describe('speech orchestrator — no audio captured', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        appStore.setState({
            appPhase: 'loading',
            isWhisperReady: true,
            isWhisperEngineFailed: false,
            isMicActive: false,
            userData: { native_language: 'en' },
            flowScore: 100,
            recordingCountdown: null,
            recordedAudioPeaks: null,
            playbackBlob: null,
        });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('never sends an all-zero capture to Whisper', async () => {
        const { orchestrator, deps } = makeOrchestrator({
            stopLocalAudioTap: vi.fn().mockResolvedValue(new Float32Array(32000)),
        });
        const hooks = { onNoAudioCaptured: vi.fn(), onStopEarly: vi.fn() };

        await runTake(orchestrator, baseParams(hooks));

        expect(deps.transcribeAudioBuffer).not.toHaveBeenCalled();
        expect(hooks.onNoAudioCaptured).toHaveBeenCalledTimes(1);
        expect(hooks.onStopEarly).not.toHaveBeenCalled();
        expect(appStore.getState().recordedAudioPeaks).toBeNull();
        expect(appStore.getState().playbackBlob).toBeNull();
        // A silent take must not be replayed to the learner, and the capture
        // stream must be released so the retry re-acquires a fresh mic track.
        expect(deps.stopSpeechCamRecording).toHaveBeenCalledWith(
            expect.objectContaining({ playback: false, autoplay: false }),
        );
        expect(deps.safelyStopStream).toHaveBeenCalledTimes(1);
    });

    it('never sends an empty capture to Whisper', async () => {
        const { orchestrator, deps } = makeOrchestrator({
            stopLocalAudioTap: vi.fn().mockResolvedValue(new Float32Array(0)),
        });
        const hooks = { onNoAudioCaptured: vi.fn() };

        await runTake(orchestrator, baseParams(hooks));

        expect(deps.transcribeAudioBuffer).not.toHaveBeenCalled();
        expect(hooks.onNoAudioCaptured).toHaveBeenCalledTimes(1);
        expect(appStore.getState().recordedAudioPeaks).toBeNull();
    });

    it('falls back to the early-stop path when the caller has no no-audio hook', async () => {
        const { orchestrator, deps } = makeOrchestrator({
            stopLocalAudioTap: vi.fn().mockResolvedValue(new Float32Array(32000)),
        });
        const hooks = { onStopEarly: vi.fn() };

        await runTake(orchestrator, baseParams(hooks));

        expect(deps.transcribeAudioBuffer).not.toHaveBeenCalled();
        expect(hooks.onStopEarly).toHaveBeenCalledTimes(1);
    });

    it('still transcribes a usable capture', async () => {
        const { orchestrator, deps } = makeOrchestrator();
        const hooks = { onNoAudioCaptured: vi.fn(), onStopEarly: vi.fn(), onReviewStart: vi.fn() };

        await runTake(orchestrator, baseParams(hooks));

        expect(deps.transcribeAudioBuffer).toHaveBeenCalledTimes(1);
        expect(hooks.onNoAudioCaptured).not.toHaveBeenCalled();
        expect(appStore.getState().recordedAudioPeaks).not.toBeNull();
    });

});
