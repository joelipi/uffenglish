import React, { useState } from 'react';
import { appStore, getCurrentVideoPlayer } from '../../modules/store/store.js';
import { getViewAndContinueHandler } from '../../modules/lesson/step-executor-webonly.js';
import { getBilingual } from '../../data/strings.js';
import TutorialModal from './TutorialModal.jsx';
import { useNativeLanguage } from '../../hooks/use-native-language.js';

export default function ViewAndContinueButtons() {
    const [showTutorial, setShowTutorial] = useState(false);

    const labelLang = useNativeLanguage();

    const handleReplay = () => {
        // Go back to viewAndContinueVideo phase to replay the video (no mic button)
        appStore.getState().transitionTo('viewAndContinueVideo', {}, { fromStepLoad: true });
        const player = getCurrentVideoPlayer();
        if (player && typeof player.replay === 'function') {
            player.replay();
        }
    };

    const handleContinue = () => {
        const handler = getViewAndContinueHandler();
        if (typeof handler === 'function') {
            handler();
        }
    };

    const handleTutorial = () => {
        setShowTutorial(true);
    };

    const replayLabel = getBilingual('video_replay', labelLang);
    const continueLabel = getBilingual('continue', labelLang);
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
                    <button className="btn call-btn" id="replayBtn" aria-label="Replay Video" onClick={handleReplay}>
                        <i className="bi bi-arrow-repeat"></i>
                    </button>
                </div>

                {/* Continue (center, primary action) */}
                <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }}>
                    <div className="ivp-choice-label">
                        <div className="ivp-choice-label-text">
                            {continueLabel.localized ? (
                                <React.Fragment>{continueLabel.english}<br /><span lang={continueLabel.lang}>{continueLabel.localized}</span></React.Fragment>
                            ) : continueLabel.english}
                        </div>
                    </div>
                    <button className="btn call-btn" id="continueBtn" aria-label="Continue" onClick={handleContinue}>
                        <i className="bi bi-play-fill"></i>
                    </button>
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
                    <button className="btn call-btn" id="tutorialBtn" aria-label="Watch Tutorial" onClick={handleTutorial}>
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
