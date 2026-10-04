// Regression coverage for the Whisper engine-readiness poll.
//
// When the mic is tapped before the engine is ready, the orchestrator shows
// "engine not ready" and schedules a 1 s interval that waits for
// `isWhisperReady` / `isWhisperEngineFailed`. Historically the interval was a
// local variable, so repeated taps (and step changes) could not clear it and
// stale polls piled up for the life of the page. These tests lock in that at
// most one poll is ever live and that it is always cleared.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../store/store.js';
import { createSpeechOrchestrator } from './speech-orchestrator.js';

function makeOrchestrator() {
    return createSpeechOrchestrator({
        startSpeechCamRecording: vi.fn().mockResolvedValue(undefined),
        startDeferredSpeechCamRecording: vi.fn(),
        stopSpeechCamRecording: vi.fn().mockResolvedValue(null),
        getSpeechCamStream: vi.fn().mockReturnValue(null),
        safelyStopStream: vi.fn(),
        startLocalAudioTap: vi.fn().mockResolvedValue(undefined),
        stopLocalAudioTap: vi.fn().mockResolvedValue(null),
        transcribeAudioBuffer: vi.fn().mockResolvedValue(null),
        preloadWhisperEngine: vi.fn().mockResolvedValue(undefined),
        updateSpeechRecording: vi.fn().mockResolvedValue(null),
    });
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
        uiHooks,
    };
}

describe('speech orchestrator — readiness poll', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        appStore.setState({
            isWhisperReady: false,
            isWhisperEngineFailed: false,
            activeJournal: undefined,
            userData: { native_language: 'en' },
        });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('schedules exactly one poll and notifies onEngineNotReady once', async () => {
        const orchestrator = makeOrchestrator();
        const onEngineNotReady = vi.fn();

        await orchestrator.toggleSpeechRecognition(baseParams({ onEngineNotReady }));

        expect(onEngineNotReady).toHaveBeenCalledTimes(1);
        // `readyPoll` must be a live interval id, not null/undefined.
        expect(orchestrator.listeningState.readyPoll).not.toBeNull();
        expect(orchestrator.listeningState.readyPoll).toBeDefined();

        // Exactly one poll tick per second: the orchestrator must not have
        // scheduled a second live poll on a single toggle.
        const getStateSpy = vi.spyOn(appStore, 'getState');
        const before = getStateSpy.mock.calls.length;
        await vi.advanceTimersByTimeAsync(1000);
        expect(getStateSpy.mock.calls.length - before).toBe(1);
        getStateSpy.mockRestore();
    });

    it('replaces the previous poll when the mic is tapped again', async () => {
        const orchestrator = makeOrchestrator();

        await orchestrator.toggleSpeechRecognition(baseParams({ onEngineNotReady: vi.fn() }));
        const firstPoll = orchestrator.listeningState.readyPoll;

        await orchestrator.toggleSpeechRecognition(baseParams({ onEngineNotReady: vi.fn() }));
        const secondPoll = orchestrator.listeningState.readyPoll;

        expect(secondPoll).not.toBe(firstPoll);

        // The old interval must have been cleared, so the store must not be
        // polled twice per second.
        const getStateSpy = vi.spyOn(appStore, 'getState');
        const callsBefore = getStateSpy.mock.calls.length;
        await vi.advanceTimersByTimeAsync(1000);
        expect(getStateSpy.mock.calls.length - callsBefore).toBe(1);
        getStateSpy.mockRestore();
    });

    it('does not call onEngineReady while the engine is still not ready', async () => {
        const orchestrator = makeOrchestrator();
        const onEngineReady = vi.fn();

        await orchestrator.toggleSpeechRecognition(baseParams({ onEngineReady }));
        await vi.advanceTimersByTimeAsync(3000);

        expect(onEngineReady).not.toHaveBeenCalled();
    });

    it('calls onEngineReady once and clears the poll when the engine becomes ready', async () => {
        const orchestrator = makeOrchestrator();
        const button = { disabled: true };
        const onEngineReady = vi.fn();

        await orchestrator.toggleSpeechRecognition({
            ...baseParams({ onEngineReady }),
            button,
        });

        appStore.setState({ isWhisperReady: true });
        await vi.advanceTimersByTimeAsync(1000);

        expect(onEngineReady).toHaveBeenCalledTimes(1);
        expect(onEngineReady).toHaveBeenCalledWith(button);
        expect(orchestrator.listeningState.readyPoll).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the poll when the engine fails', async () => {
        const orchestrator = makeOrchestrator();
        const onEngineReady = vi.fn();

        await orchestrator.toggleSpeechRecognition(baseParams({ onEngineReady }));

        appStore.setState({ isWhisperReady: false, isWhisperEngineFailed: true });
        await vi.advanceTimersByTimeAsync(1000);

        expect(onEngineReady).not.toHaveBeenCalled();
        expect(orchestrator.listeningState.readyPoll).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('speech orchestrator — repeated-use resource guard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        appStore.setState({
            isWhisperReady: false,
            isWhisperEngineFailed: false,
            userData: { native_language: 'en' },
        });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('keeps at most one poll live across many mic taps', async () => {
        const orchestrator = makeOrchestrator();
        const onEngineReady = vi.fn();

        for (let i = 0; i < 5; i++) {
            await orchestrator.toggleSpeechRecognition(baseParams({ onEngineReady }));
            await vi.advanceTimersByTimeAsync(1000);
            expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
        }

        expect(onEngineReady).not.toHaveBeenCalled();

        appStore.setState({ isWhisperReady: true });
        await vi.advanceTimersByTimeAsync(1000);

        expect(onEngineReady).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
