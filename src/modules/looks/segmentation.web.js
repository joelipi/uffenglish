// Browser adapter for the selfie segmenter used by the operator studio's live
// background replacement (stories/100).
//
// The model input is a 256×256 copy of the centre-cropped camera frame, NOT the
// camera's own resolution. That is the whole point of this file: MediaPipe
// returns a mask at the size of whatever it was given, so handing it the
// 1920×1080 <video> would mean a 2,073,600-float (8 MB) GPU→CPU readback every
// frame on the main thread — which is exactly how a recorded picture falls
// behind the live microphone (see the composite-lag guidance in AGENTS.md).
// At 256×256 the mask is 65,536 bytes and the readback does not matter.
//
// Nothing here touches the DOM beyond the canvas it is handed, so the whole
// adapter is driven in tests with an injected segmenter factory and fake
// contexts.

import { blendMaskAlpha } from './background-substitution-logic.js';

/** Where the vendored WASM fileset and model live (see scripts/sync-mediapipe-assets.mjs). */
export const MEDIAPIPE_FILESET_PATH = '/mediapipe/wasm';
export const SEGMENTER_MODEL_PATH = '/mediapipe/selfie_segmenter_landscape.tflite';

/**
 * Create and configure a segmenter.
 *
 * GPU first, CPU second: the CPU delegate works everywhere but costs several
 * times the frame budget, and a device that cannot do either must degrade to the
 * unmasked raw stream rather than record a stuttering take. Every failure is
 * swallowed into `null` so no caller can forget a rejection.
 *
 * @param {{ filesetPath?: string, modelPath?: string, createSegmenter?: Function }} [options]
 * @returns {Promise<object|null>}
 */
export async function loadSegmenter({
    filesetPath = MEDIAPIPE_FILESET_PATH,
    modelPath = SEGMENTER_MODEL_PATH,
    createSegmenter = defaultCreateSegmenter,
} = {}) {
    for (const delegate of ['GPU', 'CPU']) {
        try {
            const handle = await createSegmenter({ filesetPath, modelPath, delegate });
            if (handle) {
                console.log('[Segmenter] ready', { delegate });
                return handle;
            }
            console.warn('[Segmenter] creation returned nothing', { delegate });
        } catch (e) {
            console.warn('[Segmenter] creation failed', { delegate, message: e && e.message });
        }
    }
    console.warn('[Segmenter] unavailable — the take will record the unmasked camera');
    return null;
}

/**
 * The real factory. Loaded lazily so importing this module never requires the
 * MediaPipe bundle (tests, jsdom, and the app build all import it).
 */
async function defaultCreateSegmenter({ filesetPath, modelPath, delegate }) {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(filesetPath);
    return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: 'VIDEO',
        // The confidence mask is what the shader feathers; the category mask is
        // a label per pixel and cannot be blended.
        outputCategoryMask: false,
        outputConfidenceMasks: true,
    });
}

/** The 2d context / canvas a frame is downscaled into before inference. */
function resolveMaskInput({ maskInputCanvas, maskInputCtx }) {
    if (maskInputCtx) return { ctx: maskInputCtx, canvas: maskInputCtx.canvas || maskInputCanvas };
    if (maskInputCanvas && typeof maskInputCanvas.getContext === 'function') {
        return { ctx: maskInputCanvas.getContext('2d'), canvas: maskInputCanvas };
    }
    return { ctx: null, canvas: null };
}

/**
 * Produce one frame's alpha mask.
 *
 * @param {{
 *   segmenter: object|null,
 *   maskInputCanvas?: object,
 *   maskInputCtx?: object,
 *   video: object,
 *   cropRect: {sx:number,sy:number,sw:number,sh:number}|null,
 *   maskWidth: number,
 *   maskHeight: number,
 *   timestampMs: number,
 *   previousMask?: Uint8Array|null,
 * }} input
 * @returns {Uint8Array|null} the blended mask, or `previousMask` when this frame
 *   produced nothing (a single dropped inference must not blank the matte)
 */
export function segmentFrameToMask({
    segmenter,
    maskInputCanvas = null,
    maskInputCtx = null,
    video,
    cropRect,
    maskWidth,
    maskHeight,
    timestampMs = 0,
    previousMask = null,
}) {
    if (!segmenter || !video || !cropRect) return previousMask;
    // A source rect with a missing or zero dimension draws NOTHING, so the model
    // sees a blank frame and answers with an all-zero mask — a take that looks
    // like a clean backdrop with no person in it, and no error anywhere. Fail
    // loudly instead (this is how a `{dx,dy,dw,dh}` rect once reached here).
    if (![cropRect.sx, cropRect.sy, cropRect.sw, cropRect.sh]
        .every((v) => Number.isFinite(v)) || cropRect.sw <= 0 || cropRect.sh <= 0) {
        console.error('[Segmenter] refusing an empty source rect', cropRect);
        return previousMask;
    }
    const { ctx, canvas } = resolveMaskInput({ maskInputCanvas, maskInputCtx });
    if (!ctx || !canvas) return previousMask;

    try {
        // Downscale FIRST: this is the frame the model sees.
        ctx.drawImage(
            video,
            cropRect.sx, cropRect.sy, cropRect.sw, cropRect.sh,
            0, 0, maskWidth, maskHeight,
        );
    } catch (e) {
        return previousMask;
    }

    let result = null;
    try {
        result = segmenter.segmentForVideo(canvas, timestampMs);
        const confidence = result && result.confidenceMasks && result.confidenceMasks[0];
        if (!confidence) return previousMask;
        const next = confidence.getAsFloat32Array();
        if (!next || next.length === 0) return previousMask;
        return blendMaskAlpha({ next, previous: previousMask });
    } catch (e) {
        console.warn('[Segmenter] frame failed', e && e.message);
        return previousMask;
    } finally {
        // MediaPipe holds GPU resources in the result until it is closed; a
        // leaked result per frame exhausts the GPU in seconds.
        try {
            if (result && typeof result.close === 'function') result.close();
        } catch (e) { /* already closed */ }
    }
}

/**
 * Release a segmenter. Idempotent, and never throws (the studio disposes on
 * every path, including the one where the segmenter never loaded).
 */
export function disposeSegmenter(segmenter) {
    if (!segmenter) return;
    try {
        if (typeof segmenter.close === 'function') segmenter.close();
    } catch (e) {
        console.warn('[Segmenter] close failed', e && e.message);
    }
}
