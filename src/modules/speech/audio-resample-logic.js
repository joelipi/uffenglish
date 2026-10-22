// Resampling and MIME selection for the local audio/video capture tap.
//
// Pure and dependency-free so the conversion and codec rules are unit-testable
// under Node with no DOM or AudioContext globals.

export const WHISPER_SAMPLE_RATE = 16000;

/**
 * Select the MediaRecorder MIME type for a speech/webcam take.
 *
 * iOS and Windows both prefer MP4 (`video/mp4`): on iPadOS 27, WebKit's
 * experimental `video/webm` MediaRecorder wedges on a camera+mic stream
 * (`chunks: 0`, `onstop` never fires, and the concurrent Web Audio tap reads
 * all-zero samples), whereas `video/mp4` uses the hardware H.264/AAC path that
 * passed every on-device lab test. Android and desktop Linux/macOS continue to
 * prefer WebM when supported. Never returns a MIME string that
 * `isTypeSupported` rejected.
 */
export function selectRecordingMimeType({ isWindows = false, isIOS = false, isTypeSupported = () => false } = {}) {
    const check = typeof isTypeSupported === 'function' ? isTypeSupported : () => false;
    const iosMp4Candidates = ['video/mp4'];
    const windowsMp4Candidates = ['video/mp4;codecs=h264,aac', 'video/mp4'];
    const webmCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    let ordered;
    if (isIOS) {
        ordered = [...iosMp4Candidates, ...webmCandidates];
    } else if (isWindows) {
        ordered = [...windowsMp4Candidates, ...webmCandidates];
    } else {
        ordered = [...webmCandidates, ...windowsMp4Candidates];
    }

    for (const candidate of ordered) {
        if (check(candidate)) return candidate;
    }
    return '';
}

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

/** Peak absolute sample value. */
export function peakAmplitude(samples) {
    const data = samples || [];
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
    }
    return peak;
}
