import { describe, it, expect, vi } from 'vitest';
import {
    COMPOSITE_STALL_MS,
    COMPOSITE_FROZEN_MS,
    COMPOSITE_WATCHDOG_MS,
    resolveCompositeDimensions,
    compositeCropRect,
    paintCompositeFrame,
    createLivenessCounter,
    shouldForceReleaseComposite,
    syncWebcamPreviewElement,
    isTakeFrozen,
    createFreezeReporter,
    resolveCompositeWatchdog,
    // Recording looks (stories/091): `?beauty=` + `?overlay=`.
    resolveBeautyModeFromSearch,
    resolveOverlayModeFromSearch,
    resolveOverlayDestRect,
    shouldCompositeForLook,
    // Recording looks (stories/092): the lens effects reuse these painters.
    BEAUTY_PRESETS,
    paintBeautyPass,
    paintSoftFocus,
    paintFrost,
} from './portrait-capture-logic.js';

describe('resolveCompositeDimensions', () => {
    it('phone dims', () => {
        expect(resolveCompositeDimensions({ isAndroid: true })).toEqual({ width: 720, height: 1280, fps: 24 });
    });
    it('desktop dims', () => {
        expect(resolveCompositeDimensions({ isAndroid: false })).toEqual({ width: 1080, height: 1920, fps: 30 });
    });
    it('is deterministic', () => {
        expect(resolveCompositeDimensions({ isAndroid: true })).toEqual(resolveCompositeDimensions({ isAndroid: true }));
    });
});

describe('compositeCropRect', () => {
    it('landscape source into portrait canvas crops sides', () => {
        const r = compositeCropRect({ videoWidth: 1280, videoHeight: 720, canvasWidth: 1080, canvasHeight: 1920 });
        expect(r.sh).toBe(720);
        expect(r.sw).toBe(405);
        expect(r.sx).toBe(437.5);
        expect(r.sy).toBe(0);
        expect(r.sx + r.sw / 2).toBe(640);
    });
    it('portrait source already 9:16, no crop', () => {
        const r = compositeCropRect({ videoWidth: 720, videoHeight: 1280, canvasWidth: 1080, canvasHeight: 1920 });
        expect(r).toEqual({ sw: 720, sh: 1280, sx: 0, sy: 0 });
    });
    it('taller-than-9:16 source crops top/bottom', () => {
        const r = compositeCropRect({ videoWidth: 600, videoHeight: 1600, canvasWidth: 1080, canvasHeight: 1920 });
        const sh = 600 / (1080 / 1920);
        expect(r.sw).toBe(600);
        expect(r.sh).toBe(sh);
        expect(r.sy).toBe((1600 - sh) / 2);
        expect(r.sx).toBe(0);
    });
    it('returns null for zero/NaN/non-finite dims', () => {
        expect(compositeCropRect({ videoWidth: 0, videoHeight: 720, canvasWidth: 1080, canvasHeight: 1920 })).toBeNull();
        expect(compositeCropRect({ videoWidth: 1280, videoHeight: 0, canvasWidth: 1080, canvasHeight: 1920 })).toBeNull();
        expect(compositeCropRect({ videoWidth: NaN, videoHeight: 720, canvasWidth: 1080, canvasHeight: 1920 })).toBeNull();
        expect(compositeCropRect({ videoWidth: 1280, videoHeight: 720, canvasWidth: 0, canvasHeight: 1920 })).toBeNull();
    });
});

