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
    // Recording privacy filters (stories/090 spike, `?filter=blur|mask`).
    resolveFilterModeFromSearch,
    shouldUsePortraitComposite,
    faceBoxToCanvasRect,
    createFaceBoxTracker,
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

// ---------------------------------------------------------------------------
// Recording privacy filters — spike (stories/090).
// Deliberately tiny: the real acceptance test is the owner recording on their
// own iPhone / Android / Windows box.
// ---------------------------------------------------------------------------
describe('resolveFilterModeFromSearch', () => {
    it('no query → none', () => {
        expect(resolveFilterModeFromSearch('')).toBe('none');
    });
    it('absent param → none', () => {
        expect(resolveFilterModeFromSearch('?course=wouldyourather')).toBe('none');
    });
    it('blur → blur', () => {
        expect(resolveFilterModeFromSearch('?filter=blur')).toBe('blur');
    });
    it('mask → mask', () => {
        expect(resolveFilterModeFromSearch('?filter=mask')).toBe('mask');
    });
    it('unknown value → none (never throws)', () => {
        expect(resolveFilterModeFromSearch('?filter=glitter')).toBe('none');
    });
});

describe('shouldUsePortraitComposite', () => {
    it('iOS without a filter keeps the raw camera stream', () => {
        expect(shouldUsePortraitComposite({ isIOS: true, filterMode: 'none' })).toBe(false);
    });
    it('iOS WITH a filter opts into the composite (only the canvas is captured)', () => {
        expect(shouldUsePortraitComposite({ isIOS: true, filterMode: 'blur' })).toBe(true);
    });
    it('non-iOS always composites', () => {
        expect(shouldUsePortraitComposite({ isIOS: false, filterMode: 'none' })).toBe(true);
    });
    it('defaults to the unfiltered rule', () => {
        expect(shouldUsePortraitComposite()).toBe(true);
    });
});

describe('faceBoxToCanvasRect', () => {
    // A 1280×720 landscape camera cover-filled into a 720×1280 canvas: the crop
    // keeps a 405-wide slice centred at x=437.5, which is the mapping the mask
    // must follow (the Android "mask off my face" bug).
    const videoWidth = 1280;
    const videoHeight = 720;
    const canvasWidth = 720;
    const canvasHeight = 1280;
    const crop = { sx: 437.5, sy: 0, sw: 405, sh: 720 };

    it('maps a centred face to the frame centre', () => {
        const rect = faceBoxToCanvasRect({
            faceBox: { detected: 1, x: 0, y: 0, s: 0.3 },
            videoWidth, videoHeight, crop, canvasWidth, canvasHeight,
        });
        expect(rect.rx + rect.rw / 2).toBeCloseTo(360, 5);
        expect(rect.ry + rect.rh / 2).toBeCloseTo(640, 5);
        expect(rect.rw).toBeCloseTo(rect.rh, 5);
    });

    it('follows the crop: a face at the camera centre is NOT the canvas centre when the crop is off-centre', () => {
        const offCentre = { sx: 0, sy: 0, sw: 405, sh: 720 };
        const centred = faceBoxToCanvasRect({
            faceBox: { detected: 1, x: 0, y: 0, s: 0.3 },
            videoWidth, videoHeight, crop: offCentre, canvasWidth, canvasHeight,
        });
        // centre of the 1280-wide camera mapped through a left-edge crop lands
        // far to the RIGHT of the canvas centre
        expect(centred.rx + centred.rw / 2).toBeGreaterThan(canvasWidth / 2);
    });

    it('flips y (Jeeliz measures it from the bottom)', () => {
        const high = faceBoxToCanvasRect({ faceBox: { detected: 1, x: 0, y: 0.5, s: 0.2 }, videoWidth, videoHeight, crop, canvasWidth, canvasHeight });
        const low = faceBoxToCanvasRect({ faceBox: { detected: 1, x: 0, y: -0.5, s: 0.2 }, videoWidth, videoHeight, crop, canvasWidth, canvasHeight });
        expect(high.ry).toBeLessThan(low.ry);
    });

    it('no face above the detection threshold → null', () => {
        expect(faceBoxToCanvasRect({ faceBox: { detected: 0.1, x: 0, y: 0, s: 0.5 }, videoWidth, videoHeight, crop, canvasWidth, canvasHeight })).toBeNull();
    });

    it('missing / non-finite input → null', () => {
        expect(faceBoxToCanvasRect({ faceBox: null, videoWidth, videoHeight, crop, canvasWidth, canvasHeight })).toBeNull();
        expect(faceBoxToCanvasRect({ faceBox: { detected: 1, x: NaN, y: 0, s: 0.5 }, videoWidth, videoHeight, crop, canvasWidth, canvasHeight })).toBeNull();
        expect(faceBoxToCanvasRect({ faceBox: { detected: 1, x: 0, y: 0, s: 0.5 }, videoWidth: 0, videoHeight, crop, canvasWidth, canvasHeight })).toBeNull();
        expect(faceBoxToCanvasRect({ faceBox: { detected: 1, x: 0, y: 0, s: 0.5 }, videoWidth, videoHeight, crop: null, canvasWidth, canvasHeight })).toBeNull();
    });
});

describe('createFaceBoxTracker', () => {
    it('holds the last box through a drop-out instead of blinking off', () => {
        const tracker = createFaceBoxTracker({ holdMs: 900, smoothing: 0.35 });
        tracker.update({ detected: 0.9, x: 0, y: 0, s: 0.3 }, 0);
        // detector loses the face for 500 ms
        tracker.update({ detected: 0.1, x: 0, y: 0, s: 0.3 }, 500);
        expect(tracker.current(500)).not.toBeNull();
    });

    it('releases the box once the hold expires', () => {
        const tracker = createFaceBoxTracker({ holdMs: 900 });
        tracker.update({ detected: 0.9, x: 0, y: 0, s: 0.3 }, 0);
        expect(tracker.current(901)).toBeNull();
    });

    it('never reports a box before the first detection', () => {
        const tracker = createFaceBoxTracker();
        expect(tracker.current(100)).toBeNull();
    });

    it('eases toward the new position instead of jumping', () => {
        const tracker = createFaceBoxTracker({ smoothing: 0.5 });
        tracker.update({ detected: 0.9, x: 0, y: 0, s: 0.3 }, 0);
        tracker.update({ detected: 0.9, x: 0.5, y: 0, s: 0.3 }, 10);
        expect(tracker.current(10).x).toBeCloseTo(0.25, 5);
    });

    it('reset drops the held box', () => {
        const tracker = createFaceBoxTracker();
        tracker.update({ detected: 0.9, x: 0, y: 0, s: 0.3 }, 0);
        tracker.reset();
        expect(tracker.current(0)).toBeNull();
    });
});

describe('no browser globals (source guard)', () => {
    it('portrait-capture-logic.js does not reference window/document/navigator', () => {
        const src = readFileSync(resolve(process.cwd(), 'src/modules/speech/portrait-capture-logic.js'), 'utf8');
        // Strip nothing — assert on raw source. These tokens must not appear.
        expect(src).not.toMatch(/\bwindow\b/);
        expect(src).not.toMatch(/\bdocument\b/);
        expect(src).not.toMatch(/\bnavigator\b/);
    });
});