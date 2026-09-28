import React, { useState } from 'react';
import { useStore } from 'zustand';
import { appStore, getCurrentVideoPlayer } from '../../modules/store/store.js';
import { getSpeechInputToggleCallback } from '../../modules/lesson/step-loader-callbacks.js';
import { getResponseAnswerLabelKey } from '../../modules/video/response-decision-logic.js';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import TutorialModal from './TutorialModal.jsx';

export default function ResponseDecisionButtons() {
    const [showTutorial, setShowTutorial] = useState(false);
    const isTextMode = useStore(appStore, (state) => state.isTextMode);
    const currentVideo = useStore(appStore, (state) => state.currentVideo);

    const labelLang = useNativeLanguage();

    const handleReplay = () => {
        // Return to the simpleVideo phase first so the clip-ended handler can
        // raise the overlay again after the replay, then restart the clip.
        appStore.getState().transitionTo('simpleVideo', {}, { fromStepLoad: true });
        const player = getCurrentVideoPlayer();
        if (player && typeof player.replay === 'function') {
            player.replay();
        }
    };

    const handleMicClick = () => {
        // Do NOT enter recording/answering here. onRecordingStart transitions
        // once the mic stream is actually live, so a getUserMedia failure keeps
        // these decision buttons mounted with actionable guidance.
        const cb = getSpeechInputToggleCallback();
        if (typeof cb === 'function') cb();
    };

    const handleTxtClick = () => {
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

    const handleTutorial = () => {
        setShowTutorial(true);
    };

    const replayLabel = getBilingual('video_replay', labelLang);
    const answerLabel = getBilingual(getResponseAnswerLabelKey(currentVideo?.responseType), labelLang);
    const tutorialLabel = getBilingual('watch_tutorial', labelLang);

    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', width: '100%', gap: '8px' }}>
                {/* Replay Video */}
                <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }}>
                    <div className="ivp-choice-label">
                        <div className="ivp-choice-label-text">
                            {replayLabel.localized ? (
                                <React.Fragment>{replayLabel.english}<br /><span lang={replayLabel.lang}>{replayLabel.localized}</span></React.Fragment>
                            ) : replayLabel.english}
                        </div>
                    </div>
                    <button className="btn call-btn" id="responseReplayBtn" aria-label="Replay Video" onClick={handleReplay}>
                        <i className="bi bi-arrow-repeat"></i>
                    </button>
                </div>

                {/* Answer (center, primary action) */}
                <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }}>
                    <div className="ivp-choice-label">
                        <div className="ivp-choice-label-text">
                            {answerLabel.localized ? (
                                <React.Fragment>{answerLabel.english}<br /><span lang={answerLabel.lang}>{answerLabel.localized}</span></React.Fragment>
                            ) : answerLabel.english}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            className={`btn call-btn ${isTextMode ? 'd-none' : ''}`}
                            id="responseAnswerBtn"
                            aria-label="Answer"
                            onClick={handleMicClick}
                        >
                            <i className="bi bi-mic-fill"></i>
                        </button>
                        <button
                            className={`btn call-btn ${isTextMode ? '' : 'd-none'}`}
                            id="responseTxtBtn"
                            aria-label="Answer with text"
                            onClick={handleTxtClick}
                        >
                            <i className="bi bi-keyboard-fill"></i>
                        </button>
                    </div>
                </div>

                {/* Watch Tutorial */}
                <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }}>
                    <div className="ivp-choice-label">
                        <div className="ivp-choice-label-text">
                            {tutorialLabel.localized ? (
                                <React.Fragment>{tutorialLabel.english}<br /><span lang={tutorialLabel.lang}>{tutorialLabel.localized}</span></React.Fragment>
                            ) : tutorialLabel.english}
                        </div>
                    </div>
                    <button className="btn call-btn" id="responseTutorialBtn" aria-label="Watch Tutorial" onClick={handleTutorial}>
                        <i className="bi bi-book-fill"></i>
                    </button>
                </div>
            </div>

            {showTutorial && (
                <TutorialModal onClose={() => setShowTutorial(false)} />
            )}
        </>
    );
}
