import React, { useState } from 'react';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { createTutorialOpener } from '../../modules/video/tutorial-logic.js';
import { pauseLessonVideoForTutorial } from '../../modules/lesson/lesson-progression.js';
import ChoiceColumn from './ChoiceColumn.jsx';
import TutorialModal from './TutorialModal.jsx';

// Presentational branching decision row. Renders a pre-built `view` verbatim
// and delegates every action through props; it holds no domain rules and no
// store/player/progression access. Its only local state is the tutorial
// modal's visibility (pure UI state). The one progression touchpoint is the
// tutorial open path: opening the modal stops the lesson underneath, using the
// same shared helper every other row uses.
export default function BranchChoiceButtons({ view, onChoose, onReplay, onContinue }) {
    const [showTutorial, setShowTutorial] = useState(false);
    const labelLang = useNativeLanguage();
    const choices = view?.choices || [];
    const continueLabel = getBilingual('continue', labelLang);

    // This row only renders for a `branching` step, so the tutorial's step type
    // is fixed; the opener still runs the supported-type check so an unknown
    // type can never reach the modal.
    const handleTutorial = createTutorialOpener({
        stepType: 'branching',
        onOpen: () => {
            pauseLessonVideoForTutorial();
            setShowTutorial(true);
        },
    });

    return (
        <>
            <div className="branch-choice-row">
                <ChoiceColumn label={getBilingual('video_replay', labelLang)}>
                    <button className="btn call-btn" id="branchReplayBtn" aria-label="Replay Video" onClick={() => onReplay()}>
                        <i className="bi bi-arrow-repeat"></i>
                    </button>
                </ChoiceColumn>

                <div className="branch-choice-col">
                    {view?.showContinue ? (
                        <button className="btn branch-choice-btn" id="branchContinueBtn" onClick={() => onContinue()}>
                            <span className="branch-choice-label-en">{continueLabel.english}</span>
                            {continueLabel.localized && (
                                <span className="branch-choice-label-localized" lang={continueLabel.lang}>
                                    {continueLabel.localized}
                                </span>
                            )}
                        </button>
                    ) : choices.map((choice) => (
                        <button
                            key={choice.key}
                            className="btn branch-choice-btn"
                            id={`branchChoiceBtn-${choice.key}`}
                            onClick={() => onChoose(choice.targetIndex)}
                        >
                            {choice.label.showEnglish && (
                                <span className="branch-choice-label-en">{choice.label.english}</span>
                            )}
                            {choice.label.localized && (
                                <span className="branch-choice-label-localized" lang={choice.label.lang}>
                                    {choice.label.localized}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                <ChoiceColumn label={getBilingual('watch_tutorial', labelLang)}>
                    <button className="btn call-btn" id="branchTutorialBtn" aria-label="Watch Tutorial" onClick={handleTutorial}>
                        <i className="bi bi-book-fill"></i>
                    </button>
                </ChoiceColumn>
            </div>

            {showTutorial && (
                <TutorialModal stepType="branching" onClose={() => setShowTutorial(false)} />
            )}
        </>
    );
}
