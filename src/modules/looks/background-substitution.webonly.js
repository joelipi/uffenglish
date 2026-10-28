// Browser adapter for the operator studio's live background/foreground
// substitution (stories/100).
//
// One capture stream, one canvas, and the canvas IS the recorded video:
//
//   background ─▶ camera through the matte ─▶ foreground ─▶ props/emoji ─▶ captureStream
//
// `MediaRecorder` and the on-screen preview are handed the SAME MediaStream
// object, so the preview can never disagree with the file — the operator's
// correction loop is "see it, reject the take, re-record".
//
// Two compositors, because the fast one is not universally available:
//   * WebGL2 (the shipping path on Android Chrome): a 256×256 mask texture is
//     upscaled by the GPU with hardware bilinear filtering, feathered with
//     `smoothstep`, and light-wrapped at the rim — one draw call per frame.
//   * 2D canvas fallback (and the unit-tested path): the person is cut out into
//     an OFFSCREEN canvas with `destination-in`, then drawn over the background.
//     Doing `destination-in` on the main canvas would erase the background too —
//     that is the bug this split exists to prevent.
//
// Every decision that can be made without a browser lives in
// background-substitution-logic.js; this file only moves pixels.

import {
    resolveSubstitutionDimensions,
} from './background-substitution-logic.js';
import { paintLooks } from './recording-looks-logic.js';

/**
 * The document, or null off-DOM. A single helper so this module has one guarded
 * entry point to browser globals (the lint rule flags every `document.` member
 * expression, and a per-call `typeof` guard is easy to miss).
 */
function safeDocument() {
    return typeof document === 'undefined' ? null : document;
}

/**
 * Append a parked node when there is a document. A fake node (the unit-test
 * canvases) is not a DOM node, so it is skipped rather than throwing.
 */
function appendToBody(node) {
    const doc = safeDocument();
    if (!node || !doc || !doc.body || typeof doc.body.appendChild !== 'function') return;
    try {
        doc.body.appendChild(node);
    } catch (e) {
        // Not a real DOM node: nothing to park.
    }
}

/**
 * Whether this browser can build a WebGL2 context at all.
 *
 * Probed on a THROWAWAY canvas because a canvas keeps the first context type it
 * is asked for: testing on the real one would lock it to WebGL2 and destroy the
 * 2D fallback.
 */
function webgl2Available(createCanvas) {
    try {
        const probe = createCanvas();
        if (!probe || typeof probe.getContext !== 'function') return false;
        return !!probe.getContext('webgl2');
    } catch (e) {
        return false;
    }
}

/** Cover-fit rect for an image inside a 9:16 canvas (no letterboxing). */export function resolveCoverRect({ imageWidth, imageHeight, canvasWidth, canvasHeight }) {
    if (!(imageWidth > 0) || !(imageHeight > 0) || !(canvasWidth > 0) || !(canvasHeight > 0)) return null;
    const scale = Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight);
    const dw = imageWidth * scale;
    const dh = imageHeight * scale;
    return { dx: (canvasWidth - dw) / 2, dy: (canvasHeight - dh) / 2, dw, dh };
}

/**
 * Load one replacement layer image.
 *
 * Cross-origin images are fetched with `crossOrigin = 'anonymous'`: a canvas is
 * tainted the moment a non-CORS image is drawn into it, and a tainted canvas
 * makes `captureStream()` throw — i.e. the take could not be recorded at all.
 *
 * When the remote host does not send `Access-Control-Allow-Origin` the direct
 * load fails (it errors instead of tainting, precisely because of the
 * crossOrigin attribute); the operator-key proxy then returns the same bytes
 * same-origin, which can never taint.
 *
 * @returns {Promise<object|null>} a decoded image, or null
 */
export async function loadLayerImage({
    url,
    operatorKey = '',
    ImageCtor = typeof Image !== 'undefined' ? Image : null,
    fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
    createObjectURL = typeof URL !== 'undefined' ? (b) => URL.createObjectURL(b) : null,
    revokeObjectURL = typeof URL !== 'undefined' ? (u) => URL.revokeObjectURL(u) : null,
} = {}) {
    if (!url || !ImageCtor) return null;
    const remote = /^https:/i.test(url);
    const direct = await tryLoadImage({ url, crossOrigin: remote ? 'anonymous' : null, ImageCtor });
    if (direct) return direct;
    if (!remote || !operatorKey || !fetchImpl) {
        console.warn('[Substitution] layer image failed to load', { url });
        return null;
    }
    return loadLayerImageViaProxy({ url, operatorKey, ImageCtor, fetchImpl, createObjectURL, revokeObjectURL });
}

