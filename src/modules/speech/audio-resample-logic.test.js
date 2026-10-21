import { describe, it, expect } from 'vitest';
import { resampleTo16k, peakAmplitude, WHISPER_SAMPLE_RATE } from './audio-resample-logic';

const makeSine = (frequency, rate, seconds, amplitude = 0.5) => {
    const length = Math.round(rate * seconds);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / rate);
    }
    return out;
};

const rms = (samples) => {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
};

describe('resampleTo16k', () => {
    it('returns the input untouched when it is already 16 kHz', () => {
        const input = new Float32Array([0.1, -0.2, 0.3]);
        expect(resampleTo16k(input, WHISPER_SAMPLE_RATE)).toBe(input);
    });

    it('returns the input untouched when the rate is unknown', () => {
        const input = new Float32Array([0.1, -0.2]);
        expect(resampleTo16k(input, undefined)).toBe(input);
    });

    it('handles an empty capture', () => {
        expect(resampleTo16k(new Float32Array(0), 48000).length).toBe(0);
        expect(resampleTo16k(null, 48000).length).toBe(0);
    });

    it('converts 48 kHz to one third the frames', () => {
        const input = makeSine(440, 48000, 1);
        const out = resampleTo16k(input, 48000);
        expect(out.length).toBe(16000);
    });

    it('keeps a 48 kHz speech-band tone at the same amplitude', () => {
        const input = makeSine(440, 48000, 0.5, 0.5);
        const out = resampleTo16k(input, 48000);
        // Ignore the window edges where the partial average loses energy.
        const inner = out.subarray(100, out.length - 100);
        expect(rms(inner)).toBeCloseTo(0.5 / Math.SQRT2, 1);
    });

    it('keeps a constant signal constant (no DC loss)', () => {
        const input = new Float32Array(4800).fill(0.25);
        const out = resampleTo16k(input, 48000);
        expect(out.length).toBe(1600);
        expect(Math.min(...out)).toBeCloseTo(0.25, 5);
        expect(Math.max(...out)).toBeCloseTo(0.25, 5);
    });

    it('converts 44.1 kHz (a fractional ratio) without losing the signal', () => {
        const input = makeSine(300, 44100, 0.5, 0.4);
        const out = resampleTo16k(input, 44100);
        expect(Math.abs(out.length - 8000)).toBeLessThanOrEqual(1);
        expect(rms(out.subarray(100, out.length - 100))).toBeCloseTo(0.4 / Math.SQRT2, 1);
    });

    it('upsamples an 8 kHz device capture', () => {
        const input = makeSine(300, 8000, 0.25, 0.4);
        const out = resampleTo16k(input, 8000);
        expect(out.length).toBe(4000);
        expect(rms(out)).toBeGreaterThan(0.2);
    });

    it('does not invent signal from silence', () => {
        const out = resampleTo16k(new Float32Array(4800), 48000);
        expect(peakAmplitude(out)).toBe(0);
    });
});

describe('peakAmplitude', () => {
    it('reports the largest absolute sample', () => {
        expect(peakAmplitude(new Float32Array([0.1, -0.7, 0.2]))).toBeCloseTo(0.7, 6);
    });

    it('reports zero for an empty capture', () => {
        expect(peakAmplitude(new Float32Array(0))).toBe(0);
        expect(peakAmplitude(null)).toBe(0);
    });
});
