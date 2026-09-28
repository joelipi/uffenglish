import React, { useState } from 'react';
import { appStore, getCurrentVideoPlayer } from '../../modules/store/store.js';
import { getViewAndContinueHandler } from '../../modules/lesson/step-executor-webonly.js';
import { getBilingual } from '../../data/strings.js';
import ChoiceColumn from './ChoiceColumn.jsx';
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

    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', width: '100%', gap: '8px' }}>
                <ChoiceColumn label={getBilingual('video_replay', labelLang)}>
                    <button className="btn call-btn" id="replayBtn" aria-label="Replay Video" onClick={handleReplay}>
                        <i className="bi bi-arrow-repeat"></i>
                    </button>
                </ChoiceColumn>

                <ChoiceColumn label={getBilingual('continue', labelLang)}>
                    <button className="btn call-btn" id="continueBtn" aria-label="Continue" onClick={handleContinue}>
                        <i className="bi bi-play-fill"></i>
                    </button>
                </ChoiceColumn>

                <ChoiceColumn label={getBilingual('watch_tutorial', labelLang)}>
                    <button className="btn call-btn" id="tutorialBtn" aria-label="Watch Tutorial" onClick={handleTutorial}>
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
