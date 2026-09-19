import React from 'react';
import { useStore } from 'zustand';
import { appStore, getCurrentVideoPlayer } from '../../modules/store/store.js';
import { getSpeechInputToggleCallback } from '../../modules/lesson/step-loader-callbacks.js';
import { getBilingual } from '../../data/strings.js';

export default function DecisionButtons() {
    const isMicActive = useStore(appStore, (state) => state.isMicActive);
    const isTextMode = useStore(appStore, (state) => state.isTextMode);
    const userData = useStore(appStore, (state) => state.userData);
    const appPhase = useStore(appStore, (state) => state.appPhase);

    const respondNowKey = appPhase === 'interactiveVideo-decisionTime-closedResponse'
        ? 'video_repeat_now'
        : 'video_respond_now';

    const handleEarClick = () => {
        getCurrentVideoPlayer()?.dismissOverlay?.();
        appStore.getState().transitionTo('recording/answering');
    };

    const handleMicClick = () => {
        getCurrentVideoPlayer()?.dismissOverlay?.({ replay: false });
        // Do NOT enter recording/answering here. onRecordingStart transitions
        // once the mic stream is actually live, so a getUserMedia failure keeps
        // these decision buttons mounted with actionable guidance.
        const cb = getSpeechInputToggleCallback();
        if (typeof cb === 'function') cb();
    };

    const handleTxtClickOverlay = () => {
        getCurrentVideoPlayer()?.dismissOverlay?.({ replay: false });
        appStore.getState().transitionTo('recording/answering');
        const isTextInputVisible = appStore.getState().textInputVisible;
        if (isTextInputVisible) {
            appStore.getState().setTextInputVisible(false);
            appStore.getState().setMicActive(false);
            const player = getCurrentVideoPlayer();
            if (player && player.play) player.play().catch(e => console.warn('[UI] Video resume failed:', e));
        } else {
            appStore.getState().setTextInputVisible(true);
            appStore.getState().setMicActive(true);
            appStore.getState().triggerPauseAllVideos();
        }
    };

    const labelLang = userData?.native_language || 'en';

    return (
        <div style={{ display: 'flex', justifyContent: 'space-around', width: '100%', gap: '8px' }}>
            <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }}>
                <div className="ivp-choice-label">
                    <div className="ivp-choice-label-no">NO</div>
                    <div className="ivp-choice-label-arrow">▼</div>
                    <div className="ivp-choice-label-text">
                        {(() => {
                            const d = getBilingual('video_ear_training', labelLang);
                            return d.localized ? (
                                <React.Fragment>{d.english}<br /><span lang={d.lang}><i>{d.localized}</i></span></React.Fragment>
                            ) : d.english;
                        })()}
                    </div>
                </div>
                <button className="btn call-btn" id="earBtn" aria-label="Listen again" onClick={handleEarClick}>
                    <i className="bi bi-ear-fill"></i>
                </button>
            </div>
            <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }}>
                <div className="ivp-choice-label">
                    <div className="ivp-choice-label-yes">YES</div>
                    <div className="ivp-choice-label-arrow">▼</div>
                    <div className="ivp-choice-label-text">
                        {(() => {
                            const d = getBilingual(respondNowKey, labelLang);
                            return d.localized ? (
                                <React.Fragment>{d.english}<br /><span lang={d.lang}><i>{d.localized}</i></span></React.Fragment>
                            ) : d.english;
                        })()}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        className={`btn call-btn ${isMicActive ? '' : 'toggled-off'} ${isTextMode ? 'd-none' : ''}`}
                        id="micBtn"
                        aria-label="Toggle Microphone"
                        onClick={handleMicClick}
                    >
                        <i className={isMicActive ? "bi bi-mic-fill" : "bi bi-mic-mute-fill"}></i>
                    </button>
                    <button
                        className={`btn call-btn ${isTextMode ? '' : 'd-none'}`}
                        id="txtBtn"
                        aria-label="Toggle Text Input"
                        onClick={handleTxtClickOverlay}
                    >
                        <i className="bi bi-keyboard-fill"></i>
                    </button>
                </div>
            </div>
        </div>
    );
}
