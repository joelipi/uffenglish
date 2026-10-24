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

// The re-record tests below drive a take all the way to the review overlay, so
// the real answer precheck must not run (it reaches the network/LLM helpers).
// Nothing else in this file reaches `processTranscript`, so every other suite is
// unaffected by the partial mock.
vi.mock('../answer/answers.js', async (importOriginal) => ({
    ...await importOriginal(),
    validateAnswerPrecheck: vi.fn().mockResolvedValue({ isValid: true, warningMessage: null }),
    findMatchingCueText: vi.fn().mockResolvedValue(null),
}));

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
        handleAnswer: vi.fn(),
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

describe('speech orchestrator — hesitation timer gating', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        appStore.setState({
            isWhisperReady: true,
            isWhisperEngineFailed: false,
            userData: { native_language: 'en' },
        });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('starts the 100 ms hesitation timer by default', async () => {
        const orchestrator = makeOrchestrator();
        const p = orchestrator.toggleSpeechRecognition(baseParams({}));
        await vi.advanceTimersByTimeAsync(3000);
        await p;
        expect(orchestrator.listeningState.hesitationTimer).not.toBeNull();
    });

    it('does not start the timer when trackHesitation is false', async () => {
        const orchestrator = makeOrchestrator();
        const p = orchestrator.toggleSpeechRecognition({ ...baseParams({}), trackHesitation: false });
        await vi.advanceTimersByTimeAsync(3000);
        await p;
        expect(orchestrator.listeningState.hesitationTimer).toBeNull();
    });
});