function tryLoadImage({ url, crossOrigin, ImageCtor }) {
    return new Promise((resolve) => {
        let image;
        try {
            image = new ImageCtor();
        } catch (e) {
            resolve(null);
            return;
        }
        if (crossOrigin) image.crossOrigin = crossOrigin;
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        try {
            image.src = url;
        } catch (e) {
            resolve(null);
        }
    });
}

async function loadLayerImageViaProxy({ url, operatorKey, ImageCtor, fetchImpl, createObjectURL, revokeObjectURL }) {
    try {
        const response = await fetchImpl(
            `/api/pipeline/proxy-image?url=${encodeURIComponent(url)}`,
            { headers: { 'x-operator-key': operatorKey } }
        );
        if (!response || !response.ok) {
            console.warn('[Substitution] proxy refused the layer image', { url, status: response && response.status });
            return null;
        }
        const blob = await response.blob();
        const objectUrl = createObjectURL(blob);
        const image = await tryLoadImage({ url: objectUrl, crossOrigin: null, ImageCtor });
        // The image keeps its decoded pixels; the blob URL is only the source.
        if (revokeObjectURL) revokeObjectURL(objectUrl);
        return image;
    } catch (e) {
        console.warn('[Substitution] proxy failed', e && e.message);
        return null;
    }
}

const VERTEX_SHADER = `#version 300 esin vec2 a_pos;
out vec2 v_tex;
void main() {
    v_tex = (a_pos + 1.0) * 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Three textures in, one frame out:
//   u_bg       the replacement background (behind)
//   u_video    the camera frame, already cover-cropped
//   u_mask     alpha as a single channel in .r, 256×256, bilinear on the GPU
//   u_overlays the foreground + prop/emoji layer (a 2D canvas, straight alpha)
// `u_hasBg` disables the matte entirely (no background configured): the camera
// then goes through untouched instead of being cut out against black.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_tex;
uniform sampler2D u_bg;
uniform sampler2D u_video;
uniform sampler2D u_mask;
uniform sampler2D u_overlays;
uniform float u_hasBg;
uniform float u_spill;
out vec4 outColor;

void main() {
    vec4 bg = texture(u_bg, v_tex);
    vec4 cam = texture(u_video, v_tex);

    // Feather the matte: a hard binary edge reads as a sticker, and the model's
    // own output is soft enough that the ramp barely moves the silhouette.
    float raw = texture(u_mask, v_tex).r;
    float mask = smoothstep(0.35, 0.65, raw);

    // Light wrap: bleed a little of the new background into the rim so a bright
    // room does not leave a white halo around hair and shoulders.
    float rim = clamp(1.0 - abs(raw - 0.5) / 0.35, 0.0, 1.0);
    vec3 person = cam.rgb + bg.rgb * u_spill * rim * u_hasBg;

    vec3 rgb = mix(cam.rgb, mix(bg.rgb, person, mask), u_hasBg);

    vec4 overlay = texture(u_overlays, v_tex);
    rgb = mix(rgb, overlay.rgb, overlay.a);

    outColor = vec4(rgb, 1.0);
}`;

function compileShader(gl, type, source) {    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`shader compile failed: ${log}`);
    }
    return shader;
}