describe('paintCompositeFrame', () => {
    it('paints and returns true', () => {
        const spy = vi.fn();
        const ctx = { drawImage: spy };
        const rect = { sx: 1, sy: 2, sw: 3, sh: 4 };
        const ok = paintCompositeFrame({ ctx, video: { id: 'v' }, rect, canvasWidth: 1080, canvasHeight: 1920 });
        expect(ok).toBe(true);
        expect(spy).toHaveBeenCalledWith({ id: 'v' }, 1, 2, 3, 4, 0, 0, 1080, 1920);
    });
    it('returns false and does not call drawImage when rect is null', () => {
        const spy = vi.fn();
        const ctx = { drawImage: spy };
        const ok = paintCompositeFrame({ ctx, video: {}, rect: null, canvasWidth: 1080, canvasHeight: 1920 });
        expect(ok).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });
    it('returns false and does not rethrow when drawImage throws', () => {
        const ctx = { drawImage: () => { throw new Error('boom'); } };
        let threw = false;
        let ok;
        try { ok = paintCompositeFrame({ ctx, video: {}, rect: { sx: 0, sy: 0, sw: 1, sh: 1 }, canvasWidth: 10, canvasHeight: 10 }); }
        catch (e) { threw = true; }
        expect(threw).toBe(false);
        expect(ok).toBe(false);
    });
});

describe('createLivenessCounter', () => {
    it('starts at zero', () => {
        const c = createLivenessCounter();
        expect(c.snapshot()).toEqual({ framesDrawn: 0, sourceAdvances: 0 });
    });
    it('counts paints', () => {
        const c = createLivenessCounter();
        c.recordPaint(); c.recordPaint(); c.recordPaint();
        expect(c.snapshot().framesDrawn).toBe(3);
    });
    it('resets', () => {
        const c = createLivenessCounter();
        c.recordPaint();
        c.reset();
        expect(c.snapshot()).toEqual({ framesDrawn: 0, sourceAdvances: 0 });
    });
    it('two counters are independent', () => {
        const a = createLivenessCounter();
        const b = createLivenessCounter();
        a.recordPaint();
        expect(a.snapshot().framesDrawn).toBe(1);
        expect(b.snapshot().framesDrawn).toBe(0);
    });
});

describe('shouldForceReleaseComposite', () => {
    it('Android + recorded → true', () => {
        expect(shouldForceReleaseComposite({ isAndroid: true, keepStreamAlive: true, recordingStarted: true })).toBe(true);
    });
    it('iOS + recorded → true', () => {
        expect(shouldForceReleaseComposite({ isAndroid: false, isIOS: true, keepStreamAlive: true, recordingStarted: true })).toBe(true);
    });
    it('iOS + never-started → false', () => {
        expect(shouldForceReleaseComposite({ isAndroid: false, isIOS: true, keepStreamAlive: true, recordingStarted: false })).toBe(false);
    });
    it('Android + never-started → false', () => {
        expect(shouldForceReleaseComposite({ isAndroid: true, keepStreamAlive: true, recordingStarted: false })).toBe(false);
    });
    it('Android + keepStreamAlive false → true', () => {
        expect(shouldForceReleaseComposite({ isAndroid: true, keepStreamAlive: false, recordingStarted: false })).toBe(true);
    });
    it('non-Android + keepStreamAlive true + recorded → false', () => {
        expect(shouldForceReleaseComposite({ isAndroid: false, keepStreamAlive: true, recordingStarted: true })).toBe(false);
    });
    it('non-Android + keepStreamAlive false → true', () => {
        expect(shouldForceReleaseComposite({ isAndroid: false, keepStreamAlive: false, recordingStarted: false })).toBe(true);
    });
});

describe('syncWebcamPreviewElement', () => {
    it('is a no-op when video is null', () => {
        expect(() => syncWebcamPreviewElement(null, { id: 's' }, true)).not.toThrow();
    });

    it('attaches srcObject without calling play while hidden (show=false)', () => {
        const video = { srcObject: null, play: vi.fn(), pause: vi.fn() };
        const stream = { id: 's' };
        syncWebcamPreviewElement(video, stream, false);
        expect(video.srcObject).toBe(stream);
        expect(video.play).not.toHaveBeenCalled();
    });

    it('calls play when the preview becomes visible (show=true)', () => {
        const video = { srcObject: null, play: vi.fn(() => Promise.resolve()), pause: vi.fn() };
        const stream = { id: 's' };
        syncWebcamPreviewElement(video, stream, false);
        expect(video.play).not.toHaveBeenCalled();

        syncWebcamPreviewElement(video, stream, true);
        expect(video.srcObject).toBe(stream);
        expect(video.play).toHaveBeenCalledTimes(1);
    });

    it('pauses and clears srcObject when stream is null', () => {
        const video = { srcObject: { id: 's' }, play: vi.fn(), pause: vi.fn() };
        syncWebcamPreviewElement(video, null, false);
        expect(video.pause).toHaveBeenCalledTimes(1);
        expect(video.srcObject).toBeNull();
    });
});