describe('speech orchestrator — 3-2-1 pre-roll', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        appStore.setState({
            isWhisperReady: true,
            isWhisperEngineFailed: false,
            userData: { native_language: 'en' },
        });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('counts 3, 2, 1 and never sets the removed "mic" value', async () => {
        const orchestrator = makeOrchestrator();
        const seen = [];
        let last = null;
        appStore.getState().setRecordingCountdown(null);
        const unsubscribe = appStore.subscribe((s) => {
            const c = s.recordingCountdown;
            // Only record transitions; the store emits repeatedly while a value
            // is held, so dedupe consecutive duplicates.
            if (c !== null && c !== last) { seen.push(c); last = c; }
        });

        const p = orchestrator.toggleSpeechRecognition(baseParams({}));
        await vi.advanceTimersByTimeAsync(3000);
        await p;
        unsubscribe();

        expect(seen).toEqual([3, 2, 1]);
        expect(seen).not.toContain('mic');
    });

    it('clears the countdown to null before the take starts', async () => {
        const orchestrator = makeOrchestrator();
        const p = orchestrator.toggleSpeechRecognition(baseParams({}));
        await vi.advanceTimersByTimeAsync(3000);
        await p;
        expect(appStore.getState().recordingCountdown).toBeNull();
    });

    it('starts the deferred MediaRecorder and then the local audio tap after the 3-2-1 countdown finishes', async () => {
        const order = [];
        const { orchestrator, deps } = makeRecordingOrchestrator({
            startDeferredSpeechCamRecording: vi.fn(async () => {
                order.push(`recorderStart:${appStore.getState().recordingCountdown}`);
            }),
            startLocalAudioTap: vi.fn(async () => {
                order.push(`tapStart:${appStore.getState().recordingCountdown}`);
            }),
        });
        appStore.getState().setRecordingCountdown(null);

        const p = orchestrator.toggleSpeechRecognition(baseParams({}));
        await vi.advanceTimersByTimeAsync(100);
        expect(deps.startDeferredSpeechCamRecording).not.toHaveBeenCalled();
        expect(deps.startLocalAudioTap).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(3000);
        await p;

        expect(order).toEqual([
            'recorderStart:null',
            'tapStart:null',
        ]);
    });

    it('friendClosedResponse two-step flow: first tap opens preview (awaitingRecordingStart=true, mic inactive), second tap starts recording with no 3-2-1 countdown, third tap stops', async () => {
        const { orchestrator, deps } = makeRecordingOrchestrator();
        appStore.getState().setAwaitingRecordingStart(false);
        appStore.getState().setMicActive(false);

        const params = {
            ...baseParams({ onRecordingStart: vi.fn() }),
            step: { cue: 'I like tea', responseType: 'friendClosedResponse' },
        };

        // Tap 1 (Continue): opens preview, does not start recording or block transitioning.
        await orchestrator.toggleSpeechRecognition(params);
        expect(appStore.getState().awaitingRecordingStart).toBe(true);
        expect(appStore.getState().isMicActive).toBe(false);
        expect(orchestrator.listeningState.active).toBe(false);
        expect(orchestrator.listeningState.transitioning).toBe(false);
        expect(deps.startDeferredSpeechCamRecording).not.toHaveBeenCalled();

        // Tap 2 (#micBtn on preview): starts recording immediately without a 3-2-1 countdown.
        await orchestrator.toggleSpeechRecognition(params);
        expect(appStore.getState().awaitingRecordingStart).toBe(false);
        expect(appStore.getState().isMicActive).toBe(true);
        expect(orchestrator.listeningState.active).toBe(true);
        expect(orchestrator.listeningState.transitioning).toBe(false);
        expect(deps.startDeferredSpeechCamRecording).toHaveBeenCalledTimes(1);
        expect(deps.startLocalAudioTap).toHaveBeenCalledTimes(1);

        // Tap 3 (#micBtn to stop): stops recording and transcribes.
        const stopPromise = orchestrator.toggleSpeechRecognition(params);
        await vi.advanceTimersByTimeAsync(300);
        await stopPromise;
        expect(orchestrator.listeningState.active).toBe(false);
        expect(deps.stopSpeechCamRecording).toHaveBeenCalledTimes(1);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Re-record (the Whisper review ✕) must be ONE press: it re-enters the same
// mic path as the first tap — camera → 3-2-1 countdown → take — instead of
// parking the learner on an idle `recording/answering` screen that needs a
// second press.
// ────────────────────────────────────────────────────────────────────────────

const SPEECH_SAMPLES = new Float32Array(32000).fill(0.2);

function makeRecordingOrchestrator(overrides = {}) {
    const deps = {
        startSpeechCamRecording: vi.fn().mockResolvedValue(undefined),
        startDeferredSpeechCamRecording: vi.fn().mockResolvedValue(undefined),
        // A truthy blob is required or the stop branch bails before Whisper.
        stopSpeechCamRecording: vi.fn().mockResolvedValue({ size: 1024 }),
        getSpeechCamStream: vi.fn().mockReturnValue({ id: 'cam' }),
        safelyStopStream: vi.fn(),
        startLocalAudioTap: vi.fn().mockResolvedValue(undefined),
        stopLocalAudioTap: vi.fn().mockResolvedValue(SPEECH_SAMPLES),
        transcribeAudioBuffer: vi.fn().mockResolvedValue('a clear sentence'),
        preloadWhisperEngine: vi.fn().mockResolvedValue(undefined),
        updateSpeechRecording: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
    return { orchestrator: createSpeechOrchestrator(deps), deps };
}

// Mirrors the real uiHooks the step executor registers, including the
// `onTranscriptRejected` transition into `recording/answering`. Without it the
// restart would run with the store still in `review`, which no shipped UI does.
// Called without `fromStepLoad`, so the store's transition table is exercised.
function reviewHooks() {
    return {
        onRecordingStart: vi.fn(),
        onMediaError: vi.fn(),
        onReviewStart: vi.fn(),
        onTranscriptRejected: vi.fn(() => {
            appStore.getState().transitionTo('recording/answering');
        }),
        onReviewEnd: vi.fn(),
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

describe('speech orchestrator — re-record is a single press', () => {
    let warnSpy;

    beforeEach(() => {
        vi.useFakeTimers();
        appStore.setState({
            // Reset appPhase explicitly: a test that asserts a transition must
            // not inherit the previous test's phase.
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

    it('restarts the take immediately — camera, 3-2-1 countdown, recording — with no second press', async () => {
        const { orchestrator, deps } = makeRecordingOrchestrator();
        const hooks = reviewHooks();
        const params = baseParams(hooks);

        await runTakeToReview(orchestrator, params);
        expect(hooks.onReviewStart).toHaveBeenCalledTimes(1);
        expect(deps.startSpeechCamRecording).toHaveBeenCalledTimes(1);

        hooks.onReviewStart.mock.calls[0][3](); // ✕ "record again"
        expect(appStore.getState().appPhase).toBe('recording/answering');

        // Re-entered the mic path exactly like the first tap.
        expect(deps.startSpeechCamRecording).toHaveBeenCalledTimes(2);

        const seen = [];
        const unsubscribe = appStore.subscribe((s) => {
            const c = s.recordingCountdown;
            if (c !== null && c !== seen[seen.length - 1]) seen.push(c);
        });
        await vi.advanceTimersByTimeAsync(3000);
        await vi.runAllTicks();
        unsubscribe();

        expect(seen).toEqual([3, 2, 1]);
        expect(appStore.getState().recordingCountdown).toBeNull();
        expect(deps.startDeferredSpeechCamRecording).toHaveBeenCalledTimes(2);
        expect(deps.startLocalAudioTap).toHaveBeenCalledTimes(2);
        expect(appStore.getState().isMicActive).toBe(true);
        expect(orchestrator.listeningState.active).toBe(true);
    });

    it('runs the UI hook before the restart so the phase is already recording/answering', async () => {
        const { orchestrator, deps } = makeRecordingOrchestrator();
        const order = [];
        const hooks = reviewHooks();
        hooks.onTranscriptRejected = vi.fn(() => {
            order.push('onTranscriptRejected');
            appStore.getState().transitionTo('recording/answering');
        });
        deps.startSpeechCamRecording.mockImplementation(async () => { order.push('startSpeechCamRecording'); });

        await runTakeToReview(orchestrator, baseParams(hooks));
        order.length = 0;

        hooks.onReviewStart.mock.calls[0][3]();
        await vi.advanceTimersByTimeAsync(10);

        expect(hooks.onTranscriptRejected).toHaveBeenCalledTimes(1);
        expect(hooks.onTranscriptRejected).toHaveBeenCalledWith('hello', 'a clear sentence');
        expect(order).toEqual(['onTranscriptRejected', 'startSpeechCamRecording']);
    });

    it('does not restart again when ✕ is pressed twice for the same transcript', async () => {
        const { orchestrator, deps } = makeRecordingOrchestrator();
        const hooks = reviewHooks();
        await runTakeToReview(orchestrator, baseParams(hooks));

        const reject = hooks.onReviewStart.mock.calls[0][3];
        reject();
        reject();
        await vi.advanceTimersByTimeAsync(10);

        expect(deps.startSpeechCamRecording).toHaveBeenCalledTimes(2); // 1 take + 1 restart
        // The `reviewActive` latch is the only thing stopping the second press:
        // without it the hook would fire again (deducting another 20 speaking
        // points in step-executor-webonly.js) and the rejected transcript would
        // be persisted twice. Both would then be refused downstream by the
        // already-recording gate, which is why the counts matter here.
        expect(hooks.onTranscriptRejected).toHaveBeenCalledTimes(1);
        expect(deps.updateSpeechRecording).toHaveBeenCalledTimes(1); // the reject's write only
    });

    it('logs success when the take restarts', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const { orchestrator } = makeRecordingOrchestrator();
            const hooks = reviewHooks();
            await runTakeToReview(orchestrator, baseParams(hooks));
            hooks.onReviewStart.mock.calls[0][3]();
            // AGENTS.md: a significant event logs on success, not only on failure.
            expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Re-record pressed — restarting the take immediately'))).toBe(true);
        } finally {
            logSpy.mockRestore();
        }
    });

    it('leaves the mic button mounted when a gate refuses the restart', async () => {
        // Each gate separately, so a failure names which one regressed. A
        // refusal must not strand the learner: onTranscriptRejected has already
        // moved the app to `recording/answering`, which mounts the mic button.
        for (const [label, arrange] of [
            ['rolling take', (o) => {
                const p = o.toggleSpeechRecognition(baseParams(reviewHooks()));
                return vi.advanceTimersByTimeAsync(3000).then(() => p);
            }],
            ['held lock', (o) => {
                o.listeningState.transitioning = true;
                return Promise.resolve();
            }],
        ]) {
            const blocked = makeRecordingOrchestrator();
            const hooks = reviewHooks();
            await runTakeToReview(blocked.orchestrator, baseParams(hooks));
            await arrange(blocked.orchestrator);
            // The ✕ must not start *another* take on top of whatever the
            // arrangement already left rolling.
            const takesBefore = blocked.deps.startDeferredSpeechCamRecording.mock.calls.length;

            hooks.onReviewStart.mock.calls[0][3]();
            await vi.advanceTimersByTimeAsync(10);

            expect(blocked.deps.startDeferredSpeechCamRecording, label).toHaveBeenCalledTimes(takesBefore);
            expect(appStore.getState().appPhase, label).toBe('recording/answering');
            expect(appStore.getState().bottomState, label).toBe('micActiveOrAnswerInput');
        }
    });

    it('refuses to restart while a take is still rolling (defence in depth)', async () => {
        // The shipped UI cannot reach this state — in `review` the bottom band
        // shows the review buttons, not the mic — so this pins the guard rather
        // than a reachable path. It matters if a future UI ever keeps the mic
        // mounted behind the overlay.
        const { orchestrator, deps } = makeRecordingOrchestrator();
        const hooks = reviewHooks();
        await runTakeToReview(orchestrator, baseParams(hooks));

        // Put the orchestrator back into "recording" before rejecting.
        const again = orchestrator.toggleSpeechRecognition(baseParams(hooks));
        await vi.advanceTimersByTimeAsync(3000);
        await again;
        expect(orchestrator.listeningState.active).toBe(true);
        expect(deps.startSpeechCamRecording).toHaveBeenCalledTimes(2);

        hooks.onReviewStart.mock.calls[0][3]();
        await vi.advanceTimersByTimeAsync(10);

        expect(deps.startSpeechCamRecording).toHaveBeenCalledTimes(2);
        // The refusal names its reason so the missing restart is never silent.
        expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('Re-record not started')
            && c.slice(1).map(String).includes('already-recording'))).toBe(true);
    });

    it('does not restart when the learner accepts (✓) instead', async () => {
        const { orchestrator, deps } = makeRecordingOrchestrator();
        const hooks = reviewHooks();
        await runTakeToReview(orchestrator, baseParams(hooks));

        hooks.onReviewStart.mock.calls[0][2](); // ✓ accept
        await vi.advanceTimersByTimeAsync(3000);

        expect(hooks.onReviewEnd).toHaveBeenCalledWith('feedback');
        expect(deps.startSpeechCamRecording).toHaveBeenCalledTimes(1);
    });

    it('surfaces the media error when the restarted take cannot get a camera', async () => {
        const cameraError = Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' });
        const { orchestrator, deps } = makeRecordingOrchestrator({
            startSpeechCamRecording: vi.fn()
                .mockResolvedValueOnce(undefined)   // first take: fine
                .mockRejectedValueOnce(cameraError) // re-record: no camera
                .mockResolvedValue(undefined),
        });
        const hooks = reviewHooks();
        await runTakeToReview(orchestrator, baseParams(hooks));

        hooks.onReviewStart.mock.calls[0][3]();
        await vi.advanceTimersByTimeAsync(10);

        expect(hooks.onMediaError).toHaveBeenCalledWith(cameraError);
        expect(appStore.getState().isMicActive).toBe(false);
        expect(orchestrator.listeningState.active).toBe(false);
        expect(deps.startDeferredSpeechCamRecording).toHaveBeenCalledTimes(1); // no second take started
    });

    it('refuses to restart while the orchestrator start/stop lock is still held', async () => {
        const { orchestrator, deps } = makeRecordingOrchestrator();
        const hooks = reviewHooks();
        await runTakeToReview(orchestrator, baseParams(hooks));

        // A real ✕ click always lands after the stop branch's `finally` has
        // released the mutex, so this is the other defence-in-depth gate.
        orchestrator.listeningState.transitioning = true;

        hooks.onReviewStart.mock.calls[0][3]();
        await vi.advanceTimersByTimeAsync(10);

        expect(deps.startSpeechCamRecording).toHaveBeenCalledTimes(1); // no second take
        expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('Re-record not started')
            && c.slice(1).map(String).includes('transitioning'))).toBe(true);
    });

    it('the reject sequence logs no unexpected phase transition', async () => {
        // The store table is asserted directly in store.test.js; this proves the
        // real reject path (a live take → review → ✕ → hook transition) stays
        // inside it, so a regression surfaces as a console warning.
        const { orchestrator } = makeRecordingOrchestrator();
        const hooks = reviewHooks();
        appStore.setState({ appPhase: 'review' });

        await runTakeToReview(orchestrator, baseParams(hooks));
        hooks.onReviewStart.mock.calls[0][3]();
        await vi.advanceTimersByTimeAsync(10);

        expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('Unexpected transition'))).toBe(false);
    });
});
