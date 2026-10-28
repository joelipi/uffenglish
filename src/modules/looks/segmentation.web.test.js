// Unit tests for the segmenter adapter (stories/100). The model itself is not
// run here — the factory and the segmenter handle are injected, which is the
// only way to test "what happens when the GPU delegate fails" without a GPU.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadSegmenter,
    segmentFrameToMask,
    disposeSegmenter,
    MEDIAPIPE_FILESET_PATH,
    SEGMENTER_MODEL_PATH,
} from './segmentation.web.js';

const SELF_PATH = fileURLToPath(import.meta.url).replace(/\.test\.js$/, '.js');

function fakeMaskInput({ failDraw = false } = {}) {
    const drawImage = vi.fn(() => {
        if (failDraw) throw new Error('draw failed');
    });
    const canvas = { id: 'mask-input' };
    return { ctx: { canvas, drawImage }, canvas, drawImage };
}

function fakeSegmenter({ floats = [0, 1, 0.5, 0.25], throws = false } = {}) {
    const close = vi.fn();
    const segmentForVideo = vi.fn(() => {
        if (throws) throw new Error('inference failed');
        return {
            confidenceMasks: [{ getAsFloat32Array: () => new Float32Array(floats) }],
            close,
        };
    });
    return { segmentForVideo, close, handle: { segmentForVideo } };
}

const CROP = { sx: 0, sy: 0, sw: 1920, sh: 1080 };

describe('loadSegmenter', () => {
    it('requests the GPU delegate first with a VIDEO running mode', async () => {
        const createSegmenter = vi.fn().mockResolvedValue({ id: 'gpu' });
        const handle = await loadSegmenter({ createSegmenter });
        expect(handle).toEqual({ id: 'gpu' });
        expect(createSegmenter).toHaveBeenCalledTimes(1);
        expect(createSegmenter.mock.calls[0][0]).toEqual({
            filesetPath: MEDIAPIPE_FILESET_PATH,
            modelPath: SEGMENTER_MODEL_PATH,
            delegate: 'GPU',
        });
    });

    it('retries once on CPU when the GPU delegate throws', async () => {
        const createSegmenter = vi.fn()
            .mockRejectedValueOnce(new Error('no webgl'))
            .mockResolvedValueOnce({ id: 'cpu' });
        const handle = await loadSegmenter({ createSegmenter });
        expect(handle).toEqual({ id: 'cpu' });
        expect(createSegmenter.mock.calls.map((c) => c[0].delegate)).toEqual(['GPU', 'CPU']);
    });

    it('returns null (never throws) when both delegates fail', async () => {
        const createSegmenter = vi.fn().mockRejectedValue(new Error('nope'));
        await expect(loadSegmenter({ createSegmenter })).resolves.toBeNull();
        expect(createSegmenter).toHaveBeenCalledTimes(2);
    });

    it('returns null when the factory resolves nothing', async () => {
        await expect(loadSegmenter({ createSegmenter: vi.fn().mockResolvedValue(null) })).resolves.toBeNull();
    });
});

