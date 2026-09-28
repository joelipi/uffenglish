import React, { useState } from 'react';
import { useStore } from 'zustand';
import { appStore, getCurrentVideoPlayer } from '../../modules/store/store.js';
import { getSpeechInputToggleCallback } from '../../modules/lesson/step-loader-callbacks.js';
import { getResponseAnswerLabelKey } from '../../modules/video/response-decision-logic.js';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import ChoiceColumn from './ChoiceColumn.jsx';
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
        appStore.getState().setTextInputVisible(true);
        appStore.getState().setMicActive(true);
        appStore.getState().triggerPauseAllVideos();
    };

    const handleTutorial = () => {
        setShowTutorial(true);
    };

    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', width: '100%', gap: '8px' }}>
                <ChoiceColumn label={getBilingual('video_replay', labelLang)}>
                    <button className="btn call-btn" id="responseReplayBtn" aria-label="Replay Video" onClick={handleReplay}>
                        <i className="bi bi-arrow-repeat"></i>
                    </button>
                </ChoiceColumn>

                <ChoiceColumn label={getBilingual(getResponseAnswerLabelKey(currentVideo?.responseType), labelLang)}>
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
                </ChoiceColumn>

                <ChoiceColumn label={getBilingual('watch_tutorial', labelLang)}>
                    <button className="btn call-btn" id="responseTutorialBtn" aria-label="Watch Tutorial" onClick={handleTutorial}>
                        <i className="bi bi-book-fill"></i>
                    </button>
                </ChoiceColumn>
            </div>

            {showTutorial && (
                <TutorialModal onClose={() => setShowTutorial(false)} />
            )}
        </>
    );
}
