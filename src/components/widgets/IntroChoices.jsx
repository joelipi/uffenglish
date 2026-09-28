import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { isFriendLesson } from '../../modules/user/friend-lesson-detection.js';
import { setupTextInputForStep } from '../../modules/lesson/step-executor-webonly.js';
import { getSpeechInputToggleCallback, getSpeechEngineRetryCallback } from '../../modules/lesson/step-loader-callbacks.js';
import { getSpeechUiState } from '../../modules/speech/speech-ui-state.js';
import Strings from '../../data/strings.js';
import { trackEvent } from '../../modules/utils/posthog.js';

export default function IntroChoices() {
    const bottomState = useStore(appStore, (state) => state.bottomState);
    const isWhisperReady = useStore(appStore, (state) => state.isWhisperReady);
    const isWhisperEngineFailed = useStore(appStore, (state) => state.isWhisperEngineFailed);
    const nativeLang = useStore(appStore, (state) => state.userData?.native_language);
    const location = useLocation();
    // Friend-challenge lessons exist to produce a shared video, so their mode
    // chooser offers only video. Detection is route-only (share link or the
    // 'a'/'b' lesson ids) and re-renders on navigation via useLocation.
    const friendLesson = isFriendLesson({ search: location.search, pathname: location.pathname });

    // Track how long the engine has been loading so we can escalate from a
    // quiet "preparing" note to explicit troubleshooting guidance. The interval
    // reads the ref each tick, so "Try Again" can restart the clock instantly
    // (slow notice drops back to the loading notice) without re-running the
    // effect or appearing dead.
    const [loadingMs, setLoadingMs] = useState(0);
    const loadingStartedAtRef = useRef(Date.now());
    useEffect(() => {
        if (bottomState !== 'introChoices' || isWhisperReady || isWhisperEngineFailed) return undefined;
        loadingStartedAtRef.current = Date.now();
        setLoadingMs(0);
        const timer = setInterval(() => setLoadingMs(Date.now() - loadingStartedAtRef.current), 1000);
        return () => clearInterval(timer);
    }, [bottomState, isWhisperReady, isWhisperEngineFailed]);

    if (bottomState !== 'introChoices') return null;

    const t = (key) => Strings.get(key, nativeLang) || key;

    // Speech callback is already wired by _renderResponseStep during initial
    // step load (isTextMode defaults to false).  For voice/video modes we set
    // flags and invoke the callback.  The recording/answering phase is entered
    // later, by onRecordingStart, only after the mic/cam stream is actually
    // acquired — so a failed getUserMedia leaves the user here with guidance
    // instead of a stranded muted-mic screen.
    const finishModeSelection = (isTextMode, isCameraOff) => {
        appStore.getState().setTextMode(isTextMode);
        appStore.getState().setCameraOff(isCameraOff);
        if (isTextMode) {
            // Text mode needs no hardware — enter the answering phase directly.
            appStore.getState().setSystemMessage(null);
            appStore.getState().transitionTo('recording/answering');
            setupTextInputForStep();
            return;
        }
        const cb = getSpeechInputToggleCallback();
        if (typeof cb === 'function') cb();
    };

    const handleVideoClick = () => finishModeSelection(false, false);
    const handleAudioClick = () => finishModeSelection(false, true);
    const handleTextClick = () => {
        trackEvent('text_mode_fallback_selected');
        finishModeSelection(true, true);
    };
    const handleRetry = () => {
        trackEvent('speech_engine_retry');
        loadingStartedAtRef.current = Date.now();
        setLoadingMs(0);
        const retry = getSpeechEngineRetryCallback();
        if (typeof retry === 'function') retry();
    };

    // Fragment (not a wrapping div) so the two voice buttons become direct
    // children of whatever row they are placed in — keeping all three mode
    // icons on a single line with even gap-3 spacing.
    const voiceButtons = (disabled) => (
        <>
            {!friendLesson && (
                <button className="btn call-icon" id="audioOnlyButton" aria-label="Audio Only" onClick={handleAudioClick} disabled={disabled}>
                    <i className="bi bi-telephone-fill text-white"></i>
                </button>
            )}
            <button className="btn call-btn" id="continueButton" aria-label="Video Call" onClick={handleVideoClick} disabled={disabled}>
                <i className="bi bi-camera-video-fill"></i>
            </button>
        </>
    );

    // Text mode is always available via the keyboard icon (product decision):
    // voice remains the primary path, but the text option is never hidden —
    // it does not depend on the speech engine, so it stays usable while the
    // engine loads or fails. Friend-challenge lessons are the one exception:
    // they exist to produce a shared video, so text-only is withheld there.
    const textOnlyBtn = friendLesson ? null : (
        <button className="btn call-icon" id="textOnlyButton" aria-label="Text Only" onClick={handleTextClick}>
            <i className="bi bi-keyboard-fill text-white"></i>
        </button>
    );

    const uiState = getSpeechUiState({
        isReady: isWhisperReady,
        isFailed: isWhisperEngineFailed,
        loadingMs,
    });

    // ── Engine still loading — voice-first, keyboard icon always available ──
    if (uiState === 'loading' || uiState === 'slow') {
        return (
            <div className="d-flex flex-column gap-2 align-items-center" id="state-intro-choices">
                <div className="d-flex gap-3 align-items-center">
                    {voiceButtons(true)}
                    {textOnlyBtn}
                </div>
                <div className="text-center small text-white-50" id="speechEngineStatusText" role="status" aria-live="polite">
                    <span className="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
                    {uiState === 'slow' ? t('error_engine_slow_title') : t('action_preparing_voice')}
                </div>
                <div className="text-center small text-white-50">
                    {uiState === 'slow' ? t('error_engine_slow_hint') : t('error_engine_loading_hint')}
                </div>
                {uiState === 'slow' && (
                    <button type="button" className="btn btn-outline-light btn-sm" id="retryEngineButton" onClick={handleRetry}>
                        {t('action_try_again')}
                    </button>
                )}
            </div>
        );
    }

    // ── Engine gave up — descriptive, actionable recovery, then text ──
    if (uiState === 'failed') {
        return (
            <div className="d-flex flex-column gap-2 align-items-center" id="state-intro-choices">
                <div className="text-center" id="speechEngineFailedText" role="alert">
                    <div className="text-danger fw-semibold">{t('error_engine_failed_title')}</div>
                    <div className="small text-white-50 mt-1">{t('error_engine_failed_steps')}</div>
                </div>
                <button type="button" className="btn btn-primary" id="retryEngineButton" onClick={handleRetry}>
                    {t('action_try_again')}
                </button>
                {textOnlyBtn}
            </div>
        );
    }

    // ── Engine ready — encourage voice; keyboard icon always available ──
    return (
        <div className="d-flex gap-3 align-items-center" id="state-intro-choices">
            {voiceButtons(false)}
            {textOnlyBtn}
        </div>
    );
}
