// Unit tests for the studio's capture composite (stories/100).
//
// jsdom has no canvas, no WebGL and no camera, so every browser object is
// injected: the tests record the DRAW CALLS and assert the sandwich order, which
// is the part that silently breaks (drawing `destination-in` on the main canvas,
// or painting the foreground under the person, both produce a plausible-looking
// stream and a wrong take).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    createSubstitutedCaptureStream,
    loadLayerImage,
    resolveCoverRect,
} from './background-substitution.webonly.js';

const SELF_PATH = fileURLToPath(import.meta.url).replace(/\.test\.js$/, '.js');

function makeContext() {
    const calls = [];
    let composite = 'source-over';
    const ctx = {
        calls,
        canvas: null,
        imageSmoothingEnabled: false,
        globalAlpha: 1,
        fillStyle: '',
        get globalCompositeOperation() { return composite; },
        set globalCompositeOperation(value) {
            composite = value;
            calls.push(['composite', value]);
        },
        drawImage: vi.fn((...args) => calls.push(['drawImage', ...args])),
        clearRect: vi.fn((...args) => calls.push(['clearRect', ...args])),
        fillRect: vi.fn((...args) => calls.push(['fillRect', ...args])),
        save: vi.fn(),
        restore: vi.fn(),
        createImageData: vi.fn((w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })),
        putImageData: vi.fn((...args) => calls.push(['putImageData', ...args])),
    };
    return ctx;
}

const GL_CONSTANTS = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    LINEAR: 9729,
    CLAMP_TO_EDGE: 33071,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    TRIANGLE_STRIP: 5,
    UNPACK_FLIP_Y_WEBGL: 37440,
};

function makeFakeGl({ compileOk = true } = {}) {
    const calls = [];
    const gl = { ...GL_CONSTANTS, calls };
    for (const name of [
        'shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'useProgram', 'bindBuffer',
        'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'activeTexture',
        'bindTexture', 'texParameteri', 'uniform1i', 'pixelStorei', 'viewport',
        'uniform1f', 'drawArrays', 'deleteTexture', 'deleteBuffer', 'deleteProgram',
    ]) {
        gl[name] = vi.fn((...args) => calls.push([name, ...args]));
    }
    gl.createShader = vi.fn(() => ({}));
    gl.createProgram = vi.fn(() => ({}));
    gl.createBuffer = vi.fn(() => ({}));
    gl.createTexture = vi.fn(() => ({}));
    gl.getShaderParameter = vi.fn(() => compileOk);
    gl.getShaderInfoLog = vi.fn(() => 'shader error');
    gl.getProgramParameter = vi.fn(() => compileOk);
    gl.getProgramInfoLog = vi.fn(() => 'link error');
    gl.getAttribLocation = vi.fn(() => 0);
    gl.getUniformLocation = vi.fn((_, name) => ({ name }));
    gl.texImage2D = vi.fn((...args) => calls.push(['texImage2D', ...args]));
    return gl;
}

/**
 * A canvas that enforces the real "one context for life" rule: once `webgl2` is
 * handed out, `getContext('2d')` returns null (and vice versa). Modelling this is
 * the point — a fake that happily returns both hides the bug that made the
 * shader unreachable.
 */
function makeCanvas({ webgl2 = null } = {}) {
    const ctx = makeContext();
    let taken = null;
    const canvas = {
        width: 0,
        height: 0,
        ctx,
        getContext: vi.fn((type) => {
            if (type === 'webgl2') {
                if (taken === '2d') return null;
                taken = 'webgl2';
                return webgl2;
            }
            if (taken === 'webgl2') return null;
            taken = '2d';
            return ctx;
        }),
        captureStream: vi.fn(() => ({ getVideoTracks: () => [{ kind: 'video', stop: vi.fn() }] })),
    };
    ctx.canvas = canvas;
    return canvas;
}

function makeVideo({ width = 1920, height = 1080 } = {}) {
    const frameCallbacks = [];
    return {
        videoWidth: width,
        videoHeight: height,
        currentTime: 0,
        muted: false,
        playsInline: false,
        srcObject: null,
        style: { cssText: '' },
        setAttribute: vi.fn(),
        play: vi.fn(() => Promise.resolve()),
        pause: vi.fn(),
        requestVideoFrameCallback: vi.fn((cb) => frameCallbacks.push(cb)),
        cancelVideoFrameCallback: vi.fn(),
        frameCallbacks,
    };
}