describe('isTakeFrozen', () => {
    it('both unchanged past threshold → true', () => {
        expect(isTakeFrozen({ framesDrawn: 5, sourceAdvances: 3, baselineFramesDrawn: 5, baselineSourceAdvances: 3, nowMs: 10000, recordingStartedAtMs: 6000 })).toBe(true);
    });
    it('one ms short → false', () => {
        expect(isTakeFrozen({ framesDrawn: 5, sourceAdvances: 3, baselineFramesDrawn: 5, baselineSourceAdvances: 3, nowMs: 8999, recordingStartedAtMs: 6000 })).toBe(false);
    });
    it('framesDrawn advanced → false', () => {
        expect(isTakeFrozen({ framesDrawn: 6, sourceAdvances: 3, baselineFramesDrawn: 5, baselineSourceAdvances: 3, nowMs: 10000, recordingStartedAtMs: 6000 })).toBe(false);
    });
    it('sourceAdvances advanced → false', () => {
        expect(isTakeFrozen({ framesDrawn: 5, sourceAdvances: 4, baselineFramesDrawn: 5, baselineSourceAdvances: 3, nowMs: 10000, recordingStartedAtMs: 6000 })).toBe(false);
    });
    it('recordingStartedAtMs null → false', () => {
        expect(isTakeFrozen({ framesDrawn: 0, sourceAdvances: 0, baselineFramesDrawn: 0, baselineSourceAdvances: 0, nowMs: 10000, recordingStartedAtMs: null })).toBe(false);
    });
});

