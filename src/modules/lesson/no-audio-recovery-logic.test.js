// The no-audio recovery must actually move the app back to a phase that mounts
// the mic button; a message with no control was the original bug.
// (stories/087-no-audio-capture)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appStore } from '../store/store.js';
import {
    applyNoAudioRecovery,
    returnToRecordingPhase,
    NO_AUDIO_MESSAGE_TYPE,
} from './no-audio-recovery-logic.js';

describe('no-audio recovery', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        appStore.setState({
            appPhase: 'processing/transcribing',
            isMicActive: true,
            mediaVisible: false,
            flowScore: 100,
            recordedAudioPeaks: { peaks: [0, 0, 0], durationMs: 2000 },
            playbackBlob: { size: 1024 },
            systemMessage: null,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('clears the dead take and returns to the recording phase', () => {
        applyNoAudioRecovery(appStore, { text: 'No audio was captured.' });

        const state = appStore.getState();
        expect(state.appPhase).toBe('recording/answering');
        expect(state.isMicActive).toBe(false);
        expect(state.recordedAudioPeaks).toBeNull();
        expect(state.playbackBlob).toBeNull();
        expect(state.mediaVisible).toBe(true);
        expect(state.systemMessage).toEqual({
            type: NO_AUDIO_MESSAGE_TYPE,
            text: 'No audio was captured.',
        });
    });

    it('does not deduct points for a device problem', () => {
        applyNoAudioRecovery(appStore, { text: 'No audio was captured.' });

        expect(appStore.getState().flowScore).toBe(100);
        expect(appStore.getState().pointLossAmount ?? 0).toBe(0);
    });

    it('does not warn when the app is already in the recording phase', () => {
        appStore.setState({ appPhase: 'recording/answering' });

        expect(returnToRecordingPhase(appStore)).toBe(false);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('is idempotent and leaves the loop-safe phase in place', () => {
        applyNoAudioRecovery(appStore, { text: 'first' });
        applyNoAudioRecovery(appStore, { text: 'second' });

        expect(appStore.getState().appPhase).toBe('recording/answering');
        expect(appStore.getState().systemMessage.text).toBe('second');
    });
});
