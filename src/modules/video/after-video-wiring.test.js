// after-video-wiring.test.js
// Source guards for the display-only after-video loop
// (stories/060-autoplay-share-video). The full render handoff needs
// MediaRecorder/canvas/WebCodecs and cannot run headlessly, so the call sites
// are asserted as text — presence/shape/order only. Audible behavior and the
// pause state machine are covered by after-video-player.test.js (mocked
// media); DOM wiring by tests/after-video-loop.spec.js.
//
// Guard discipline (docs/learnings.md): URL-adjacent tokens are asserted on
// the RAW source (the comment-stripper reads `//` in paths as a comment
// start); absence tokens (visibility/pause hooks) are asserted on
// comment-stripped source so header comments cannot false-positive; every
// slice runs from its function/export start to the NEXT top-level marker
// (never EOF); sequenced calls assert index order, not co-presence.
//
// Fail-proof note: this suite was proven able to fail by temporarily
// injecting `if (document.hidden) video.pause();` into
// after-video-player.web.js (visibility guard went red) and a stray
// `onStepStart?.(tail)` into the same file (segment-purity guard went red),
// then reverting. Both injections failed exactly their guard.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sliceBetween(source, startToken, endToken) {
    const start = source.indexOf(startToken);
    if (start === -1) throw new Error(`start token missing: ${startToken}`);
    const end = source.indexOf(endToken, start + startToken.length);
    if (end === -1) throw new Error(`end token missing: ${endToken}`);
    return source.slice(start, end);
}

const processorRaw = readFileSync(path.join(ROOT, 'src/modules/video/video-processor.web.js'), 'utf8');
const controllerRaw = readFileSync(path.join(ROOT, 'src/modules/video/after-video-player.web.js'), 'utf8');
const controllerStripped = stripComments(controllerRaw);
const buttonsRaw = readFileSync(path.join(ROOT, 'src/components/widgets/SuccessButtons.jsx'), 'utf8');
const storeRaw = readFileSync(path.join(ROOT, 'src/modules/store/store.js'), 'utf8');