describe('createFreezeReporter', () => {
    function makeDeps(overrides = {}) {
        let now = 0;
        const counter = { framesDrawn: 0, sourceAdvances: 0 };
        const deps = {
            snapshotCounter: () => ({ framesDrawn: counter.framesDrawn, sourceAdvances: counter.sourceAdvances }),
            nowMs: () => now,
            getMeta: () => ({ lessonId: 'a', stepIndex: 1, responseType: 'friendClosedResponse' }),
            getMessage: () => 'frozen msg',
            onConsoleError: vi.fn(),
            onTrackEvent: vi.fn(),
            onUserMessage: vi.fn(),
            ...overrides,
        };
        return { deps, counter, setNow: (v) => { now = v; }, advanceNow: (d) => { now += d; } };
    }

    it('reports once when frozen past threshold', () => {
        const { deps, counter, setNow, advanceNow } = makeDeps();
        const reporter = createFreezeReporter(deps);
        setNow(0);
        reporter.start();
        advanceNow(COMPOSITE_FROZEN_MS + 1);
        const r1 = reporter.tick();
        expect(r1).toBe(true);
        expect(deps.onConsoleError).toHaveBeenCalledOnce();
        expect(deps.onConsoleError.mock.calls[0][0]).toMatch(/^\[Recording\] take produced no camera frames/);
        expect(deps.onTrackEvent).toHaveBeenCalledOnce();
        expect(deps.onTrackEvent.mock.calls[0][0]).toBe('camera_frozen');
        expect(deps.onTrackEvent.mock.calls[0][1]).toMatchObject({ lessonId: 'a', stepIndex: 1, responseType: 'friendClosedResponse' });
        expect(deps.onUserMessage).toHaveBeenCalledOnce();
        expect(deps.onUserMessage).toHaveBeenCalledWith('frozen msg');
    });

    it('does not report again on subsequent ticks', () => {
        const { deps, setNow, advanceNow } = makeDeps();
        const reporter = createFreezeReporter(deps);
        setNow(0);
        reporter.start();
        advanceNow(COMPOSITE_FROZEN_MS + 1);
        reporter.tick();
        const callsBefore = deps.onConsoleError.mock.calls.length;
        reporter.tick();
        reporter.tick();
        reporter.tick();
        expect(deps.onConsoleError.mock.calls.length).toBe(callsBefore);
        expect(reporter.didReport()).toBe(true);
    });

    it('does not report when counters advance', () => {
        const { deps, counter, setNow, advanceNow } = makeDeps();
        const reporter = createFreezeReporter(deps);
        setNow(0);
        reporter.start();
        advanceNow(COMPOSITE_FROZEN_MS + 1);
        counter.framesDrawn = 1;
        const r = reporter.tick();
        expect(r).toBe(false);
        expect(deps.onConsoleError).not.toHaveBeenCalled();
        expect(reporter.didReport()).toBe(false);
    });

    it('tick before start does nothing', () => {
        const { deps } = makeDeps();
        const reporter = createFreezeReporter(deps);
        const r = reporter.tick();
        expect(r).toBe(false);
        expect(deps.onConsoleError).not.toHaveBeenCalled();
    });

    it('reset then start reports again', () => {
        const { deps, setNow, advanceNow } = makeDeps();
        const reporter = createFreezeReporter(deps);
        setNow(0);
        reporter.start();
        advanceNow(COMPOSITE_FROZEN_MS + 1);
        reporter.tick();
        reporter.reset();
        setNow(0);
        reporter.start();
        advanceNow(COMPOSITE_FROZEN_MS + 1);
        const r = reporter.tick();
        expect(r).toBe(true);
        expect(deps.onConsoleError).toHaveBeenCalledTimes(2);
    });

    it('reports at the point the stall passes the threshold', () => {
        const { deps, counter, setNow, advanceNow } = makeDeps();
        const reporter = createFreezeReporter(deps);
        setNow(0);
        reporter.start();
        // advance halfway — no report
        advanceNow(COMPOSITE_FROZEN_MS / 2);
        expect(reporter.tick()).toBe(false);
        // advance past threshold — report
        advanceNow(COMPOSITE_FROZEN_MS / 2 + 1);
        expect(reporter.tick()).toBe(true);
    });
});