describe('segmentFrameToMask', () => {
    it('downscales the cropped frame into the mask input BEFORE inference', () => {
        const { ctx, canvas, drawImage } = fakeMaskInput();
        const { handle, segmentForVideo } = fakeSegmenter();
        segmentFrameToMask({
            segmenter: handle,
            maskInputCtx: ctx,
            video: { id: 'camera' },
            cropRect: CROP,
            maskWidth: 256,
            maskHeight: 256,
            timestampMs: 42,
        });
        // The model is handed the 256×256 scratch canvas, never the camera.
        expect(segmentForVideo).toHaveBeenCalledWith(canvas, 42);
        expect(drawImage).toHaveBeenCalledWith(
            { id: 'camera' }, 0, 0, 1920, 1080, 0, 0, 256, 256
        );
        expect(drawImage.mock.invocationCallOrder[0])
            .toBeLessThan(segmentForVideo.mock.invocationCallOrder[0]);
    });

    it('returns one byte of alpha per mask pixel', () => {
        const { ctx } = fakeMaskInput();
        const { handle } = fakeSegmenter({ floats: [0, 1, 0.5, 0.25] });
        const mask = segmentFrameToMask({
            segmenter: handle,
            maskInputCtx: ctx,
            video: {},
            cropRect: CROP,
            maskWidth: 2,
            maskHeight: 2,
            previousMask: null,
        });
        expect(mask).toBeInstanceOf(Uint8Array);
        expect([...mask]).toEqual([0, 255, 128, 64]);
    });

    it('blends the previous mask in so a still frame does not shimmer', () => {
        const { ctx } = fakeMaskInput();
        const { handle } = fakeSegmenter({ floats: [1, 1] });
        const mask = segmentFrameToMask({
            segmenter: handle,
            maskInputCtx: ctx,
            video: {},
            cropRect: CROP,
            maskWidth: 2,
            maskHeight: 1,
            previousMask: new Uint8Array([0, 0]),
        });
        expect([...mask]).toEqual([217, 217]);
    });

    it('keeps the previous mask when inference throws', () => {
        const { ctx } = fakeMaskInput();
        const { handle } = fakeSegmenter({ throws: true });
        const previous = new Uint8Array([9, 9]);
        const mask = segmentFrameToMask({
            segmenter: handle, maskInputCtx: ctx, video: {}, cropRect: CROP,
            maskWidth: 2, maskHeight: 1, previousMask: previous,
        });
        expect(mask).toBe(previous);
    });

    it('keeps the previous mask when the frame cannot be drawn', () => {
        const { ctx } = fakeMaskInput({ failDraw: true });
        const { handle, segmentForVideo } = fakeSegmenter();
        const previous = new Uint8Array([7]);
        const mask = segmentFrameToMask({
            segmenter: handle, maskInputCtx: ctx, video: {}, cropRect: CROP,
            maskWidth: 1, maskHeight: 1, previousMask: previous,
        });
        expect(mask).toBe(previous);
        expect(segmentForVideo).not.toHaveBeenCalled();
    });

    it('closes the result so GPU resources are not leaked per frame', () => {
        const { ctx } = fakeMaskInput();
        const { handle, close } = fakeSegmenter();
        segmentFrameToMask({
            segmenter: handle, maskInputCtx: ctx, video: {}, cropRect: CROP,
            maskWidth: 2, maskHeight: 1,
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('does nothing without a segmenter or a crop rect', () => {
        const { ctx, drawImage } = fakeMaskInput();
        expect(segmentFrameToMask({ segmenter: null, maskInputCtx: ctx, video: {}, cropRect: CROP })).toBeNull();
        expect(segmentFrameToMask({ segmenter: {}, maskInputCtx: ctx, video: {}, cropRect: null })).toBeNull();
        expect(drawImage).not.toHaveBeenCalled();
    });
});

describe('disposeSegmenter', () => {
    it('closes once and never throws', () => {
        const close = vi.fn();
        disposeSegmenter({ close });
        expect(close).toHaveBeenCalledTimes(1);
        disposeSegmenter(null);
        expect(() => disposeSegmenter({ close() { throw new Error('x'); } })).not.toThrow();
    });
});

describe('segmentation.web.js source guard', () => {
    const source = fs.readFileSync(SELF_PATH, 'utf8');
    const code = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');

    it('loads MediaPipe from the vendored package, not a CDN', () => {
        expect(code).toContain("import('@mediapipe/tasks-vision')");
        expect(code).not.toMatch(/cdn\.jsdelivr|unpkg\.com/);
    });

    it('never uses ctx.filter (a silent no-op in iOS WebKit)', () => {
        expect(code).not.toContain('ctx.filter');
        expect(code).not.toContain('.filter =');
    });

    it('does not mention the operator studio page', () => {
        // Built from parts: the hidden-page guard scans src/** for this token,
        // so spelling it here would make THIS test file the offender.
        const studioPath = '/' + 'recorder';
        const studioFile = 'recorder' + '.html';
        expect(code).not.toContain(studioPath);
        expect(code).not.toContain(studioFile);
    });
});
