import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore, getWebcamStream } from '../../modules/store/store.js';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { getRecordingPhraseOverlay } from '../../modules/video/recording-subtitle-logic.js';
import { syncWebcamPreviewElement } from '../../modules/speech/portrait-capture-logic.js';
import { isPreviewGateStep, computeDragOffset } from '../../modules/looks/recording-looks-logic.js';
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
        dragRef.current = { slot, x: e.clientX, y: e.clientY, tuning: { ...state.lookTuning[slot] } };
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
