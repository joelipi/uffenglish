// PreviewTutorialButton — the tutorial button on the friend recording-preview
// screen (the camera takeover with the look rail), and its tutorial modal.
//
// It renders the same label + circular call button as every other tutorial
// button (ChoiceColumn + `.btn.call-btn`); no preview-only styling exists.
// Render-only: the topic, slug and script come from
// src/modules/video/tutorial-logic.js, the label from strings.js. The screen
// decides whether the button exists; this component owns only the modal's
// open/closed UI state, exactly like the decision rows.
import React, { useState } from 'react';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import {
    createTutorialOpener,
    FRIEND_RECORDING_PREVIEW_TOPIC,
} from '../../modules/video/tutorial-logic.js';
import ChoiceColumn from './ChoiceColumn.jsx';
import TutorialModal from './TutorialModal.jsx';

export default function PreviewTutorialButton() {
    const [showTutorial, setShowTutorial] = useState(false);
    const lang = useNativeLanguage();
    const label = getBilingual('watch_tutorial', lang);

    // Opening the modal pauses the lesson underneath (TutorialModal's mount
    // effect) — the single pause site.
    const handleTutorial = createTutorialOpener({
        topic: FRIEND_RECORDING_PREVIEW_TOPIC,
        onOpen: () => setShowTutorial(true),
    });

    return (
        <>
            <ChoiceColumn label={label}>
                <button
                    type="button"
                    className="btn call-btn"
                    id="previewTutorialBtn"
                    aria-label="Watch Tutorial"
                    onClick={handleTutorial}
                >
                    <i className="bi bi-question-lg"></i>
                </button>
            </ChoiceColumn>

            {showTutorial && (
                <TutorialModal
                    topic={FRIEND_RECORDING_PREVIEW_TOPIC}
                    onClose={() => setShowTutorial(false)}
                />
            )}
        </>
    );
}
