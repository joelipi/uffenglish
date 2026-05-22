import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { State } from '../../modules/state.js';

export default function IntroChoices() {
    const bottomControlState = useStore(appStore, (state) => state.bottomControlState);

    if (bottomControlState !== 'introChoices') return null;

    const handleVideoClick = () => {
        State.isTextMode = false;
        State.isCameraOff = false;
        appStore.getState().setTextMode(false);
        appStore.getState().setBottomControlState('mic');
        const cb = window.__introContinueCallback;
        if (cb) cb();
    };

    const handleAudioClick = () => {
        State.isTextMode = false;
        State.isCameraOff = true;
        appStore.getState().setTextMode(false);
        appStore.getState().setBottomControlState('mic');
        const cb = window.__introContinueCallback || window.__introAudioOnlyCallback;
        if (cb) cb();
    };

    const handleTextClick = () => {
        State.isTextMode = true;
        State.isCameraOff = true;
        appStore.getState().setTextMode(true);
        appStore.getState().setBottomControlState('mic');
        const cb = window.__introContinueCallback;
        if (cb) cb();
    };

    return (
        <div className="d-flex gap-3 align-items-center" id="state-intro-choices">
            <button className="btn call-icon" id="audioOnlyButton" aria-label="Audio Only" onClick={handleAudioClick}>
                <i className="bi bi-telephone-fill text-white"></i>
            </button>
            <button className="btn call-btn btn-primary" id="continueButton" aria-label="Video Call" onClick={handleVideoClick}>
                <i className="bi bi-camera-video-fill"></i>
            </button>
            <button className="btn call-icon" id="textOnlyButton" aria-label="Text Only" onClick={handleTextClick}>
                <i className="bi bi-keyboard text-white"></i>
            </button>
        </div>
    );
}
