import React, { useState } from 'react';
import { appStore, getCurrentVideoPlayer } from '../../modules/store/store.js';
import { getViewAndContinueHandler } from '../../modules/lesson/step-executor-webonly.js';
import { createTutorialOpener } from '../../modules/video/tutorial-logic.js';
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

    // This row only renders in the view-and-continue decision phase, so the
    // tutorial's step type is fixed. Opening the modal pauses the lesson
    // underneath (TutorialModal's mount effect) — the single pause site.
    const handleTutorial = createTutorialOpener({
        stepType: 'viewAndContinue',
        onOpen: () => setShowTutorial(true),
    });

    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', width: '100%', gap: '8px' }}>
                <ChoiceColumn label={getBilingual('video_replay', labelLang)}>
                    <button className="btn call-btn" id="replayBtn" aria-label="Replay Video" onClick={handleReplay}>
                        <i className="bi bi-arrow-repeat"></i>
                    </button>
                </ChoiceColumn>

                <ChoiceColumn label={getBilingual('continue', labelLang)}>
                    <button className="btn call-btn btn-row-primary" id="continueBtn" aria-label="Continue" onClick={handleContinue}>
                        <i className="bi bi-chevron-right"></i>
                    </button>
                </ChoiceColumn>

                <ChoiceColumn label={getBilingual('watch_tutorial', labelLang)}>
                    <button className="btn call-btn" id="tutorialBtn" aria-label="Watch Tutorial" onClick={handleTutorial}>
                        <i className="bi bi-book-fill"></i>
                    </button>
                </ChoiceColumn>
            </div>

            {showTutorial && (
                <TutorialModal stepType="viewAndContinue" onClose={() => setShowTutorial(false)} />
            )}
        </>
    );
}
