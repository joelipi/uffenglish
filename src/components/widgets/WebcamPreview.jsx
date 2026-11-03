import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore, getWebcamStream } from '../../modules/store/store.js';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { getRecordingPhraseOverlay } from '../../modules/video/recording-subtitle-logic.js';
import { syncWebcamPreviewElement } from '../../modules/speech/portrait-capture-logic.js';
import {
    isPreviewGateStep,
    computeDragOffset,
    resolveSlotDrawRect,
    resolveSlotScreenRect,
    computeCornerResize,
    assetFileForSlug,
} from '../../modules/looks/recording-looks-logic.js';
import LookControls from '../looks/LookControls.jsx';

export default function WebcamPreview() {
    // Subscribe to the key counter (bumped by setWebcamStream) for reactivity,
    // then read the actual stream from the module-level getter.
    const webcamStreamKey = useStore(appStore, (state) => state._webcamStreamKey);
    const mediaState = useStore(appStore, (state) => state.mediaState);
    const recordingCountdown = useStore(appStore, (state) => state.recordingCountdown);
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const currentStepIndex = useStore(appStore, (state) => state.currentStepIndex);
    const rawLang = useNativeLanguage();
    const lang = rawLang === 'OTHER' ? 'en' : rawLang;
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);
    const prevShow = useRef(false);
    const [takeover, setTakeover] = useState(false);

    // Only show during full-screen takeover (recording/answering + first-response
    // intro). The small corner PiP during simpleVideo/interactiveVideo playback
    // was a distraction and competed with the lesson video for the user-activation
    // window, muting the lesson video's unmuted play() (story 072 follow-up).
    const show = !!getWebcamStream() && mediaState === 'webcamOrAvatar';

    // Full-screen takeover only during the recording/answering phase
    // (mediaState === 'webcamOrAvatar'). During normal video playback
    // (simpleVideo/interactiveVideo) the preview stays a small PiP, not full-screen.
    const fullScreen = show && mediaState === 'webcamOrAvatar';

    // Friend-closed-response steps show the phrase (English only) as subtitles
    // overlaid on the camera preview while recording, plus a "speak slowly and
    // carefully" legend above them.
    const currentStep = configData?.lessons?.[currentLessonIndex]?.steps?.[currentStepIndex] || null;
    const recordingOverlay = getRecordingPhraseOverlay(currentStep);
    const isFriendClosedResponse = !!recordingOverlay;
    const phraseText = recordingOverlay ? recordingOverlay.phrase : '';
    const legendBilingual = isFriendClosedResponse
        ? getBilingual('speak_slowly_and_carefully', lang)
        : null;

    // Look controls + drag-to-position (stories/092). Only on the preview screen
    // of a friendClosedResponse step, and only before the take starts.
    const awaitingStart = useStore(appStore, (state) => state.awaitingRecordingStart);
    const lookControlsVisible = awaitingStart && isPreviewGateStep(currentStep);
    const dragRef = useRef(null);
    const handlePointerDown = (e) => {
        if (!lookControlsVisible) return;
        const state = appStore.getState();
        if (state.lookOpenDrawer) state.setLookOpenDrawer(null);
        const slot = state.lookActiveSlot;
        const slug = state.lookSelection.slots[slot];
        if (!slug) return;
        dragRef.current = { slot, x: e.clientX, y: e.clientY, tuning: { ...(state.lookTuning[slot] || {}) } };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const handlePointerMove = (e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const rect = wrapperRef.current?.getBoundingClientRect();
        const offset = computeDragOffset({
            startTuning: drag.tuning,
            startX: drag.x,
            startY: drag.y,
            clientX: e.clientX,
            clientY: e.clientY,
            width: rect?.width || 0,
            height: rect?.height || 0,
            mirrored: true,
        });
        if (offset) appStore.getState().setLookTuning(drag.slot, offset);
    };
    const handlePointerUp = () => { dragRef.current = null; };

    // Corner-handle resizing (the standard drag-the-corners way). The overlay
    // itself is painted into the mirrored composite stream, so the DOM only
    // draws a selection box over it; the handles update `lookTuning.scale` and
    // nudge `dx`/`dy` so the opposite corner stays put. The menu slider keeps
    // working from the same tuning.
    const lookActiveSlot = useStore(appStore, (state) => state.lookActiveSlot);
    const lookSelection = useStore(appStore, (state) => state.lookSelection);
    const lookTuning = useStore(appStore, (state) => state.lookTuning);
    const activeSlug = lookControlsVisible ? lookSelection.slots[lookActiveSlot] : null;
    const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
    const [imageMeta, setImageMeta] = useState(null);
    const resizeRef = useRef(null);

    useEffect(() => {
        const el = wrapperRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const measure = () => {
            const r = el.getBoundingClientRect();
            setPreviewSize((prev) => (
                Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5
                    ? prev
                    : { width: r.width, height: r.height }
            ));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        if (!activeSlug) { setImageMeta(null); return undefined; }
        const src = assetFileForSlug(activeSlug);
        if (!src) { setImageMeta(null); return undefined; }
        let cancelled = false;
        const img = new Image();
        img.onload = () => {
            if (!cancelled) {
                setImageMeta({ slug: activeSlug, width: img.naturalWidth, height: img.naturalHeight });
            }
        };
        img.onerror = () => { if (!cancelled) setImageMeta(null); };
        img.src = src;
        return () => { cancelled = true; };
    }, [activeSlug]);

    const startResize = (corner) => (e) => {
        if (!lookControlsVisible) return;
        e.stopPropagation();
        e.preventDefault();
        const state = appStore.getState();
        const slot = state.lookActiveSlot;
        const slug = state.lookSelection.slots[slot];
        if (!slug || !imageMeta || imageMeta.slug !== slug) return;
        if (!(previewSize.width > 0) || !(previewSize.height > 0)) return;
        const t = state.lookTuning[slot] || {};
        resizeRef.current = {
            corner,
            slot,
            slug,
            startTuning: { dx: t.dx || 0, dy: t.dy || 0, scale: t.scale || 1 },
            startRect: resolveSlotDrawRect({
                slot, slug,
                imageWidth: imageMeta.width,
                imageHeight: imageMeta.height,
                canvasWidth: previewSize.width,
                canvasHeight: previewSize.height,
                tuning: t,
            }),
            width: previewSize.width,
            height: previewSize.height,
            imageWidth: imageMeta.width,
            imageHeight: imageMeta.height,
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const moveResize = (e) => {
        const drag = resizeRef.current;
        if (!drag || !drag.startRect) return;
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (!rect) return;
        const next = computeCornerResize({
            corner: drag.corner,
            startTuning: drag.startTuning,
            startRect: drag.startRect,
            pointer: { x: e.clientX - rect.left, y: e.clientY - rect.top },
            displayWidth: drag.width,
            displayHeight: drag.height,
            slot: drag.slot,
            slug: drag.slug,
            imageWidth: drag.imageWidth,
            imageHeight: drag.imageHeight,
        });
        if (next) appStore.getState().setLookTuning(drag.slot, next);
    };
    const endResize = () => { resizeRef.current = null; };

    const selectionBox = (() => {
        if (!lookControlsVisible || !activeSlug) return null;
        if (!imageMeta || imageMeta.slug !== activeSlug) return null;
        if (!(previewSize.width > 0) || !(previewSize.height > 0)) return null;
        const drawRect = resolveSlotDrawRect({
            slot: lookActiveSlot,
            slug: activeSlug,
            imageWidth: imageMeta.width,
            imageHeight: imageMeta.height,
            canvasWidth: previewSize.width,
            canvasHeight: previewSize.height,
            tuning: lookTuning[lookActiveSlot],
        });
        if (!drawRect) return null;
        return resolveSlotScreenRect({
            rect: drawRect,
            displayWidth: previewSize.width,
            displayHeight: previewSize.height,
            mirrored: true,
        });
    })();

    useEffect(() => {
        if (fullScreen) {
            setTakeover(true);
        } else if (prevShow.current) {
            const timer = setTimeout(() => setTakeover(false), 250);
            return () => clearTimeout(timer);
        } else {
            setTakeover(false);
        }
        prevShow.current = fullScreen;
    }, [fullScreen]);

    useEffect(() => {
        syncWebcamPreviewElement(videoRef.current, getWebcamStream(), show);
    }, [webcamStreamKey, show]);

    let className = 'pip-container';
    if (show) {
        className += takeover ? ' pip-container--takeover' : ' shadow';
    } else {
        className += ' d-none';
    }

    return (
        <div
            ref={wrapperRef}
            id="pip-wrapper"
            className={className}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
                position: 'relative',
                // Touch drags must not be interpreted as a page pan. Put the
                // rule on the wrapper (a plain div) and capture the pointer
                // there: Android Chrome does not reliably keep a pointer
                // sequence alive on a <video> target, which made the overlays
                // move only a few pixels per drag.
                ...(lookControlsVisible ? { touchAction: 'none' } : null),
            }}
        >
            <video
                ref={videoRef}
                id="webcam-preview"
                autoPlay
                muted
                playsInline
            ></video>
            {selectionBox && (
                <>
                    <div
                        data-testid="look-selection-box"
                        style={{
                            position: 'absolute',
                            left: selectionBox.left,
                            top: selectionBox.top,
                            width: selectionBox.width,
                            height: selectionBox.height,
                            border: '1.5px dashed rgba(255, 255, 255, 0.85)',
                            borderRadius: 4,
                            pointerEvents: 'none',
                            zIndex: 85,
                        }}
                    />
                    {['nw', 'ne', 'sw', 'se'].map((corner) => {
                        const point = selectionBox.corners[corner];
                        return (
                            <div
                                key={corner}
                                data-testid={`look-resize-${corner}`}
                                onPointerDown={startResize(corner)}
                                onPointerMove={moveResize}
                                onPointerUp={endResize}
                                onPointerCancel={endResize}
                                style={{
                                    position: 'absolute',
                                    left: point.x - 8,
                                    top: point.y - 8,
                                    width: 16,
                                    height: 16,
                                    borderRadius: '50%',
                                    background: '#fff',
                                    border: '2px solid #1f9d55',
                                    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.35)',
                                    pointerEvents: 'auto',
                                    touchAction: 'none',
                                    zIndex: 90,
                                }}
                            />
                        );
                    })}
                </>
            )}
            {recordingCountdown !== null && (
                <div
                    data-testid="recording-countdown-overlay"
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        zIndex: 100,
                        fontSize: '120px',
                        fontWeight: 'bold',
                        color: 'white',
                        pointerEvents: 'none',
                    }}
                >
                    {recordingCountdown}
                </div>
            )}
            {isFriendClosedResponse && phraseText && (
                <div
                    data-testid="recording-phrase-subtitles"
                    className="recording-phrase-overlay"
                >
                    {legendBilingual && (
                        <div className="recording-phrase-legend">
                            {legendBilingual.localized ? (
                                <>
                                    {legendBilingual.english}
                                    <br />
                                    <span lang={legendBilingual.lang}>{legendBilingual.localized}</span>
                                </>
                            ) : (
                                legendBilingual.english
                            )}
                        </div>
                    )}
                    <div className="recording-phrase-text">{phraseText}</div>
                </div>
            )}
            {lookControlsVisible && <LookControls />}
        </div>
    );
}
