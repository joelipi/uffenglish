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
    it('Phase 1: freeze reporter wired in startDeferredSpeechCamRecording', () => {
        const body = functionBody(WEB, 'export async function startDeferredSpeechCamRecording()');
        expect(body).not.toBe('');
        expect(body).toMatch(/createFreezeReporter\(/);
        expect(body).toMatch(/\.start\(\)/);
    });

    it('gates the composite on a device check that excludes iOS only', () => {
        expect(WEB).toMatch(/import \{ isIOS \} from '\.\.\/\.\.\/utils\/detectIOS\.js'/);
        expect(WEB).toMatch(/const isAndroid = \/Android\/i\.test\(navigator\.userAgent\)/);
        // The rule itself is pure and tested behaviourally in
        // portrait-capture-logic.test.js; the adapter must delegate, never
        // re-implement it (stories/091 added the look opt-in).
        const body = functionBody(WEB, 'export function shouldUsePortraitCapture(');
        expect(body).not.toBe('');
        expect(body).toMatch(/shouldCompositeForLook\(/);
        expect(body).not.toMatch(/return !isIOS\(\)/);
        // Android must NOT be excluded — its recording must be 9:16 too.
        expect(body).not.toMatch(/isAndroid/);
    });

    it('asks the camera for a plain 16:9 source (the composite does the cropping)', () => {
        const body = functionBody(WEB, 'function getMediaConstraints()');
        expect(body).not.toBe('');
        expect(body).toMatch(/aspectRatio: \{ ideal: 16 \/ 9 \}/);
        expect(body).toMatch(/isWindows && \{ aspectRatio: \{ ideal: 9 \/ 16 \} \}/);
        // No Android-specific portrait request — the composite guarantees it.
        // The only 9:16 ask is the existing Windows webcam override.
        expect(body.match(/ideal: 9 \/ 16/g) || []).toHaveLength(1);
        // The composite's hidden <video> decodes and scales the camera on every
        // painted frame, so the source is bounded: a 4K feed is latency that
        // lands in the take as A/V drift.
        expect(body).toMatch(/width: \{ ideal: isAndroid \? 1280 : 1920 \}/);
        expect(body).toMatch(/height: \{ ideal: isAndroid \? 720 : 1080 \}/);
        expect(body).toMatch(/frameRate: \{ ideal: 30, max: 30 \}/);
        // iOS records the raw camera and must keep its portrait constraints.
        expect(body).toMatch(/boundedSource = !isIOS\(\)/);
    });

    it('builds a 9:16 canvas stream, centre-cropping the camera', () => {
        const body = functionBody(WEB, 'function createPortraitCaptureStream(rawStream)');
        expect(body).not.toBe('');
        // Dimensions + crop math moved to portrait-capture-logic.js (resolveCompositeDimensions,
        // compositeCropRect, paintCompositeFrame) and are tested behaviourally there.
        // The adapter must still call them and carry the camera audio through.
        expect(body).toMatch(/resolveCompositeDimensions\(\{ isAndroid, isIOS: isIOS\(\) \}\)/);
        expect(body).toMatch(/compositeCropRect\(/);
        expect(body).toMatch(/paintCompositeFrame\(/);
        expect(body).toMatch(/canvas\.captureStream\(dims\.fps\)/);
        // Carry the camera audio through.
        expect(body).toMatch(/rawStream\.getAudioTracks\(\)/);
        // The adapter must not call ctx.drawImage directly anymore.
        expect(body).not.toMatch(/ctx\.drawImage\(/);
    });

    it('paints a composite frame only when the camera has a new one', () => {
        const body = functionBody(WEB, 'function createPortraitCaptureStream(rawStream)');
        expect(body).not.toBe('');
        // `captureStream` timestamps a frame when the canvas is painted, so a
        // repaint per display tick (twice per camera frame on a 120 Hz iPad)
        // buys no freshness and costs the encoder the time it needs — the
        // recorded picture then trails the live microphone (A/V drift).
        expect(body).toMatch(/video\.requestVideoFrameCallback\(onSourceFrame\)/);
        expect(body).toMatch(/shouldPaintCompositeFrame\(\{ hasFrameCallback, framePending \}\)/);
        // rAF stays as the scheduler/fallback, so a platform without the
        // callback still paints every tick.
        expect(body).toMatch(/requestAnimationFrame\(tick\)/);
        // The measured latency goes to the take diagnostics, so a field report
        // quantifies the drift instead of describing it.
        expect(body).toMatch(/takeDiagnostics\.push\('composite lag'/);
        // The soft-focus pass takes the frame straight from the camera <video>
        // instead of reading back the canvas it just painted (that readback is
        // the expensive part on a phone).
        expect(body).toMatch(/sourceDraw: rect/);
        expect(body).toMatch(/targetCtx\.drawImage\(\s*video,/);
    });

    it('only applies the composite when the device check passes', () => {
        const body = functionBody(WEB, 'async function ensureSpeechCamStream()');
        expect(body).not.toBe('');
        expect(body).toMatch(/shouldUsePortraitCapture\(\{/);
        // The look opt-in (stories/092): the preview step, or an explicit look.
        expect(body).toMatch(/lookActive/);
        expect(body).toMatch(/isPreviewGateStep\(step\)/);
        expect(body).toMatch(/createPortraitCaptureStream\(rawStream\)/);
        // iOS (false branch) keeps the raw stream.
        expect(body).toMatch(/:\s*rawStream/);
    });

    it('Phase 1: pure-module wiring in createPortraitCaptureStream', () => {
        const body = functionBody(WEB, 'function createPortraitCaptureStream(rawStream)');
        expect(body).not.toBe('');
        expect(body).toMatch(/resolveCompositeDimensions\(/);
        expect(body).toMatch(/compositeCropRect\(/);
        expect(body).toMatch(/paintCompositeFrame\(/);
        expect(body).toMatch(/createLivenessCounter\(/);
        expect(body).toMatch(/requestAnimationFrame\(/);
        expect(body).toMatch(/resolveCompositeWatchdog\(/);
        // Canvas must be appended to the DOM.
        expect(body).toMatch(/document\.body\.appendChild\(canvas\)/);
        // Adapter must not call ctx.drawImage directly.
        expect(body).not.toMatch(/ctx\.drawImage\(/);
        // compositeCropRect must precede paintCompositeFrame.
        expect(body.indexOf('compositeCropRect(')).toBeLessThan(body.indexOf('paintCompositeFrame('));
    });

    it('Phase 1: audio passthrough preserved', () => {
        const body = functionBody(WEB, 'function createPortraitCaptureStream(rawStream)');
        expect(body).toMatch(/rawStream\.getAudioTracks\(\)/);
    });

    it('Phase 1: imports the pure module', () => {
        expect(WEB).toMatch(/from '\.\/portrait-capture-logic\.js'/);
    });

    it('tears the composite down alongside the camera stream', () => {
        const body = functionBody(WEB, 'export function safelyStopStream()');
        expect(body).toMatch(/teardownPortraitCapture\(\)/);
    });

    it('teardown cancels rAF and watchdog handles', () => {
        const body = functionBody(WEB, 'function teardownPortraitCapture()');
        expect(body).not.toBe('');
        expect(body).toMatch(/cancelAnimationFrame/);
        expect(body).toMatch(/clearInterval/);
    });

    it('releases the composite on phones when recording stops (free it before transcription)', () => {
        const body = functionBody(WEB, 'export function stopSpeechCamRecording(');
        expect(body).not.toBe('');
        // Both stop paths now route through shouldForceReleaseComposite instead of
        // the old literal `if (!keepStreamAlive || isAndroid)`. The Android
        // release is preserved for real takes; the never-started abort is exempted.
        const releaseSites = body.match(/shouldForceReleaseComposite\(/g) || [];
        expect(releaseSites.length).toBe(2);
        // The recordingStarted check must use recorder state captured before nulling.
        expect(body).toMatch(/shouldForceReleaseComposite\(\{[^}]*recordingStarted/);
    });
});
