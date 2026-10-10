// Guards for the 9:16 portrait-capture path (speech.web.js).
//
// iOS cameras already yield a portrait frame and their MediaRecorder path is
// fragile and working — iOS must keep the raw camera stream. Every other
// platform (Windows/macOS/Linux/ChromeOS/Android) has a camera that routinely
// ignores `aspectRatio` and hands back a non-9:16 frame, so the stream is
// composited into a real 9:16 canvas for the preview and the recording (the
// recorded clip is reused verbatim, so the framing must be right at capture
// time). Phones build a lighter composite (720×1280 @ 24 fps) because a
// 1080×1920 canvas + software encode OOMs low-memory Android devices while the
// Whisper model is resident. These are source-shape guards because
// speech.web.js reads browser globals at module load and cannot be imported in
// jsdom.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const WEB = readFileSync(resolve(SRC, 'modules/speech/speech.web.js'), 'utf8');

// Slice one function body, stopping at the next top-level declaration so a
// later function cannot satisfy the assertions.
function functionBody(source, signature) {
    const start = source.indexOf(signature);
    if (start === -1) return '';
    const rest = source.slice(start);
    const next = rest.search(/\n(function |export function |export async function |async function |const |let )/);
    return next === -1 ? rest : rest.slice(0, next);
}

describe('portrait capture (9:16)', () => {
    it('gates the composite on a device check that excludes iOS only', () => {
        expect(WEB).toMatch(/import \{ isIOS \} from '\.\.\/\.\.\/utils\/detectIOS\.js'/);
        expect(WEB).toMatch(/const isAndroid = \/Android\/i\.test\(navigator\.userAgent\)/);
        const body = functionBody(WEB, 'export function shouldUsePortraitCapture()');
        expect(body).not.toBe('');
        expect(body).toMatch(/return !isIOS\(\)/);
        // Android must NOT be excluded — its recording must be 9:16 too.
        expect(body).not.toMatch(/isAndroid/);
    });

    it('asks the camera for a plain 16:9 source (the composite does the cropping)', () => {
        const body = functionBody(WEB, 'function getMediaConstraints()');
        expect(body).not.toBe('');
        expect(body).toMatch(/aspectRatio: \{ ideal: 16 \/ 9 \}/);
        expect(body).toMatch(/isWindows && \{ aspectRatio: \{ ideal: 9 \/ 16 \} \}/);
        // No Android-specific portrait request — the composite guarantees it.
        expect(body).not.toMatch(/isAndroid/);
    });

    it('builds a 9:16 canvas stream, centre-cropping the camera', () => {
        const body = functionBody(WEB, 'function createPortraitCaptureStream(rawStream)');
        expect(body).not.toBe('');
        // Desktop: 1080×1920; phones: 720×1280 (lighter composite).
        expect(body).toMatch(/const canvasW = isAndroid \? 720 : 1080/);
        expect(body).toMatch(/const canvasH = isAndroid \? 1280 : 1920/);
        expect(body).toMatch(/const captureFps = isAndroid \? 24 : 30/);
        expect(body).toMatch(/canvas\.captureStream\(captureFps\)/);
        // Centre-crop: draw the <video> with an explicit source rect (cover).
        expect(body).toMatch(/ctx\.drawImage\(video,/);
        // Carry the camera audio through.
        expect(body).toMatch(/rawStream\.getAudioTracks\(\)/);
    });

    it('only applies the composite when the device check passes', () => {
        const body = functionBody(WEB, 'async function ensureSpeechCamStream()');
        expect(body).not.toBe('');
        expect(body).toMatch(/shouldUsePortraitCapture\(\)/);
        expect(body).toMatch(/createPortraitCaptureStream\(rawStream\)/);
        // iOS (false branch) keeps the raw stream.
        expect(body).toMatch(/:\s*rawStream/);
    });

    it('tears the composite down alongside the camera stream', () => {
        const body = functionBody(WEB, 'export function safelyStopStream()');
        expect(body).toMatch(/teardownPortraitCapture\(\)/);
    });

    it('releases the composite on phones when recording stops (free it before transcription)', () => {
        const body = functionBody(WEB, 'export function stopSpeechCamRecording(');
        expect(body).not.toBe('');
        expect(body).toMatch(/if \(!keepStreamAlive \|\| isAndroid\) safelyStopStream\(\)/);
    });
});