describe('resolveCompositeWatchdog', () => {
    it('wait before metadata', () => {
        expect(resolveCompositeWatchdog({ hasEverHadMetadata: false, readyState: 0, paused: false, ended: false, lastSourceAdvanceAtMs: null, nowMs: 100 })).toBe('wait');
    });
    it('wait even when paused before metadata', () => {
        expect(resolveCompositeWatchdog({ hasEverHadMetadata: false, readyState: 0, paused: true, ended: false, lastSourceAdvanceAtMs: null, nowMs: 100 })).toBe('wait');
    });
    it('resume when paused', () => {
        expect(resolveCompositeWatchdog({ hasEverHadMetadata: true, readyState: 4, paused: true, ended: false, lastSourceAdvanceAtMs: 100, nowMs: 200 })).toBe('resume');
    });
    it('idle when ended even if paused', () => {
        expect(resolveCompositeWatchdog({ hasEverHadMetadata: true, readyState: 4, paused: true, ended: true, lastSourceAdvanceAtMs: 100, nowMs: 200 })).toBe('idle');
    });
    it('resume at stall boundary (inclusive)', () => {
        expect(resolveCompositeWatchdog({ hasEverHadMetadata: true, readyState: 4, paused: false, ended: false, lastSourceAdvanceAtMs: 0, nowMs: COMPOSITE_STALL_MS })).toBe('resume');
    });
    it('idle one ms short of stall threshold', () => {
        expect(resolveCompositeWatchdog({ hasEverHadMetadata: true, readyState: 4, paused: false, ended: false, lastSourceAdvanceAtMs: 0, nowMs: COMPOSITE_STALL_MS - 1 })).toBe('idle');
    });
    it('idle when never advanced but has metadata and ready', () => {
        expect(resolveCompositeWatchdog({ hasEverHadMetadata: true, readyState: 4, paused: false, ended: false, lastSourceAdvanceAtMs: null, nowMs: 100 })).toBe('idle');
    });
    it('resume when readyState < 2 after metadata', () => {
        expect(resolveCompositeWatchdog({ hasEverHadMetadata: true, readyState: 1, paused: false, ended: false, lastSourceAdvanceAtMs: 100, nowMs: 200 })).toBe('resume');
    });
    it('idle when live', () => {
        expect(resolveCompositeWatchdog({ hasEverHadMetadata: true, readyState: 4, paused: false, ended: false, lastSourceAdvanceAtMs: 200, nowMs: 200 })).toBe('idle');
    });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('recording looks (stories/091)', () => {
    it('no flags → both looks off', () => {
        expect(resolveBeautyModeFromSearch('')).toBe('none');
        expect(resolveOverlayModeFromSearch('')).toBe('none');
    });

    it('unknown value → none, never throws', () => {
        expect(resolveBeautyModeFromSearch('?beauty=insta')).toBe('none');
        expect(resolveOverlayModeFromSearch('?overlay=nope')).toBe('none');
    });

    it('explicit none → none', () => {
        expect(resolveBeautyModeFromSearch('?beauty=none')).toBe('none');
        expect(resolveOverlayModeFromSearch('?overlay=none')).toBe('none');
    });

    it('the three beauty presets resolve', () => {
        expect(resolveBeautyModeFromSearch('?beauty=soft')).toBe('soft');
        expect(resolveBeautyModeFromSearch('?beauty=glow')).toBe('glow');
        expect(resolveBeautyModeFromSearch('?beauty=warm')).toBe('warm');
    });

    it('the three props resolve', () => {
        expect(resolveOverlayModeFromSearch('?overlay=hat')).toBe('hat');
        expect(resolveOverlayModeFromSearch('?overlay=desk')).toBe('desk');
        expect(resolveOverlayModeFromSearch('?overlay=frame')).toBe('frame');
    });

    it('top placement anchors to the top edge at full width, aspect preserved', () => {
        const rect = resolveOverlayDestRect({
            imageWidth: 720, imageHeight: 420, canvasWidth: 720, canvasHeight: 1280, placement: 'top',
        });
        expect(rect.dy).toBe(0);
        expect(rect.dx).toBe(0);
        expect(rect.dw).toBe(720);
        expect(rect.dh).toBe(420);
    });

    it('bottom placement ends exactly at the canvas bottom', () => {
        const rect = resolveOverlayDestRect({
            imageWidth: 720, imageHeight: 300, canvasWidth: 720, canvasHeight: 1280, placement: 'bottom',
        });
        expect(rect.dy + rect.dh).toBe(1280);
        expect(rect.dw).toBe(720);
    });

    it('full placement cover-fits the canvas', () => {
        const rect = resolveOverlayDestRect({
            imageWidth: 720, imageHeight: 1280, canvasWidth: 1080, canvasHeight: 1920, placement: 'full',
        });
        expect(rect.dw).toBeGreaterThanOrEqual(1080);
        expect(rect.dh).toBeGreaterThanOrEqual(1920);
        // aspect preserved
        expect(rect.dw / rect.dh).toBeCloseTo(720 / 1280, 2);
    });

    it('a prop wider than the canvas scales down (never overflows the width)', () => {
        const rect = resolveOverlayDestRect({
            imageWidth: 1440, imageHeight: 600, canvasWidth: 720, canvasHeight: 1280, placement: 'top',
        });
        expect(rect.dw).toBe(720);
        expect(rect.dx + rect.dw).toBeLessThanOrEqual(720);
    });

    it('missing / zero image dimensions → null (caller draws nothing)', () => {
        expect(resolveOverlayDestRect({ imageWidth: 0, imageHeight: 300, canvasWidth: 720, canvasHeight: 1280, placement: 'top' })).toBeNull();
        expect(resolveOverlayDestRect({ imageWidth: 720, imageHeight: 0, canvasWidth: 720, canvasHeight: 1280, placement: 'top' })).toBeNull();
        expect(resolveOverlayDestRect({ canvasWidth: 720, canvasHeight: 1280, placement: 'top' })).toBeNull();
    });
});

describe('shouldCompositeForLook', () => {
    it('iOS without a look keeps the raw camera stream', () => {
        expect(shouldCompositeForLook({ isIOS: true })).toBe(false);
    });
    it('iOS WITH a look opts into the composite (only the canvas is captured)', () => {
        expect(shouldCompositeForLook({ isIOS: true, beautyMode: 'soft' })).toBe(true);
        expect(shouldCompositeForLook({ isIOS: true, overlayMode: 'hat' })).toBe(true);
    });
    it('non-iOS always composites', () => {
        expect(shouldCompositeForLook({ isIOS: false })).toBe(true);
    });
});

describe('no browser globals (source guard)', () => {    it('portrait-capture-logic.js does not reference window/document/navigator', () => {
        const src = readFileSync(resolve(process.cwd(), 'src/modules/speech/portrait-capture-logic.js'), 'utf8');
        // Strip nothing — assert on raw source. These tokens must not appear.
        expect(src).not.toMatch(/\bwindow\b/);
        expect(src).not.toMatch(/\bdocument\b/);
        expect(src).not.toMatch(/\bnavigator\b/);
    });
});
describe('lens effect presets (stories/092)', () => {
    function makePaintSpies() {
        const calls = { draws: 0, fills: 0, gradients: 0 };
        const scratch = {
            width: 0,
            height: 0,
            getContext: () => ({
                imageSmoothingEnabled: true,
                drawImage: () => { calls.draws += 1; },
            }),
        };
        const ctx = {
            save() {},
            restore() {},
            fillRect: () => { calls.fills += 1; },
            createRadialGradient: () => {
                calls.gradients += 1;
                return { addColorStop() {} };
            },
            imageSmoothingEnabled: true,
            globalAlpha: 1,
            fillStyle: '',
            globalCompositeOperation: 'source-over',
        };
        return { ctx, scratch, calls };
    }

    it('gives each light option its own preset, within the painters’ ranges', () => {
        for (const mode of ['lensSoftFocus', 'lensChiaroscuro']) {
            const preset = BEAUTY_PRESETS[mode];
            expect(preset).toBeTruthy();
            for (const lever of ['softFocus', 'fillLight', 'warmth', 'vignette']) {
                expect(preset[lever]).toBeGreaterThanOrEqual(0);
                expect(preset[lever]).toBeLessThanOrEqual(1);
            }
        }
        // Soft focus is a real bloom, not the mild filter-level soften; and
        // chiaroscuro is mostly shadow around a lit centre.
        expect(BEAUTY_PRESETS.lensSoftFocus.softFocus).toBeGreaterThan(BEAUTY_PRESETS.glow.softFocus);
        expect(BEAUTY_PRESETS.lensChiaroscuro.vignette).toBeGreaterThan(BEAUTY_PRESETS.soft.vignette);
    });

    it('paints something for each light mode, and nothing for none', () => {
        for (const mode of ['lensSoftFocus', 'lensChiaroscuro']) {
            const { ctx, scratch, calls } = makePaintSpies();
            expect(paintBeautyPass({ ctx, source: {}, scratch, canvasWidth: 720, canvasHeight: 1280, mode })).toBe(mode);
            expect(calls.draws + calls.fills + calls.gradients).toBeGreaterThan(0);
        }
        const { ctx, scratch, calls } = makePaintSpies();
        expect(paintBeautyPass({ ctx, source: {}, scratch, canvasWidth: 720, canvasHeight: 1280, mode: 'none' })).toBe('none');
        expect(calls.draws + calls.fills + calls.gradients).toBe(0);
    });
});

describe('close-up lens hole (stories/092)', () => {
    function makeCtx() {
        const calls = { clip: [], ellipse: 0, rect: 0, draws: 0, fills: 0 };
        return {
            calls,
            save() {}, restore() {},
            beginPath() {},
            rect() { calls.rect += 1; },
            ellipse() { calls.ellipse += 1; },
            clip(rule) { calls.clip.push(rule); },
            drawImage() { calls.draws += 1; },
            fillRect() { calls.fills += 1; },
            fillStyle: '',
            imageSmoothingEnabled: true,
            globalAlpha: 1,
        };
    }
    const makeScratch = () => ({
        width: 0,
        height: 0,
        getContext: () => ({ imageSmoothingEnabled: true, drawImage() {} }),
    });

    it('keeps the soft-focus preset for the other lenses', () => {
        const preset = BEAUTY_PRESETS.lensCloseUp;
        expect(preset.softFocus).toBeGreaterThan(BEAUTY_PRESETS.soft.softFocus);
        expect(preset.fillLight).toBe(0);
        expect(preset.vignette).toBe(0);
        // the frost is what makes it read as a pane of glass, not a smear
        expect(preset.frost).toBeGreaterThan(0.2);
        expect(preset.frost).toBeLessThan(0.6);
    });

    it('blurs only outside the oval, and leaves the frame whole when there is no hole', () => {
        const holed = makeCtx();
        expect(paintSoftFocus({
            ctx: holed,
            source: {},
            scratch: makeScratch(),
            canvasWidth: 1080,
            canvasHeight: 1920,
            strength: 0.95,
            hole: { cx: 540, cy: 730, rx: 389, ry: 614 },
        })).toBe(true);
        expect(holed.calls.rect).toBe(1);
        expect(holed.calls.ellipse).toBe(1);
        // even-odd is what turns the ellipse into a hole
        expect(holed.calls.clip).toEqual(['evenodd']);
        expect(holed.calls.draws).toBe(1);

        const whole = makeCtx();
        expect(paintSoftFocus({
            ctx: whole,
            source: {},
            scratch: makeScratch(),
            canvasWidth: 1080,
            canvasHeight: 1920,
            strength: 0.3,
        })).toBe(true);
        expect(whole.calls.clip).toEqual([]);
        expect(whole.calls.draws).toBe(1);
    });

    it('threads the hole through paintBeautyPass, for the blur AND the frost', () => {
        const ctx = makeCtx();
        expect(paintBeautyPass({
            ctx,
            source: {},
            scratch: makeScratch(),
            canvasWidth: 1080,
            canvasHeight: 1920,
            mode: 'lensCloseUp',
            hole: { cx: 540, cy: 730, rx: 389, ry: 614 },
        })).toBe('lensCloseUp');
        // blur clipped to outside-the-oval, then the white veil clipped the same way
        expect(ctx.calls.clip).toEqual(['evenodd', 'evenodd']);
    });

    it('frosts only outside the oval, and only when asked', () => {
        const holed = makeCtx();
        expect(paintFrost({
            ctx: holed,
            canvasWidth: 1080,
            canvasHeight: 1920,
            hole: { cx: 540, cy: 730, rx: 389, ry: 614 },
            alpha: 0.38,
        })).toBe(true);
        expect(holed.calls.clip).toEqual(['evenodd']);
        expect(holed.calls.fills).toBe(1);

        const whole = makeCtx();
        expect(paintFrost({ ctx: whole, canvasWidth: 1080, canvasHeight: 1920, alpha: 0.2 })).toBe(true);
        expect(whole.calls.clip).toEqual([]);
        expect(whole.calls.fills).toBe(1);

        const off = makeCtx();
        expect(paintFrost({ ctx: off, canvasWidth: 1080, canvasHeight: 1920, alpha: 0 })).toBe(false);
        expect(off.calls.fills).toBe(0);
    });
});
