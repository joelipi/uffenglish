// Guards for the desktop 9:16 portrait-capture path (speech.web.js).
//
// iOS/Android cameras already yield a portrait frame and their MediaRecorder
// paths are fragile and working — they must keep the raw camera stream. Every
// other platform (Windows/macOS/Linux/ChromeOS) gets a 16:9 laptop camera, so
// the stream is composited into a real 1080×1920 canvas for the preview and the
// recording. These are source-shape guards because speech.web.js reads browser
// globals at module load and cannot be imported in jsdom.
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

describe('desktop portrait capture (9:16)', () => {
    it('gates the composite on a device check that excludes iOS and Android', () => {
        expect(WEB).toMatch(/import \{ isIOS \} from '\.\.\/\.\.\/utils\/detectIOS\.js'/);
        const body = functionBody(WEB, 'export function shouldUsePortraitCapture()');
        expect(body).not.toBe('');
        expect(body).toMatch(/return !isIOS\(\) && !isAndroid/);
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
        // Mobile (false branch) keeps the raw stream.
        expect(body).toMatch(/:\s*rawStream/);
    });

    it('tears the composite down alongside the camera stream', () => {
        const body = functionBody(WEB, 'export function safelyStopStream()');
        expect(body).toMatch(/teardownPortraitCapture\(\)/);
    });
});
