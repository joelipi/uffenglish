import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore, getWebcamStream } from '../../modules/store/store.js';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { getRecordingPhraseOverlay } from '../../modules/video/recording-subtitle-logic.js';

export default function WebcamPreview() {
    // Subscribe to the key counter (bumped by setWebcamStream) for reactivity,
    // then read the actual stream from the module-level getter.
    const webcamStreamKey = useStore(appStore, (state) => state._webcamStreamKey);
    const mediaState = useStore(appStore, (state) => state.mediaState);
    const recordingCountdown = useStore(appStore, (state) => state.recordingCountdown);
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const currentStepIndex = useStore(appStore, (state) => state.currentStepIndex);
    const lang = useNativeLanguage();
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
        const stream = getWebcamStream();
        const video = videoRef.current;
        if (!video) return;

        if (stream) {
            if (video.srcObject !== stream) {
                video.srcObject = stream;
            }
            // Do not call video.play() imperatively here. The PiP element is
            // muted and carries `autoPlay`; starting it synchronously can
            // extend past the transient user-activation window and force the
            // lesson video's play() into its muted fallback.
        } else {
            video.pause();
            video.srcObject = null;
        }
    }, [webcamStreamKey]);

    let className = 'pip-container';
    if (show) {
        className += takeover ? ' pip-container--takeover' : ' shadow';
    } else {
        className += ' d-none';
    }

    return (
        <div ref={wrapperRef} id="pip-wrapper" className={className} style={{ position: 'relative' }}>
            <video ref={videoRef} id="webcam-preview" autoPlay muted playsInline></video>
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
        </div>
    );
}
