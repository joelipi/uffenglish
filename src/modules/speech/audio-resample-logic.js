// Resampling for the local audio tap.
//
// The tap used to ask WebKit for a 16 kHz AudioContext (and a 16 kHz mic
// track) so the captured buffer could go straight to Whisper. On iOS the
// hardware clock is 48 kHz, so that request makes WebKit resample the
// microphone itself — the exact step that has been observed to hand back an
// all-zero signal from a live, unmuted track (stories/087 follow-up).
//
// Capture at whatever rate the device actually provides, then convert here.
// Pure and dependency-free so the conversion is unit-testable and the same
// maths can run under Node (no AudioContext needed).

export const WHISPER_SAMPLE_RATE = 16000;

/**
 * Convert `samples` from `inputRate` to 16 kHz.
 *
 * Downsampling averages every input window that overlaps an output frame
 * (a box filter), which is enough anti-aliasing for speech recognition and
 * keeps a constant/DC signal constant. Upsampling (a device that reports a
 * rate below 16 kHz, e.g. 8 kHz Bluetooth) falls back to nearest-frame
 * repetition because there is nothing to average.
 */
export function resampleTo16k(samples, inputRate) {
    const rate = Number(inputRate) || WHISPER_SAMPLE_RATE;
    const source = samples || new Float32Array(0);
    if (rate === WHISPER_SAMPLE_RATE || source.length === 0) return source;

    const ratio = rate / WHISPER_SAMPLE_RATE;
    if (ratio < 1) {
        // Upsample: nearest input frame per output frame.
        const outLength = Math.max(1, Math.round(source.length / ratio));
        const up = new Float32Array(outLength);
        for (let i = 0; i < outLength; i++) {
            const idx = Math.min(source.length - 1, Math.floor(i * ratio));
            up[i] = source[idx];
        }
        return up;
    }

    const outLength = Math.max(1, Math.floor(source.length / ratio));
    const out = new Float32Array(outLength);

    for (let i = 0; i < outLength; i++) {
        const start = i * ratio;
        const end = start + ratio;
        const first = Math.floor(start);
        const last = Math.min(Math.ceil(end) - 1, source.length - 1);
        let sum = 0;
        let weight = 0;
        for (let j = first; j <= last; j++) {
            const overlap = Math.min(end, j + 1) - Math.max(start, j);
            if (overlap <= 0) continue;
            sum += source[j] * overlap;
            weight += overlap;
        }
        out[i] = weight > 0 ? sum / weight : 0;
    }

    return out;
}

/** Peak absolute sample value, used by the capture diagnostics. */
export function peakAmplitude(samples) {
    const data = samples || [];
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
    }
    return peak;
}
