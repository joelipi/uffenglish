// A transcription must always settle: the learner must never be left on
// "transcribing" because a worker died or stopped replying.
// (stories/087-no-audio-capture)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWhisperAdapter, TRANSCRIPTION_TIMEOUT_MS } from './app-vad-asr-web.js';

vi.mock('../../modules/utils/posthog.js', () => ({
    captureException: vi.fn(),
}));

function makeWorker() {
    return {
        onmessage: null,
        onerror: null,
        postMessage: vi.fn(),
        terminate: vi.fn(),
    };
}

function makeAdapter() {
    const worker = makeWorker();
    const adapter = createWhisperAdapter({ worker });
    worker.onmessage({ data: { type: 'ready' } });
    return { worker, adapter };
}

describe('whisper adapter — a transcription always settles', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('resolves a timeout when the worker never replies', async () => {
        const { adapter } = makeAdapter();
        let settled;
        adapter.transcribeAudioBuffer(new Float32Array(16).fill(0.2)).then((v) => { settled = v; });

        await vi.advanceTimersByTimeAsync(TRANSCRIPTION_TIMEOUT_MS - 1);
        expect(settled).toBeUndefined();

        await vi.advanceTimersByTimeAsync(1);
        expect(settled).toEqual({ text: null, error: 'timeout' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('settles a pending transcription when the worker errors', async () => {
        const { adapter, worker } = makeAdapter();
        const pending = adapter.transcribeAudioBuffer(new Float32Array(16).fill(0.2));

        worker.onerror(new Error('worker died'));

        await expect(pending).resolves.toEqual({ text: null, error: 'worker-error' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the timeout when the result arrives', async () => {
        const { adapter, worker } = makeAdapter();
        const pending = adapter.transcribeAudioBuffer(new Float32Array(16).fill(0.2));

        worker.onmessage({ data: { type: 'result', text: 'hello' } });

        await expect(pending).resolves.toEqual({ type: 'result', text: 'hello' });
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(TRANSCRIPTION_TIMEOUT_MS + 1000);
        expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('timed out'));
    });

    it('never posts an empty buffer to the worker', async () => {
        const { adapter, worker } = makeAdapter();
        await expect(adapter.transcribeAudioBuffer(new Float32Array(0)))
            .resolves.toEqual({ text: null, error: 'empty-audio' });
        expect(worker.postMessage).not.toHaveBeenCalled();
    });

    it('settles when postMessage itself throws', async () => {
        const { adapter, worker } = makeAdapter();
        worker.postMessage.mockImplementation(() => { throw new Error('dead worker'); });

        await expect(adapter.transcribeAudioBuffer(new Float32Array(16).fill(0.2)))
            .resolves.toEqual({ text: null, error: 'post-message-failed' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('settles the superseded request instead of orphaning it', async () => {
        const { adapter, worker } = makeAdapter();
        const first = adapter.transcribeAudioBuffer(new Float32Array(16).fill(0.1));
        const second = adapter.transcribeAudioBuffer(new Float32Array(16).fill(0.2));

        await expect(first).resolves.toEqual({ text: null, error: 'superseded' });

        worker.onmessage({ data: { type: 'result', text: 'second' } });
        await expect(second).resolves.toEqual({ type: 'result', text: 'second' });
    });

    it('settles a pending transcription on terminate', async () => {
        const { adapter } = makeAdapter();
        const pending = adapter.transcribeAudioBuffer(new Float32Array(16).fill(0.2));

        adapter.terminate();

        await expect(pending).resolves.toEqual({ text: null, error: 'terminated' });
        expect(vi.getTimerCount()).toBe(0);
    });
});