describe('processor tail handoff (video-processor.web.js)', () => {
    // onstop runs textually before recorder.stop()/recorder.start(), so the
    // slice covers the handler; runtime order comes from recorder semantics
    // (the handler fires after stop()) plus the calibration-before-start
    // order asserted below.
    const onstop = sliceBetween(
        processorRaw,
        'recorder.onstop = async () => {',
        'recordingStartAt = performance.now();'
    );

    it('imports the tail base and starter (raw: paths contain comment-like slashes)', () => {
        expect(processorRaw).toContain("import { AFTER_SUCCESS_BASE } from './after-video-logic.js';");
        expect(processorRaw).toContain("import { startAfterVideoLoop } from './after-video-player.web.js';");
    });

    it('starts the tail after calibration and before resolve, in that order', () => {
        expect(onstop).toContain('await startAfterVideoLoop({');
        expect(onstop).toContain('base: AFTER_SUCCESS_BASE');
        const calibrate = onstop.indexOf('calibrateSegmentRanges(rawRanges');
        const start = onstop.indexOf('await startAfterVideoLoop({');
        const resolveCall = onstop.indexOf('resolve({ blob, ext, segments })');
        expect(calibrate).toBeGreaterThan(-1);
        expect(start).toBeGreaterThan(calibrate);
        expect(resolveCall).toBeGreaterThan(start);
    });

    it('defers cleanup for the running tail instead of dropping it', () => {
        expect(onstop).toContain('cleanup({ keepAudioContext: afterVideoStarted })');
        expect(onstop).toContain('afterVideoStarted = true');
    });

    it('adopts a caller-owned AudioContext and never closes it', () => {
        expect(processorRaw).toContain('return processor.process(fluencyData, lessonId, displayCanvas, opts);');
        expect(processorRaw).toContain('opts.audioContext');
        expect(processorRaw).toContain('ownsAudioContext = false');
        expect(processorRaw).toContain('ownsAudioContext && !keepAudioContext');
    });

    it('still renders the recap exactly once (tail must not reuse the render loop)', () => {
        expect((processorRaw.match(/await executeRenderLoop\(/g) || [])).toHaveLength(1);
    });

    it('fires the range hooks only on plan steps (tail adds none)', () => {
        expect((processorRaw.match(/onStepStart\?\.\(step\)/g) || []).length).toBe(2);
        expect(controllerStripped).not.toMatch(/onStepStart/);
        expect(controllerStripped).not.toMatch(/onStepEnd/);
    });
});

describe('tail export isolation', () => {
    const exportFn = sliceBetween(
        processorRaw,
        'export async function exportSegmentsToR2',
        'export { MAX_R2_UPLOAD_BYTES };'
    );

    it('the segment/complete upload paths never reference the tail', () => {
        for (const token of ['startAfterVideoLoop', 'AFTER_SUCCESS_BASE', 'AFTER_SHARE_BASE', 'afterVideo']) {
            expect(exportFn).not.toContain(token);
        }
    });
});

describe('tail controller shape (after-video-player.web.js)', () => {
    it('exposes the start/swap/stop/toggle/read API', () => {
        for (const token of [
            'export async function startAfterVideoLoop',
            'export async function swapAfterVideoLoop',
            'export async function toggleAfterVideo',
            'export function isAfterVideoPaused',
            'export function getActiveAfterVideoBase',
            'export function stopAfterVideoLoop',
            'export function createSharedAudioContext',
        ]) {
            expect(controllerRaw).toContain(token);
        }
    });

    it('plays the element muted, looping, and inline', () => {
        expect(controllerRaw).toContain("loop.video.id = 'afterVideo'");
        expect(controllerRaw).toContain('video.muted = true;');
        expect(controllerRaw).toContain('video.loop = true;');
        expect(controllerRaw).toContain('webkit-playsinline');
    });

    it('drives audibility through a looping WebAudio buffer, in fetch → decode → loop order', () => {
        // Stripped source: the header comment names all three, so order must
        // come from code tokens only.
        const fetchAt = controllerStripped.indexOf('await fetch(url)');
        const decodeAt = controllerStripped.indexOf('decodeAudioData');
        const loopAt = controllerStripped.indexOf('source.loop = true;');
        expect(fetchAt).toBeGreaterThan(-1);
        expect(decodeAt).toBeGreaterThan(fetchAt);
        expect(loopAt).toBeGreaterThan(decodeAt);
        expect(controllerRaw).toContain('createBufferSource');
    });

    it('draws through the shared cover-layout helper on animation frames', () => {
        expect(controllerRaw).toContain('calculateLayout(');
        expect(controllerRaw).toContain('requestAnimationFrame');
    });

    it('registers no visibility/pagehide auto-pause (stripped: header comments must not count)', () => {
        expect(controllerStripped).not.toMatch(/visibilitychange/);
        expect(controllerStripped).not.toMatch(/pagehide/);
        expect(controllerStripped).not.toMatch(/document\.hidden/);
    });

    it('swap is a safe no-op without a loop and builds the replacement first', () => {
        const swap = sliceBetween(
            controllerRaw,
            'export async function swapAfterVideoLoop',
            'export async function toggleAfterVideo'
        );
        expect(swap).toContain('if (!activeLoop) return null;');
        const build = swap.indexOf('await buildLoopPlayback(');
        const teardown = swap.indexOf('teardownPlayback(activeLoop)');
        expect(build).toBeGreaterThan(-1);
        expect(teardown).toBeGreaterThan(build);
    });

    it('stop and start drive the store flag', () => {
        expect(controllerRaw).toContain('setAfterVideoActive(base)');
        expect(controllerRaw).toContain('setAfterVideoActive(null)');
    });
});

describe('SuccessButtons tail wiring (SuccessButtons.jsx)', () => {
    const runProcessing = sliceBetween(
        buttonsRaw,
        'const runProcessing = useCallback(async',
        'const handleProcess = async () => {'
    );
    const handleShare = sliceBetween(
        buttonsRaw,
        'const handleShare = async () => {',
        "if (button.state === 'idle') {"
    );

    it('imports the tail bases from the pure logic module (raw)', () => {
        expect(buttonsRaw).toContain("import { AFTER_SUCCESS_BASE, AFTER_SHARE_BASE } from '../../modules/video/after-video-logic.js';");
    });

    it('passes the gesture-unlocked context into the render', () => {
        expect(runProcessing).toContain('processVideo(fluencyData, lessonId, canvas, { audioContext:');
        expect(buttonsRaw).toContain('await ensureSharedAudioContext();');
        expect(buttonsRaw).toContain('createSharedAudioContext(audioContextRef.current)');
    });

    it('keeps the canvas visible exactly when the tail is running', () => {
        expect(runProcessing).toContain('getActiveAfterVideoBase');
        expect(runProcessing).toContain('AFTER_SUCCESS_BASE');
        const read = runProcessing.indexOf('getActiveAfterVideoBase()');
        const show = runProcessing.indexOf('setCanvasVisible(');
        expect(read).toBeGreaterThan(-1);
        expect(show).toBeGreaterThan(read);
    });

    it('swaps to the post-share video before sharing, preserving the share', () => {
        expect(handleShare).toContain('swapAfterVideoLoop(AFTER_SHARE_BASE');
        expect(handleShare).toContain('shareHandlerRef.current()');
        expect(handleShare.indexOf('swapAfterVideoLoop(AFTER_SHARE_BASE'))
            .toBeLessThan(handleShare.indexOf('shareHandlerRef.current()'));
    });

    it('ignores re-taps while a share is in flight and always resets', () => {
        // A concurrent navigator.share() is rejected by the platform, and
        // stacked taps pile silent transcodes behind a dead-looking button.
        expect(handleShare).toContain('if (sharingRef.current) return;');
        expect(handleShare.indexOf('sharingRef.current = true;'))
            .toBeLessThan(handleShare.indexOf('swapAfterVideoLoop(AFTER_SHARE_BASE'));
        expect(handleShare).toContain('await shareHandlerRef.current();');
        expect(handleShare).toContain('setSharing(false);');
    });

    it('disables the Share button with a spinner while sharing', () => {
        expect(buttonsRaw).toContain('const [sharing, setSharing] = useState(false);');
        expect(buttonsRaw).toContain('disabled={sharing}');
    });

    it('treats sheet dismissal as benign, keeping real share errors fatal', () => {
        const raw = readFileSync(path.join(ROOT, 'src/modules/video/video-share.web.js'), 'utf8');
        expect(raw).toContain("console.log('[VideoShare] starting share:'");
        expect(raw).toContain("if (e?.name === 'AbortError') {");
        expect(raw).toContain("console.log('[VideoShare] share dismissed by user');");
        expect(raw).toContain("console.log('[VideoShare] share completed');");
    });

    it('releases the caller-owned context on unmount', () => {
        const teardown = sliceBetween(
            buttonsRaw,
            '// Release the caller-owned context',
            'const runProcessing = useCallback(async'
        );
        expect(teardown).toContain('ctx.close()');
        expect(teardown).toContain('audioContextRef.current = null;');
    });
});

describe('store tail flag (store.js)', () => {
    it('declares the flag and its setter', () => {
        expect(storeRaw).toContain('afterVideoActive: null,');
        expect(storeRaw).toContain('setAfterVideoActive: (base) => set({ afterVideoActive: base })');
    });

    it('clears the flag in every success-screen reset path', () => {
        const next = sliceBetween(storeRaw, 'resetForNextStep: () => set({', 'resetForNewLesson: () => set({');
        const lesson = sliceBetween(storeRaw, 'resetForNewLesson: () => set({', '// --- Input UI Actions');
        const hide = sliceBetween(storeRaw, 'hideSuccessScreen: () => set({', 'setSuccessContinueLoading');
        for (const block of [next, lesson, hide]) {
            expect(block).toContain('afterVideoActive: null');
        }
    });
});

describe('success-surface tail gating', () => {
    it('SuccessVideo yields the frame to the running loop', () => {
        const raw = readFileSync(path.join(ROOT, 'src/components/widgets/SuccessVideo.jsx'), 'utf8');
        expect(raw).toContain('afterVideoActive');
        expect(raw).toContain('if (!blob || afterVideoActive) return null;');
    });

    it('SuccessVideoCanvas exposes the tap surface and stops the loop on unmount', () => {
        const raw = readFileSync(path.join(ROOT, 'src/components/widgets/SuccessVideoCanvas.jsx'), 'utf8');
        expect(raw).toContain('data-testid="after-video-canvas"');
        expect(raw).toContain('toggleAfterVideo');
        expect(raw).toContain('stopAfterVideoLoop');
    });
});
