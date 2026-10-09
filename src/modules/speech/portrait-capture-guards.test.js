// Guards for the 9:16 portrait-capture path (speech.web.js).
//
// iOS cameras already yield a portrait frame and their MediaRecorder path is
// fragile and working — iOS must keep the raw camera stream. Android also keeps
// the raw stream: the 1080×1920 canvas composite adds a second camera surface
// and a software encode that OOMs low-memory phones while Whisper is loaded, so
// Android asks the camera for a portrait frame instead (getMediaConstraints).
// Every other platform (Windows/macOS/Linux/ChromeOS) has a laptop camera that
// ignores the request, so the stream is composited into a real 1080×1920 canvas
// for the preview and the recording. These are source-shape guards because
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
    it('gates the composite on a device check that excludes iOS and Android', () => {
        expect(WEB).toMatch(/import \{ isIOS \} from '\.\.\/\.\.\/utils\/detectIOS\.js'/);
        expect(WEB).toMatch(/const isAndroid = \/Android\/i\.test\(navigator\.userAgent\)/);
        const body = functionBody(WEB, 'export function shouldUsePortraitCapture()');
        expect(body).not.toBe('');
        expect(body).toMatch(/return !isIOS\(\) && !isAndroid/);
    });

    it('asks Android for a portrait camera frame (no composite on phones)', () => {
        const body = functionBody(WEB, 'function getMediaConstraints()');
        expect(body).not.toBe('');
        expect(body).toMatch(/isWindows \|\| isAndroid/);
        expect(body).toMatch(/9 \/ 16/);
    });

    it('builds a 1080×1920 canvas stream, centre-cropping the camera', () => {
        const body = functionBody(WEB, 'function createPortraitCaptureStream(rawStream)');
        expect(body).not.toBe('');
        expect(body).toMatch(/canvas\.width = 1080/);
        expect(body).toMatch(/canvas\.height = 1920/);
        expect(body).toMatch(/canvas\.captureStream\(30\)/);
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
});
