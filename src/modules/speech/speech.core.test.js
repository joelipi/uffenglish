// The capture gate that keeps silence out of Whisper. A connected input can
// return a live stream that never produces a frame (field case: a Bluetooth
// microphone), so the buffer — not the stream — is the only thing that can tell
// us whether there is audio. (stories/087-no-audio-capture)
import { describe, it, expect } from 'vitest';
import { analyzeCapturedAudio, MIN_USABLE_CAPTURE_AMPLITUDE } from './speech.core.js';

describe('analyzeCapturedAudio', () => {
    it('rejects a null buffer as empty', () => {
        expect(analyzeCapturedAudio(null)).toEqual({
            usable: false, reason: 'empty', maxAmplitude: 0, length: 0,
        });
    });

    it('rejects a zero-length buffer as empty', () => {
        expect(analyzeCapturedAudio(new Float32Array(0))).toEqual({
            usable: false, reason: 'empty', maxAmplitude: 0, length: 0,
        });
    });

    it('rejects an all-zero buffer as silent', () => {
        const result = analyzeCapturedAudio(new Float32Array(32000));
        expect(result.usable).toBe(false);
        expect(result.reason).toBe('silent');
        expect(result.maxAmplitude).toBe(0);
        expect(result.length).toBe(32000);
    });

    it('rejects near-silence below the floor', () => {
        const buffer = new Float32Array(1000).fill(MIN_USABLE_CAPTURE_AMPLITUDE / 2);
        const result = analyzeCapturedAudio(buffer);
        expect(result.usable).toBe(false);
        expect(result.reason).toBe('silent');
    });

    it('accepts a speech-level buffer and reports its peak', () => {
        const buffer = new Float32Array(1000);
        buffer[400] = -0.4;
        buffer[900] = 0.25;
        const result = analyzeCapturedAudio(buffer);
        expect(result.usable).toBe(true);
        expect(result.reason).toBe('ok');
        expect(result.maxAmplitude).toBeCloseTo(0.4);
        expect(result.length).toBe(1000);
    });

    it('accepts a buffer just above the floor', () => {
        const buffer = new Float32Array(10);
        buffer[5] = MIN_USABLE_CAPTURE_AMPLITUDE * 1.01;
        expect(analyzeCapturedAudio(buffer).usable).toBe(true);
    });
});