function createGlCompositor(gl, { width, height }) {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
        bg: gl.getUniformLocation(program, 'u_bg'),
        video: gl.getUniformLocation(program, 'u_video'),
        mask: gl.getUniformLocation(program, 'u_mask'),
        overlays: gl.getUniformLocation(program, 'u_overlays'),
        hasBg: gl.getUniformLocation(program, 'u_hasBg'),
        spill: gl.getUniformLocation(program, 'u_spill'),
    };

    const makeTexture = (unit) => {
        const texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return { texture, unit };
    };

    const textures = {
        bg: makeTexture(0),
        video: makeTexture(1),
        mask: makeTexture(2),
        overlays: makeTexture(3),
    };

    gl.uniform1i(uniforms.bg, textures.bg.unit);
    gl.uniform1i(uniforms.video, textures.video.unit);
    gl.uniform1i(uniforms.mask, textures.mask.unit);
    gl.uniform1i(uniforms.overlays, textures.overlays.unit);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.viewport(0, 0, width, height);

    function upload(slot, source) {
        if (!source) return;
        gl.activeTexture(gl.TEXTURE0 + textures[slot].unit);
        gl.bindTexture(gl.TEXTURE_2D, textures[slot].texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }

    return {
        draw({ background, video, maskCanvas, overlaysCanvas, spill }) {
            upload('bg', background);
            upload('video', video);
            upload('mask', maskCanvas);
            upload('overlays', overlaysCanvas);
            gl.uniform1f(uniforms.hasBg, background ? 1 : 0);
            gl.uniform1f(uniforms.spill, spill);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        },
        dispose() {
            for (const entry of Object.values(textures)) gl.deleteTexture(entry.texture);
            gl.deleteBuffer(buffer);
            gl.deleteProgram(program);
        },
    };
}

/**
 * Build the substituted capture stream.
 *
 * @param {{
 *   rawStream: MediaStream,
 *   createCanvas?: () => HTMLCanvasElement,
 *   createVideo?: () => HTMLVideoElement,
 *   dimensions?: {width:number,height:number,fps:number,maskWidth:number,maskHeight:number},
 *   segmenter?: object|null,
 *   maskInputCanvas?: object|null,
 *   background?: object|null,
 *   foreground?: object|null,
 *   selection?: object|null,
 *   tuning?: object|null,
 *   images?: Record<string, object>,
 *   paintBeauty?: Function|null,
 *   paintMask?: (input: object) => Uint8Array|null,
 *   now?: () => number,
 * }} options
 */