const dims = { width: 1080, height: 1920, fps: 30, maskWidth: 256, maskHeight: 256 };

function build({ background = null, foreground = null, segmenter = null, mask = null, video = null, webgl2 = null, compileOk = true } = {}) {
    const canvases = [];
    const createCanvas = () => {
        const canvas = makeCanvas({ webgl2 });
        canvases.push(canvas);
        return canvas;
    };
    const camera = video || makeVideo();
    const api = createSubstitutedCaptureStream({
        rawStream: { getAudioTracks: () => [{ kind: 'audio' }], getVideoTracks: () => [] },
        createCanvas,
        createVideo: () => camera,
        dimensions: dims,
        segmenter,
        background,
        foreground,
        selection: null,
        tuning: null,
        images: {},
        paintBeauty: null,
        paintMask: segmenter
            ? vi.fn(() => mask)
            : null,
    });
    return { api, canvases, camera };
}

const outputCanvas = (api) => api.canvas;
const allDrawCalls = (canvases) => canvases.flatMap((c) => c.ctx.calls);

beforeEach(() => {
    vi.stubGlobal('MediaStream', class {
        constructor(tracks) { this.tracks = tracks; }
        getTracks() { return this.tracks; }
        getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
        getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('resolveCoverRect', () => {
    it('cover-fits a landscape image into a portrait frame', () => {
        const rect = resolveCoverRect({ imageWidth: 1920, imageHeight: 1080, canvasWidth: 1080, canvasHeight: 1920 });
        // Height is the binding dimension: the width overflows and is centred.
        expect(rect.dw).toBeCloseTo(3413.33, 1);
        expect(rect.dh).toBe(1920);
        expect(rect.dy).toBe(0);
        expect(rect.dx).toBeLessThan(0);
    });

    it('returns null for unusable sizes', () => {
        expect(resolveCoverRect({ imageWidth: 0, imageHeight: 1080, canvasWidth: 1080, canvasHeight: 1920 })).toBeNull();
        expect(resolveCoverRect({ imageWidth: 10, imageHeight: 10, canvasWidth: 0, canvasHeight: 1920 })).toBeNull();
    });
});

describe('createSubstitutedCaptureStream', () => {
    it('captures at 1080×1920 @ 30 and carries the camera audio track', () => {
        const { api } = build();
        expect(outputCanvas(api).width).toBe(1080);
        expect(outputCanvas(api).height).toBe(1920);
        expect(outputCanvas(api).captureStream).toHaveBeenCalledWith(30);
        const audio = api.stream.getAudioTracks();
        expect(audio).toHaveLength(1);
        expect(audio[0].kind).toBe('audio');
        expect(api.stream.getVideoTracks()[0].kind).toBe('video');
        api.dispose();
    });

    it('paints the camera unmasked when no background is configured', () => {
        const { api } = build();
        const canvas = outputCanvas(api);
        expect(api.paintNow()).toBe(true);
        // First paint: the camera cover-cropped into the frame.
        const cameraDraw = canvas.ctx.calls.find(([name, source]) => name === 'drawImage' && source !== undefined);
        expect(cameraDraw).toBeTruthy();
        expect(api.stats().hasMatte).toBe(false);
        api.dispose();
    });

    it('composites background → person → foreground → overlays, in that order', () => {
        const background = { naturalWidth: 1080, naturalHeight: 1920, tag: 'bg' };
        const foreground = { naturalWidth: 1080, naturalHeight: 1920, tag: 'fg' };
        const { api, canvases } = build({
            background,
            foreground,
            segmenter: { id: 'seg' },
            mask: new Uint8Array(256 * 256).fill(255),
        });
        api.paintNow();

        const output = outputCanvas(api);
        const paintedOnOutput = output.ctx.calls
            .filter(([name]) => name === 'drawImage')
            .map(([, source]) => source);

        // Background first, then the cut-out person layer, then the overlay layer.
        expect(paintedOnOutput[0]).toBe(background);
        expect(paintedOnOutput).toHaveLength(3);
        const personLayer = paintedOnOutput[1];
        const overlayLayer = paintedOnOutput[2];
        // Both are canvases the factory made (not the output, not the image).
        expect(canvases).toContain(personLayer);
        expect(canvases).toContain(overlayLayer);
        expect(personLayer).not.toBe(output);
        // The scratch layer is the one that was cut out with destination-in.
        expect(personLayer.ctx.calls).toContainEqual(['composite', 'destination-in']);

        // The foreground lives INSIDE the overlay layer, so it lands on top of
        // the cut-out person rather than behind it.
        const overlayDraws = overlayLayer.ctx.calls
            .filter(([name]) => name === 'drawImage')
            .map(([, source]) => source);
        expect(overlayDraws).toContain(foreground);
        api.dispose();
    });

    it('cuts the person out on the OFFSCREEN canvas, never the main one', () => {
        const background = { naturalWidth: 1080, naturalHeight: 1920 };
        const { api, canvases } = build({
            background,
            segmenter: { id: 'seg' },
            mask: new Uint8Array(256 * 256).fill(255),
        });
        api.paintNow();
        const output = outputCanvas(api);
        // The main canvas never enters `destination-in` (that would erase the
        // background it just painted)...
        expect(output.ctx.calls.filter(([n, v]) => n === 'composite' && v === 'destination-in')).toHaveLength(0);
        // ...a scratch canvas is where the cut-out happens.
        const scratched = canvases.filter((c) => c !== output
            && c.ctx.calls.some(([n, v]) => n === 'composite' && v === 'destination-in'));
        expect(scratched).toHaveLength(1);
        api.dispose();
    });

    it('skips the matte when the segmenter produced nothing', () => {
        const background = { naturalWidth: 1080, naturalHeight: 1920 };
        const { api } = build({ background, segmenter: { id: 'seg' }, mask: null });
        api.paintNow();
        expect(api.stats().hasMatte).toBe(false);
        api.dispose();
    });

    it('asks the segmenter for one mask per painted frame at 256×256', () => {
        const paintMask = vi.fn(() => new Uint8Array(256 * 256).fill(128));
        const canvases = [];
        const api = createSubstitutedCaptureStream({
            rawStream: { getAudioTracks: () => [], getVideoTracks: () => [] },
            createCanvas: () => { const c = makeCanvas(); canvases.push(c); return c; },
            createVideo: () => makeVideo(),
            dimensions: dims,
            segmenter: { id: 'seg' },
            background: { naturalWidth: 1080, naturalHeight: 1920 },
            paintMask,
        });
        api.paintNow();
        api.paintNow();
        expect(paintMask).toHaveBeenCalledTimes(2);
        expect(paintMask.mock.calls[0][0]).toMatchObject({ maskWidth: 256, maskHeight: 256 });
        api.dispose();
    });

    it('hands the segmenter a real drawImage SOURCE rect, not the dest rect', () => {
        // `resolveCoverRect` returns `{dx,dy,dw,dh}` for the output canvas; the
        // mask input needs `{sx,sy,sw,sh}`. Passing the dest shape straight
        // through made drawImage a no-op (undefined source rect) and the model
        // answered with an all-zero mask on every frame — a clean backdrop with
        // the person missing, and nothing logged.
        const paintMask = vi.fn(() => new Uint8Array(256 * 256).fill(128));
        const api = createSubstitutedCaptureStream({
            rawStream: { getAudioTracks: () => [], getVideoTracks: () => [] },
            createCanvas: () => makeCanvas(),
            createVideo: () => makeVideo({ width: 1920, height: 1080 }),
            dimensions: dims,
            segmenter: { id: 'seg' },
            background: { naturalWidth: 1080, naturalHeight: 1920 },
            paintMask,
        });
        api.paintNow();
        const { cropRect } = paintMask.mock.calls[0][0];
        expect(Object.keys(cropRect).sort()).toEqual(['sh', 'sw', 'sx', 'sy']);
        expect(cropRect.sw).toBeGreaterThan(0);
        expect(cropRect.sh).toBeGreaterThan(0);
        // A landscape camera into a portrait mask crop overflows horizontally.
        expect(cropRect.sx).toBeLessThan(0);
        expect(cropRect.sh).toBe(256);
        api.dispose();
    });

    it('paints per camera frame via requestVideoFrameCallback when available', () => {
        const { api, camera } = build();
        expect(camera.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
        const before = api.stats().framesDrawn;
        camera.frameCallbacks[0]();
        expect(api.stats().framesDrawn).toBe(before + 1);
        expect(camera.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
        api.dispose();
    });

    it('lets a layer be swapped without rebuilding the stream', () => {
        const { api } = build();
        const background = { naturalWidth: 1080, naturalHeight: 1920 };
        api.setLayer('background', background);
        vi.stubGlobal('MediaStream', class {
            constructor(tracks) { this.tracks = tracks; }
            getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
            getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
        });
        api.paintNow();
        expect(api.stats().framesDrawn).toBeGreaterThan(0);
        api.dispose();
    });

    it('disposes idempotently: stops the canvas track and detaches the nodes', () => {
        const { api, camera } = build();
        const track = api.stream.getVideoTracks()[0];
        api.dispose();
        api.dispose();
        expect(track.stop).toHaveBeenCalledTimes(1);
        expect(camera.pause).toHaveBeenCalled();
        expect(camera.srcObject).toBeNull();
    });

    it('falls back to 2D when webgl2 is unavailable', () => {
        const { api, canvases } = build();
        expect(api.stats().compositor).toBe('2d');
        // The probe canvas is throwaway; the output took a 2D context.
        expect(outputCanvas(api).getContext).toHaveBeenCalledWith('2d');
        expect(canvases.length).toBeGreaterThan(1);
        api.dispose();
    });
});

describe('renderer selection (a canvas keeps its first context type)', () => {
    it('uses WebGL2 when it is available and never asks the output for 2D', () => {
        const gl = makeFakeGl();
        const { api } = build({ webgl2: gl });
        expect(api.stats().compositor).toBe('webgl2');
        const output = outputCanvas(api);
        // THE BUG this covers: asking for '2d' first permanently denies 'webgl2',
        // so the shader could never run and every take paid two full-resolution
        // 2D draws per frame instead of one GPU draw call.
        expect(output.getContext.mock.calls.map(([type]) => type)).not.toContain('2d');
        expect(output.getContext).toHaveBeenCalledWith('webgl2', expect.anything());
        api.dispose();
    });

    it('draws through the shader once per frame when WebGL2 is active', () => {
        const gl = makeFakeGl();
        const { api } = build({
            webgl2: gl,
            background: { naturalWidth: 1080, naturalHeight: 1920 },
            segmenter: { id: 'seg' },
            mask: new Uint8Array(256 * 256).fill(200),
        });
        api.paintNow();
        expect(gl.texImage2D).toHaveBeenCalled();
        expect(gl.drawArrays).toHaveBeenCalled();
        // Four layer textures are bound every frame.
        expect(gl.activeTexture.mock.calls.length).toBeGreaterThanOrEqual(4);
        api.dispose();
    });

    it('moves the output to a fresh canvas when the shader fails to build', () => {
        // WebGL2 is present but unusable: the first canvas is permanently a
        // WebGL2 canvas, so painting must continue on a different one — the
        // stream is captured after this decision, so the take still works.
        const { api, canvases } = build({ webgl2: makeFakeGl({ compileOk: false }) });
        const output = outputCanvas(api);
        expect(api.stats().compositor).toBe('2d');
        expect(canvases.length).toBeGreaterThan(2);
        expect(output.getContext).toHaveBeenCalledWith('2d');
        expect(api.paintNow()).toBe(true);
        expect(api.stats().framesDrawn).toBe(1);
        // The stream is captured from the canvas actually being painted.
        expect(output.captureStream).toHaveBeenCalledWith(30);
        api.dispose();
    });
});

describe('background-substitution.webonly.js shader source guard', () => {
    const source = fs.readFileSync(SELF_PATH, 'utf8');
    // Slice the fragment shader itself: an unanchored `toContain('smoothstep')`
    // over the whole file would stay green if the shader lost its feathering
    // (the comment above it names it too).
    const start = source.indexOf('const FRAGMENT_SHADER');
    const end = source.indexOf('function compileShader');
    const fragment = source.slice(start, end);

    // Read the shader text out of the source, one line at a time, exactly as the
    // GPU sees it. A joined first line (`#version 300 esin vec2 …`) is a compile
    // error on every device, and it produced a SILENT 2D fallback — the fake GL
    // context in these tests cannot catch malformed GLSL, so the shape of the
    // source is asserted directly.
    const shaderLines = (constName) => {
        const at = source.indexOf(`const ${constName} = \``);
        expect(at, constName).toBeGreaterThan(-1);
        return source.slice(at, source.indexOf('`;', at)).split('\n');
    };

    it('starts the vertex shader with a well-formed version directive', () => {
        const lines = shaderLines('VERTEX_SHADER');
        // Line 0 is `const VERTEX_SHADER = \`#version 300 es`.
        expect(lines[0].endsWith('`#version 300 es')).toBe(true);
        expect(lines[1]).toBe('in vec2 a_pos;');
    });

    it('starts the fragment shader with a well-formed version directive', () => {
        const lines = shaderLines('FRAGMENT_SHADER');
        expect(lines[0].endsWith('`#version 300 es')).toBe(true);
        expect(lines[1]).toBe('precision highp float;');
    });

    it('never leaves a gl_ token or directive glued to a neighbour', () => {
        for (const constName of ['VERTEX_SHADER', 'FRAGMENT_SHADER']) {
            const text = shaderLines(constName).join('\n');
            expect(text, constName).not.toMatch(/#version 300 es[^\n]/);
            expect(text, constName).not.toMatch(/es(in|out|precision)\b/);
        }
    });

    it('feathers the matte with smoothstep over a explicit ramp', () => {
        expect(start).toBeGreaterThan(-1);
        expect(fragment).toContain('smoothstep(0.35, 0.65, raw)');
    });

    it('binds the four layers as separate textures', () => {
        for (const uniform of ['u_bg', 'u_video', 'u_mask', 'u_overlays']) {
            expect(fragment, uniform).toContain(`uniform sampler2D ${uniform}`);
        }
        for (const uniform of ['u_hasBg', 'u_spill']) {
            expect(fragment, uniform).toContain(`uniform float ${uniform}`);
        }
    });

    it('suppresses the rim halo with the background colour', () => {
        expect(fragment).toContain('u_spill');
        expect(fragment).toMatch(/rim/);
        expect(fragment).toContain('bg.rgb * u_spill');
    });

    it('carries the camera through unmasked when no background is set', () => {
        expect(fragment).toContain('u_hasBg');
        expect(fragment).toMatch(/mix\(cam\.rgb/);
    });
});

describe('loadLayerImage', () => {
    function imageCtor({ failUrls = [], succeed = true } = {}) {
        return class FakeImage {
            constructor() { this.crossOrigin = null; this.naturalWidth = 0; this.naturalHeight = 0; }
            set src(value) {
                this._src = value;
                setTimeout(() => {
                    const fail = failUrls.some((u) => value.includes(u));
                    if (fail || !succeed) { if (this.onerror) this.onerror(new Error('nope')); return; }
                    this.naturalWidth = 1080;
                    this.naturalHeight = 1920;
                    if (this.onload) this.onload();
                }, 0);
            }
            get src() { return this._src; }
        };
    }

    it('loads a same-origin layer without a crossOrigin attribute', async () => {
        const image = await loadLayerImage({
            url: '/overlays/backgrounds/studio.png',
            ImageCtor: imageCtor(),
        });
        expect(image).toBeTruthy();
        expect(image.crossOrigin).toBeNull();
    });

    it('loads a remote image with crossOrigin="anonymous" so the canvas is never tainted', async () => {
        const image = await loadLayerImage({
            url: 'https://r2.ultrafastfluency.com/bg/studio.png',
            ImageCtor: imageCtor(),
        });
        expect(image).toBeTruthy();
        expect(image.crossOrigin).toBe('anonymous');
    });

    it('retries a CORS-blocked remote image through the operator proxy', async () => {
        const Ctor = imageCtor({ failUrls: ['https://blocked.example.com'] });
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            blob: async () => new Blob(['x']),
        });
        const image = await loadLayerImage({
            url: 'https://blocked.example.com/bg.png',
            operatorKey: 'secret',
            ImageCtor: Ctor,
            fetchImpl,
            createObjectURL: () => 'blob:layer',
            revokeObjectURL: vi.fn(),
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/pipeline/proxy-image?url=');
        expect(String(fetchImpl.mock.calls[0][0])).toContain(encodeURIComponent('https://blocked.example.com/bg.png'));
        expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { 'x-operator-key': 'secret' } });
        expect(image).toBeTruthy();
    });

    it('returns null when the image cannot be loaded at all', async () => {
        const image = await loadLayerImage({
            url: 'https://blocked.example.com/bg.png',
            ImageCtor: imageCtor({ succeed: false }),
        });
        expect(image).toBeNull();
    });

    it('does nothing without a url or an Image constructor', async () => {
        await expect(loadLayerImage({ url: null })).resolves.toBeNull();
        await expect(loadLayerImage({ url: 'x.png', ImageCtor: null })).resolves.toBeNull();
    });
});
