// The preview gate must never deadlock a take (stories/092): the orchestrator
// awaits it and the preview screen's microphone resolves it. A tap can land in
// the window between the screen becoming interactive and the await registering,
// so an early resolve has to be remembered.
import { describe, it, expect, beforeEach } from 'vitest';
import {
    waitForPreviewStart,
    startRecordingFromPreview,
    resetPreviewGate,
    isPreviewGateWaiting,
} from './preview-gate.js';

describe('preview gate', () => {
    beforeEach(() => resetPreviewGate());

    it('a tap resolves a waiting take', async () => {
        const waiting = waitForPreviewStart();
        expect(isPreviewGateWaiting()).toBe(true);
        expect(startRecordingFromPreview()).toBe(true);
        await expect(waiting).resolves.toBeUndefined();
        expect(isPreviewGateWaiting()).toBe(false);
    });

    it('a tap that lands before the await is not lost', async () => {
        // The button appears before the orchestrator reaches its await.
        expect(startRecordingFromPreview()).toBe(false);
        await expect(waitForPreviewStart()).resolves.toBeUndefined();
    });

    it('an early tap is consumed once, not for the next take', async () => {
        startRecordingFromPreview();
        await waitForPreviewStart();
        // second take: nothing pending, so it waits again
        expect(isPreviewGateWaiting()).toBe(false);
    });

    it('reset clears a pending early tap', async () => {
        startRecordingFromPreview();
        resetPreviewGate();
        const waiting = waitForPreviewStart();
        expect(isPreviewGateWaiting()).toBe(true);
        startRecordingFromPreview();
        await expect(waiting).resolves.toBeUndefined();
    });
});