export function createSubstitutedCaptureStream({
    rawStream,
    createCanvas = () => {
        const doc = safeDocument();
        return doc ? doc.createElement('canvas') : null;
    },
    createVideo = () => {
        const doc = safeDocument();
        return doc ? doc.createElement('video') : null;
    },
    dimensions = resolveSubstitutionDimensions(),
    segmenter = null,
    maskInputCanvas = null,
    background = null,
    foreground = null,
    selection = null,
    tuning = null,
    images = {},
    paintBeauty = null,
    paintMask = null,
    now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
} = {}) {
    const { width, height, fps, maskWidth, maskHeight } = dimensions;

    const canvas = createCanvas();
    canvas.width = width;
    canvas.height = height;
    if (canvas.style) {
        // Parked off-flow, like the app's composite canvas: it must be in the
        // document for Safari to keep painting it, but must never be seen.
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
    }
    appendToBody(canvas);

    const video = createVideo();
    video.muted = true;
    video.playsInline = true;
    if (video.setAttribute) {
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
    }
    if (video.style) {
        video.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
    }
    appendToBody(video);
    video.srcObject = rawStream;
    const playResult = video.play ? video.play() : null;
    if (playResult && typeof playResult.catch === 'function') {
        playResult.catch((e) => console.warn('[Substitution] camera playback failed', e && e.message));
    }

    // Renderer selection. A canvas has exactly ONE context for its lifetime, so
    // order matters: asking for '2d' first permanently denies 'webgl2' — which is
    // how the shader below could never run and every take fell back to two
    // full-resolution 2D draws per frame (the path that drifts). WebGL2 is
    // probed on a THROWAWAY canvas before this one commits to a context, and a
    // shader that fails to build after the real context exists moves the output
    // to a fresh 2D canvas rather than painting nothing at all.
    let outputCanvas = canvas;
    let glCompositor = null;
    let main2d = null;
    if (webgl2Available(createCanvas)) {
        try {
            const gl = outputCanvas.getContext
                ? outputCanvas.getContext('webgl2', { alpha: false, desynchronized: true })
                : null;
            if (gl) glCompositor = createGlCompositor(gl, dimensions);
        } catch (e) {
            console.warn('[Substitution] WebGL2 compositor unavailable, using 2D', e && e.message);
            glCompositor = null;
        }
    }
    if (!glCompositor) {
        // If this canvas already holds an unusable WebGL2 context it can never
        // give us 2D, so the output moves to a clean canvas. This happens before
        // captureStream, so the recorded track comes from the canvas we paint.
        const stuckOnWebgl2 = typeof outputCanvas.getContext === 'function'
            && !outputCanvas.getContext('2d');
        if (stuckOnWebgl2) {
            outputCanvas = createCanvas();
            outputCanvas.width = width;
            outputCanvas.height = height;
            if (outputCanvas.style) {
                outputCanvas.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
            }
            appendToBody(outputCanvas);
        }
        main2d = outputCanvas.getContext ? outputCanvas.getContext('2d') : null;
    }
    const personCanvas = glCompositor ? null : createCanvas();
    if (personCanvas) {
        personCanvas.width = width;
        personCanvas.height = height;
    }
    const overlaysCanvas = createCanvas();
    overlaysCanvas.width = width;
    overlaysCanvas.height = height;
    const overlaysCtx = overlaysCanvas.getContext ? overlaysCanvas.getContext('2d') : null;

    const maskCanvas = maskInputCanvas || createCanvas();
    maskCanvas.width = maskWidth;
    maskCanvas.height = maskHeight;
    const maskCtx = maskCanvas.getContext ? maskInputCanvas ? null : maskCanvas.getContext('2d') : null;

    const state = {
        background,
        foreground,
        selection,
        tuning,
        images,
        mask: null,
        maskImageData: null,
        framesDrawn: 0,
        sourceAdvances: 0,
        lastSourceTime: 0,
        lastMaskAtMs: -Infinity,
        disposed: false,
    };

    function coverRectFor(image) {
        return resolveCoverRect({
            imageWidth: image && image.naturalWidth,
            imageHeight: image && image.naturalHeight,
            canvasWidth: width,
            canvasHeight: height,
        });
    }

    function cameraCropRect() {
        return resolveCoverRect({
            imageWidth: video.videoWidth,
            imageHeight: video.videoHeight,
            canvasWidth: width,
            canvasHeight: height,
        });
    }

    function maskCropRect() {
        // The MASK input covers the same cropped region as the canvas, so the
        // matte lines up with the picture after both are scaled to the frame.
        return resolveCoverRect({
            imageWidth: video.videoWidth,
            imageHeight: video.videoHeight,
            canvasWidth: maskWidth,
            canvasHeight: maskHeight,
        });
    }

    function paintMaskTexture() {
        if (!state.mask || !maskCanvas) return false;
        if (!maskCtx) return false;
        const data = new Uint8ClampedArray(maskWidth * maskHeight * 4);
        for (let i = 0; i < state.mask.length; i++) {
            const value = state.mask[i];
            const o = i * 4;
            data[o] = value;
            data[o + 1] = value;
            data[o + 2] = value;
            data[o + 3] = 255;
        }
        state.maskImageData = state.maskImageData || maskCtx.createImageData(maskWidth, maskHeight);
        state.maskImageData.data.set(data);
        maskCtx.putImageData(state.maskImageData, 0, 0);
        return true;
    }

    function paintOverlays({ withForeground }) {
        if (!overlaysCtx) return false;
        overlaysCtx.clearRect(0, 0, width, height);
        if (withForeground && state.foreground) {
            const rect = coverRectFor(state.foreground);
            if (rect) overlaysCtx.drawImage(state.foreground, rect.dx, rect.dy, rect.dw, rect.dh);
        }
        if (typeof paintLooks === 'function') {
            paintLooks({
                ctx: overlaysCtx,
                source: overlaysCanvas,
                scratch: personCanvas || overlaysCanvas,
                canvasWidth: width,
                canvasHeight: height,
                selection: state.selection,
                tuning: state.tuning,
                images: state.images,
                paintBeauty,
                maskCanvas: null,
                timeMs: now(),
                sourceDraw: null,
            });
        }
        return true;
    }

    function paintFrame() {
        if (state.disposed) return false;
        const crop = cameraCropRect();
        if (!crop) return false;

        // One inference per camera frame: the mask input is 256×256, so the
        // copy is cheap and the matte is never a frame behind the picture.
        if (segmenter && typeof paintMask === 'function') {
            const nextMask = paintMask({
                segmenter,
                maskInputCanvas: maskCanvas,
                maskInputCtx: maskCtx,
                video,
                cropRect: maskCropRect(),
                maskWidth,
                maskHeight,
                timestampMs: now(),
                previousMask: state.mask,
            });
            if (nextMask) state.mask = nextMask;
            state.lastMaskAtMs = now();
        }

        const useMatte = !!(state.background && state.mask && paintMaskTexture());
        paintOverlays({ withForeground: true });

        if (glCompositor) {
            glCompositor.draw({
                background: state.background,
                video,
                maskCanvas: useMatte ? maskCanvas : null,
                overlaysCanvas,
                spill: 0.15,
            });
            state.framesDrawn += 1;
            return true;
        }

        if (!main2d) return false;
        if (useMatte) {
            const rect = coverRectFor(state.background);
            if (rect) main2d.drawImage(state.background, rect.dx, rect.dy, rect.dw, rect.dh);
            const pctx = personCanvas.getContext ? personCanvas.getContext('2d') : null;
            if (pctx) {
                pctx.clearRect(0, 0, width, height);
                pctx.globalCompositeOperation = 'source-over';
                pctx.drawImage(video, crop.dx, crop.dy, crop.dw, crop.dh);
                // Cut the person out of the SCRATCH canvas: doing this on the
                // main canvas would erase the background drawn under it.
                pctx.globalCompositeOperation = 'destination-in';
                pctx.drawImage(maskCanvas, 0, 0, maskWidth, maskHeight, 0, 0, width, height);
                pctx.globalCompositeOperation = 'source-over';
                main2d.drawImage(personCanvas, 0, 0);
            }
        } else {
            main2d.drawImage(video, crop.dx, crop.dy, crop.dw, crop.dh);
        }
        main2d.drawImage(overlaysCanvas, 0, 0);
        state.framesDrawn += 1;
        return true;
    }

    let frameCallbackId = null;
    let rafId = null;
    let stopped = false;
    const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';

    function tick() {
        if (stopped || state.disposed) return;
        paintFrame();
        if (video.currentTime > state.lastSourceTime) {
            state.lastSourceTime = video.currentTime;
            state.sourceAdvances += 1;
        }
        rafId = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(tick) : null;
    }

    // Paint once per CAMERA frame where the platform supports it: `captureStream`
    // timestamps a frame when the canvas is painted, so a paint that runs on a
    // display tick after the camera frame is picture latency against a live
    // microphone.
    if (hasFrameCallback) {
        const onSourceFrame = () => {
            if (stopped || state.disposed) return;
            paintFrame();
            if (video.currentTime > state.lastSourceTime) {
                state.lastSourceTime = video.currentTime;
                state.sourceAdvances += 1;
            }
            frameCallbackId = video.requestVideoFrameCallback(onSourceFrame);
        };
        frameCallbackId = video.requestVideoFrameCallback(onSourceFrame);
    } else {
        tick();
    }

    const canvasStream = typeof outputCanvas.captureStream === 'function'
        ? outputCanvas.captureStream(fps)
        : null;
    const videoTracks = canvasStream ? canvasStream.getVideoTracks() : [];
    const audioTracks = rawStream && typeof rawStream.getAudioTracks === 'function'
        ? rawStream.getAudioTracks()
        : [];
    const stream = new MediaStream([...videoTracks, ...audioTracks]);

    return {
        stream,
        canvas: outputCanvas,
        /** Replace one layer (a decoded image, or null to clear it). */
        setLayer(kind, image) {
            if (kind === 'background') state.background = image || null;
            if (kind === 'foreground') state.foreground = image || null;
        },
        setSelection(next) {
            state.selection = next || null;
        },
        setTuning(next) {
            state.tuning = next || null;
        },
        setImages(next) {
            state.images = next || {};
        },
        /** Frame/liveness counters for the take diagnostics. */
        stats() {
            return {
                framesDrawn: state.framesDrawn,
                sourceAdvances: state.sourceAdvances,
                hasMatte: !!state.mask,
                compositor: glCompositor ? 'webgl2' : '2d',
            };
        },
        paintNow() {
            return paintFrame();
        },
        dispose() {
            if (state.disposed) return;
            state.disposed = true;
            stopped = true;
            if (frameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
                try { video.cancelVideoFrameCallback(frameCallbackId); } catch (e) { /* gone */ }
            }
            frameCallbackId = null;
            if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
            rafId = null;
            for (const track of videoTracks) {
                try { track.stop(); } catch (e) { /* already stopped */ }
            }
            try { video.pause(); } catch (e) { /* not playing */ }
            video.srcObject = null;
            if (glCompositor) glCompositor.dispose();
            glCompositor = null;
            for (const node of [outputCanvas, canvas, video]) {
                if (node && node.parentNode) node.parentNode.removeChild(node);
            }
        },
    };
}
