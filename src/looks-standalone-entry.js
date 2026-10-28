// Standalone bundle entry for the operator studio (stories/100).
//
// Built to a STABLE file name (`recorder-looks.js`, see vite.config.js) because
// the studio page is static HTML copied verbatim and cannot know a content hash.
// The page never imports anything itself: this module attaches one object to
// `window.UFFLooks`, and the page uses it when it is there. When the bundle is
// absent (the Vite dev server, jsdom) the page records the raw camera instead of
// failing, which is also the honest degraded state on an unsupported device.
//
// Everything of substance lives in the modules below; this file is the wiring
// that both consumers (this bundle and the React app) can share.

import {
    resolveAssetLayerState,
    resolveBackgroundSource,
    resolveForegroundSource,
    shouldStartTake,
    resolveExpandablePane,
    resolveSubstitutionDimensions,
    overlaySelectionFor,
    blendMaskAlpha,
} from './modules/looks/background-substitution-logic.js';
import {
    createSubstitutedCaptureStream,
    loadLayerImage,
} from './modules/looks/background-substitution.webonly.js';
import { loadSegmenter, segmentFrameToMask, disposeSegmenter } from './modules/looks/segmentation.web.js';
import {
    OVERLAY_SLOTS,
    overlaySlugsForSlot,
    assetFileForSlug,
    computeDragOffset,
    sanitizeTuning,
    emptyTuning,
} from './modules/looks/recording-looks-logic.js';

const DIMENSIONS = resolveSubstitutionDimensions();

/**
 * Create a live substituted capture for one recording session.
 *
 * @param {{
 *   rawStream: MediaStream,
 *   operatorKey?: string,
 *   background?: string,
 *   foreground?: string,
 *   onLayerState?: (state: {backgroundState: string, foregroundState: string}) => void,
 * }} options
 */
export async function createLiveLooks({
    rawStream,
    operatorKey = '',
    background: backgroundValue = '',
    foreground: foregroundValue = '',
    onLayerState = () => {},
} = {}) {
    const backgroundUrl = resolveBackgroundSource(backgroundValue);
    const foregroundUrl = resolveForegroundSource(foregroundValue);

    let backgroundImage = null;
    let foregroundImage = null;
    if (backgroundUrl) {
        backgroundImage = await loadLayerImage({ url: backgroundUrl, operatorKey });
    }
    if (foregroundUrl) {
        foregroundImage = await loadLayerImage({ url: foregroundUrl, operatorKey });
    }
    const layerState = {
        backgroundState: resolveAssetLayerState({
            sheetValue: backgroundValue,
            resolver: resolveBackgroundSource,
            imageLoaded: !!backgroundImage,
            imageError: !!backgroundUrl && !backgroundImage,
        }),
        foregroundState: resolveAssetLayerState({
            sheetValue: foregroundValue,
            resolver: resolveForegroundSource,
            imageLoaded: !!foregroundImage,
            imageError: !!foregroundUrl && !foregroundImage,
        }),
    };
    onLayerState(layerState);

    const segmenter = backgroundImage ? await loadSegmenter() : null;

    const overlays = { face: null, upper: null, lower: null, emoji: null };
    let tuning = emptyTuning();
    const propImages = Object.create(null);

    async function ensurePropImage(slug) {
        if (!slug || propImages[slug]) return;
        const file = assetFileForSlug(slug);
        if (!file) return;
        const image = await loadLayerImage({ url: file, operatorKey });
        if (image) propImages[slug] = image;
    }

    const capture = createSubstitutedCaptureStream({
        rawStream,
        dimensions: DIMENSIONS,
        segmenter,
        background: backgroundImage,
        foreground: foregroundImage,
        selection: overlaySelectionFor(overlays),
        tuning,
        images: propImages,
        paintMask: segmentFrameToMask,
    });

    return {
        stream: capture.stream,
        canvas: capture.canvas,
        dimensions: DIMENSIONS,
        layerState,
        /** Whether a take may start for this row (a failed layer must block it). */
        canStartTake() {
            return shouldStartTake({
                backgroundState: backgroundImage
                    ? 'ready'
                    : layerState.backgroundState,
                foregroundState: foregroundImage
                    ? 'ready'
                    : layerState.foregroundState,
            });
        },
        /**
         * Swap a layer for the current row without rebuilding the stream: the
         * studio walks takes in order and each row can name its own background.
         */
        async setLayer(kind, value) {
            const resolver = kind === 'background' ? resolveBackgroundSource : resolveForegroundSource;
            const url = resolver(value);
            const image = url ? await loadLayerImage({ url, operatorKey }) : null;
            const state = resolveAssetLayerState({
                sheetValue: value,
                resolver,
                imageLoaded: !!image,
                imageError: !!url && !image,
            });
            if (kind === 'background') {
                backgroundImage = image;
                layerState.backgroundState = state;
            } else {
                foregroundImage = image;
                layerState.foregroundState = state;
            }
            capture.setLayer(kind, image);
            onLayerState(layerState);
            return state;
        },
        async setOverlay(slot, slug) {
            if (!OVERLAY_SLOTS.includes(slot)) return null;
            overlays[slot] = slug || null;
            if (slug) await ensurePropImage(slug);
            capture.setSelection(overlaySelectionFor(overlays));
            capture.setImages(propImages);
            return overlays[slot];
        },
        setOverlayTuning(slot, next) {
            tuning = sanitizeTuning({ ...tuning, [slot]: { ...tuning[slot], ...next } });
            capture.setTuning(tuning);
        },
        getOverlays() {
            return { ...overlays };
        },
        getTuning() {
            return tuning;
        },
        stats() {
            return capture.stats();
        },
        dispose() {
            capture.dispose();
            disposeSegmenter(segmenter);
        },
    };
}

export const UFFLooks = {
    createLiveLooks,
    resolveBackgroundSource,
    resolveForegroundSource,
    resolveAssetLayerState,
    shouldStartTake,
    resolveExpandablePane,
    resolveSubstitutionDimensions,
    overlaySelectionFor,
    overlaySlugsForSlot,
    computeDragOffset,
    sanitizeTuning,
    blendMaskAlpha,
    assetFileForSlug,
    dimensions: DIMENSIONS,
};

// Attach to the page's global. Guarded + commented because this module is also
// imported by tests, where there is no browser window.
if (typeof window !== 'undefined') {
    const scope = window;
    scope.UFFLooks = UFFLooks;
}

export default UFFLooks;
