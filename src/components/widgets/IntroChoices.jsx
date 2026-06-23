import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { setupTextInputForStep } from '../../modules/lesson/step-executor-webonly.js';
import { getSpeechInputToggleCallback } from '../../modules/lesson/step-loader-callbacks.js';

export default function IntroChoices() {
    const bottomState = useStore(appStore, (state) => state.bottomState);
    const isWhisperReady = useStore(appStore, (state) => state.isWhisperReady);
    const isWhisperEngineFailed = useStore(appStore, (state) => state.isWhisperEngineFailed);

    if (bottomState !== 'introChoices') return null;

    // Speech callback is already wired by _renderResponseStep during initial
    // step load (isTextMode defaults to false).  For voice/video modes we
    // set flags, transition, and invoke the callback to auto-activate the mic.
    // Only text mode needs a second pass to swap in the text-input callback.
    const finishModeSelection = (isTextMode, isCameraOff) => {
        appStore.getState().setTextMode(isTextMode);
        appStore.getState().setCameraOff(isCameraOff);
        appStore.getState().setModeSelectionPending(false);
        appStore.getState().transitionTo('recording/answering');
        if (isTextMode) {
            setupTextInputForStep();
        } else {
            const cb = getSpeechInputToggleCallback();
            if (typeof cb === 'function') cb();
        }
    };

    const handleVideoClick = () => finishModeSelection(false, false);
    const handleAudioClick = () => finishModeSelection(false, true);
    const handleTextClick = () => finishModeSelection(true, true);

    // ── Text-only button (always available — doesn't need whisper) ──
    const textOnlyBtn = (
        <button className="btn call-icon" id="textOnlyButton" aria-label="Text Only" onClick={handleTextClick}>
            <i className="bi bi-keyboard-fill text-white"></i>
        </button>
    );

    // Whisper still loading — show nothing until the engine reports ready or failed.
    if (!isWhisperReady && !isWhisperEngineFailed) {
        return null;
    }

    // Whisper failed to load — only text mode is available.
    if (isWhisperEngineFailed) {
        return (
            <div className="d-flex flex-column gap-2 align-items-center" id="state-intro-choices">
                <button className="btn call-btn" id="continueButton" aria-label="Continue in Text Mode" onClick={handleTextClick}>
                    <i className="bi bi-keyboard-fill me-2"></i>
                </button>
            </div>
        );
    }

    // Whisper ready — show all three mode buttons.
    return (
        <div className="d-flex gap-3 align-items-center" id="state-intro-choices">
            <button className="btn call-icon" id="audioOnlyButton" aria-label="Audio Only" onClick={handleAudioClick}>
                <i className="bi bi-telephone-fill text-white"></i>
            </button>
            <button className="btn call-btn" id="continueButton" aria-label="Video Call" onClick={handleVideoClick}>
                <i className="bi bi-camera-video-fill"></i>
            </button>
            {textOnlyBtn}
        </div>
    );
}
