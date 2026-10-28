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

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
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
    // The ATTRIBUTE form matters: some mobile browsers gate autoplay on it,
    // and a hidden video that never plays means no frames, no mask, no take.
    if ('defaultMuted' in video) {
        try { video.defaultMuted = true; } catch (e) { /* test fake */ }
    }
    video.playsInline = true;
    if (video.setAttribute) {
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
    }
    if (video.style) {
        video.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
    }
    appendToBody(video);
    video.srcObject = rawStream;
    // A paused hidden video is a dead composite: the camera callback only fires
    // on new frames, so this is retried by the watchdog as well as here.
    function playHiddenVideo() {
        if (state.disposed) return;
        try {
            if (video.paused === false) return;
            const playResult = video.play ? video.play() : null;
            if (playResult && typeof playResult.catch === 'function') {
                playResult.catch((e) => console.warn('[Substitution] camera playback failed', e && e.message));
            }
        } catch (e) { /* the watchdog retries on its next pass */ }
    }
    try {
        if (typeof video.addEventListener === 'function') {
            video.addEventListener('loadedmetadata', playHiddenVideo);
        }
    } catch (e) { /* test fake without events */ }

    // The camera's frames, read straight off the track. A second <video>
    // element decoding the same camera is at the mercy of the phone: autoplay
    // refusals and hidden-video throttling leave it with no frames at all
    // (readyState 0, zero dimensions) while the visible preview plays fine —
    // a dead composite with no error anywhere. The track reader needs no
    // element, no autoplay and no visibility, so it cannot be starved that
    // way. Where the API is missing the hidden video remains the source.
    let frameReader = null;
    let frameSource = 'element';
    try {
        const tracks = rawStream && typeof rawStream.getVideoTracks === 'function'
            ? rawStream.getVideoTracks()
            : [];
        const Processor = typeof MediaStreamTrackProcessor !== 'undefined'
            ? MediaStreamTrackProcessor
            : null;
        if (Processor && tracks[0]) {
            frameReader = new Processor({ track: tracks[0] }).readable.getReader();
            frameSource = 'track';
        }
    } catch (e) {
        console.warn('[Substitution] track reader unavailable, using the hidden video', e && e.message);
        frameReader = null;
        frameSource = 'element';
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

    // TWO canvases, deliberately. MediaPipe's GPU graph may read the input
    // canvas after `segmentForVideo` returns (the readback is what stalls), so
    // writing the mask back into the SAME canvas fed the model the previous
    // frame's mask instead of the camera: the model found no person, answered
    // with zeros, and the composite painted a clean backdrop with nobody in it.
    // The input canvas is only ever painted from the camera.
    const segmenterInputCanvas = maskInputCanvas || createCanvas();
    segmenterInputCanvas.width = maskWidth;
    segmenterInputCanvas.height = maskHeight;
    const segmenterInputCtx = segmenterInputCanvas.getContext
        ? segmenterInputCanvas.getContext('2d')
        : null;

    // The mask TEXTURE (RGBA, alpha in .r) the shader samples.
    const maskCanvas = createCanvas();
    maskCanvas.width = maskWidth;
    maskCanvas.height = maskHeight;
    const maskCtx = maskCanvas.getContext ? maskCanvas.getContext('2d') : null;

    const state = {
        background,
        foreground,
        selection,
        tuning,
        images,
        mask: null,
        maskImageData: null,
        maskCoverage: 0,
        latestFrame: null,
        framesDrawn: 0,
        sourceAdvances: 0,
        lastSourceTime: 0,
        lastMaskAtMs: -Infinity,
        lastPaintAtMs: 0,
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

    // The camera's live size, preferring the track frame (which exists even when
    // the hidden video is starved) over the hidden video's dimensions.
    function cameraSize() {
        const frame = state.latestFrame;
        const w = (frame && (frame.displayWidth || frame.codedWidth))
            || video.videoWidth || 0;
        const h = (frame && (frame.displayHeight || frame.codedHeight))
            || video.videoHeight || 0;
        return { w, h };
    }

    // Whatever the painter draws: the latest track frame, else the hidden
    // video once it has decoded its first frame. Both are valid drawImage /
    // texImage2D sources.
    function frameImage() {
        if (state.latestFrame) return state.latestFrame;
        if (video.videoWidth && video.videoHeight) return video;
        return null;
    }

    function cameraCropRect() {
        const { w, h } = cameraSize();
        if (!w || !h) return null;
        return resolveCoverRect({
            imageWidth: w,
            imageHeight: h,
            canvasWidth: width,
            canvasHeight: height,
        });
    }

    /**
     * The mask input's SOURCE rect (`sx/sy/sw/sh`, the drawImage crop form).
     *
     * `resolveCoverRect` speaks destination coordinates (`dx/dy/dw/dh`) because
     * that is what the output canvas needs. Reading `.sx` off it yields
     * `undefined`, `drawImage` then treats an undefined source rect as 0×0,
     * nothing is drawn, the model sees a blank frame and returns an all-zero
     * mask — a take that looks like a clean backdrop with no person in it.
     */
    function maskSourceRect() {
        // The MASK input covers the same cropped region as the canvas, so the
        // matte lines up with the picture after both are scaled to the frame.
        const { w, h } = cameraSize();
        const rect = resolveCoverRect({
            imageWidth: w,
            imageHeight: h,
            canvasWidth: maskWidth,
            canvasHeight: maskHeight,
        });
        if (!rect) return null;
        return { sx: rect.dx, sy: rect.dy, sw: rect.dw, sh: rect.dh };
    }

    function paintMaskTexture() {
        if (!state.mask || !maskCanvas) return false;
        if (!maskCtx) return false;
        const data = new Uint8ClampedArray(maskWidth * maskHeight * 4);
        let covered = 0;
        for (let i = 0; i < state.mask.length; i++) {
            const value = state.mask[i];
            if (value > 128) covered += 1;
            const o = i * 4;
            data[o] = value;
            data[o + 1] = value;
            data[o + 2] = value;
            data[o + 3] = 255;
        }
        // How much of the frame the matte calls "person". An all-zero mask (no
        // subject found, or a blank frame fed to the model) is the difference
        // between a take with you in it and a clean backdrop with nobody, and it
        // is otherwise invisible: the composite fails silently and looks fine.
        state.maskCoverage = state.mask.length ? covered / state.mask.length : 0;
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
        const source = frameImage();
        if (!source) return false;
        const crop = cameraCropRect();
        if (!crop) return false;

        // One inference per camera frame: the mask input is 256×256, so the
        // copy is cheap and the matte is never a frame behind the picture.
        if (segmenter && typeof paintMask === 'function') {
            const nextMask = paintMask({
                segmenter,
                maskInputCanvas: segmenterInputCanvas,
                maskInputCtx: segmenterInputCtx,
                video: source,
                cropRect: maskSourceRect(),
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
                video: source,
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
                pctx.drawImage(source, crop.dx, crop.dy, crop.dw, crop.dh);
                // Cut the person out of the SCRATCH canvas: doing this on the
                // main canvas would erase the background drawn under it.
                pctx.globalCompositeOperation = 'destination-in';
                pctx.drawImage(maskCanvas, 0, 0, maskWidth, maskHeight, 0, 0, width, height);
                pctx.globalCompositeOperation = 'source-over';
                main2d.drawImage(personCanvas, 0, 0);
            }
        } else {
            main2d.drawImage(source, crop.dx, crop.dy, crop.dw, crop.dh);
        }
        main2d.drawImage(overlaysCanvas, 0, 0);
        state.framesDrawn += 1;
        return true;
    }

    // The track reader IS the frame driver where it exists: frames arrive as
    // the camera captures them, which is also what keeps the picture from
    // lagging the live microphone. The camera callback + watchdog below only
    // drive the fallback element path, so a phone never pays for two drivers.
    let pumpRunning = false;
    async function pumpFrames() {
        if (pumpRunning || !frameReader) return;
        pumpRunning = true;
        // done:true means the track itself ended (the element on the same track
        // would get nothing either), so only a failed read degrades to it.
        let readFailed = false;
        try {
            while (!state.disposed && !stopped) {
                let next = null;
                try {
                    const read = await frameReader.read();
                    if (!read || read.done) break;
                    next = read.value || null;
                } catch (e) {
                    console.warn('[Substitution] frame read failed', e && e.message);
                    readFailed = true;
                    break;
                }
                if (!next) continue;
                const prev = state.latestFrame;
                state.latestFrame = next;
                if (prev) {
                    try { prev.close(); } catch (e) { /* already closed */ }
                }
                safePaint();
                state.sourceAdvances += 1;
            }
        } finally {
            pumpRunning = false;
            // The reader broke while the track may still be live: degrade to
            // the hidden video so the composite still has a source to try.
            if (readFailed && !state.disposed && !stopped && frameReader) {
                frameReader = null;
                frameSource = 'element';
                playHiddenVideo();
            }
        }
    }

    let frameCallbackId = null;
    let rafId = null;
    let stopped = false;
    const hasFrameCallback = !frameReader && typeof video.requestVideoFrameCallback === 'function';
    // How long the display loop waits for a camera-frame paint before painting
    // anyway. The camera callback is the steady-state driver (one paint per
    // camera frame, so the picture never lags the live microphone); the display
    // loop is the watchdog that gets the first frame out and recovers a camera
    // that never fires its first callback. Either one alone deadlocks on a
    // phone: no callback means no paint, and one throwing frame used to stop
    // every future frame because the re-arm sat after the paint.
    const WATCHDOG_PAINT_AFTER_MS = 500;

    function noteSourceAdvance() {
        try {
            if (video.currentTime > state.lastSourceTime) {
                state.lastSourceTime = video.currentTime;
                state.sourceAdvances += 1;
            }
        } catch (e) { /* test fake */ }
    }

    function safePaint() {
        try {
            if (paintFrame()) state.lastPaintAtMs = now();
        } catch (e) {
            console.warn('[Substitution] frame failed', e && e.message);
        }
        noteSourceAdvance();
    }

    function tick() {
        if (stopped || state.disposed) return;
        try {
            if (now() - state.lastPaintAtMs > WATCHDOG_PAINT_AFTER_MS) {
                if (!frameReader) playHiddenVideo();
                safePaint();
            }
        } catch (e) { /* the watchdog itself must never die */ }
        rafId = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(tick) : null;
    }

    // Paint once per CAMERA frame where the platform supports it: `captureStream`
    // timestamps a frame when the canvas is painted, so a paint that runs on a
    // display tick after the camera frame is picture latency against a live
    // microphone.
    if (hasFrameCallback) {
        const onSourceFrame = () => {
            if (stopped || state.disposed) return;
            try {
                safePaint();
            } finally {
                try {
                    frameCallbackId = video.requestVideoFrameCallback(onSourceFrame);
                } catch (e) { /* camera gone; the watchdog keeps trying */ }
            }
        };
        try {
            frameCallbackId = video.requestVideoFrameCallback(onSourceFrame);
        } catch (e) { /* the watchdog below drives until the camera appears */ }
    }
    state.lastPaintAtMs = now();
    // In track mode the hidden video stays parked: a muted playsinline video
    // can autoplay on its own, which would spin up the second decoder for
    // frames nobody reads (and double-count the source clock). If the track
    // later dies the pump degrades back to the element.
    if (!frameReader) {
        playHiddenVideo();
    } else {
        try { video.pause(); } catch (e) { /* already parked */ }
        pumpFrames();
    }
    tick();

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
                coverage: Math.round((state.maskCoverage || 0) * 100),
                compositor: glCompositor ? 'webgl2' : '2d',
                // Which path feeds the painter: 'track' reads the camera track
                // directly, 'element' decodes it through the hidden video.
                source: frameSource,
                // The hidden camera's own state: when the composite shows nothing,
                // this says whether the camera itself ever arrived (w/h are 0
                // until its first frame decodes).
                video: {
                    w: video.videoWidth || 0,
                    h: video.videoHeight || 0,
                    readyState: typeof video.readyState === 'number' ? video.readyState : -1,
                    paused: video.paused !== false,
                },
            };
        },
        paintNow() {
            return paintFrame();
        },
        dispose() {
            if (state.disposed) return;
            state.disposed = true;
            stopped = true;
            if (frameReader) {
                try {
                    const cancelled = frameReader.cancel();
                    if (cancelled && typeof cancelled.catch === 'function') {
                        cancelled.catch(() => {});
                    }
                } catch (e) { /* already released */ }
                try { frameReader.releaseLock(); } catch (e) { /* already released */ }
            }
            if (state.latestFrame) {
                try { state.latestFrame.close(); } catch (e) { /* already closed */ }
                state.latestFrame = null;
            }
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
