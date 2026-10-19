import React, { useState } from 'react';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { createTutorialOpener } from '../../modules/video/tutorial-logic.js';
import ChoiceColumn from './ChoiceColumn.jsx';
import TutorialModal from './TutorialModal.jsx';

// Presentational branching decision row. Renders a pre-built `view` verbatim
// and delegates every action through props; it holds no domain rules and no
// store/player/progression access. Its only local state is the tutorial
// modal's visibility (pure UI state).
//
// `view` is one LEVEL of the branching tree (shaped by the pure logic module):
// - a group choice carries `children` -> pressing it calls `onChooseGroup(key)`
//   so the container reveals the next level;
// - a leaf choice carries `targetIndex` -> pressing it calls `onChoose(target)`.
// `view.canGoBack` renders a Back button that calls `onBack`.
export default function BranchChoiceButtons({ view, onChoose, onChooseGroup, onBack, onReplay, onContinue, showReplay = true }) {
    const [showTutorial, setShowTutorial] = useState(false);
    const labelLang = useNativeLanguage();
    const choices = view?.choices || [];
    const continueLabel = getBilingual('continue', labelLang);
    const backLabel = getBilingual('branch_back', labelLang);

    // This row only renders for a `branching` step, so the tutorial's step type
    // is fixed; the opener still runs the supported-type check so an unknown
    // type can never reach the modal. Opening the modal pauses the lesson
    // underneath (TutorialModal's mount effect) — the single pause site.
    const handleTutorial = createTutorialOpener({
        stepType: 'branching',
        onOpen: () => setShowTutorial(true),
    });

    return (
        <>
            <div className="branch-choice-row">
                <div className="branch-choice-col">
                    {view?.canGoBack && (
                        <button className="btn branch-choice-btn branch-choice-back-btn" id="branchBackBtn" onClick={() => onBack()}>
                            <i className="bi bi-arrow-left"></i>
                            <span className="branch-choice-label-en">{backLabel.english}</span>
                            {backLabel.localized && (
                                <span className="branch-choice-label-localized" lang={backLabel.lang}>
                                    {backLabel.localized}
                                </span>
                            )}
                        </button>
                    )}
                    {view?.showContinue ? (
                        <button className="btn branch-choice-btn" id="branchContinueBtn" onClick={() => onContinue()}>
                            <span className="branch-choice-label-en">{continueLabel.english}</span>
                            {continueLabel.localized && (
                                <span className="branch-choice-label-localized" lang={continueLabel.lang}>
                                    {continueLabel.localized}
                                </span>
                            )}
                        </button>
                    ) : choices.map((choice) => {
                        // A group reveals another level; a leaf jumps to a step.
                        // The distinction is a pre-built property of the view, not
                        // a rule computed here.
                        const isGroup = Array.isArray(choice.children);
                        return (
                            <button
                                key={choice.key}
                                className={`btn branch-choice-btn${isGroup ? ' branch-choice-group-btn' : ''}`}
                                id={`branchChoiceBtn-${choice.key}`}
                                onClick={() => (isGroup ? onChooseGroup(choice.key) : onChoose(choice.targetIndex))}
                            >
                                {choice.label.showEnglish && (
                                    <span className="branch-choice-label-en">{choice.label.english}</span>
                                )}
                                {choice.label.localized && (
                                    <span className="branch-choice-label-localized" lang={choice.label.lang}>
                                        {choice.label.localized}
                                    </span>
                                )}
                                {isGroup && <i className="bi bi-chevron-right branch-choice-caret" aria-hidden="true"></i>}
                            </button>
                        );
                    })}
                </div>

                <div className="branch-choice-footer">
                    {showReplay && (
                        <ChoiceColumn label={getBilingual('video_replay', labelLang)}>
                            <button className="btn call-btn" id="branchReplayBtn" aria-label="Replay Video" onClick={() => onReplay()}>
                                <i className="bi bi-arrow-repeat"></i>
                            </button>
                        </ChoiceColumn>
                    )}

                    <ChoiceColumn label={getBilingual('watch_tutorial', labelLang)}>
                        <button className="btn call-btn" id="branchTutorialBtn" aria-label="Watch Tutorial" onClick={handleTutorial}>
                            <i className="bi bi-book-fill"></i>
                        </button>
                    </ChoiceColumn>
                </div>
            </div>

            {showTutorial && (
                <TutorialModal stepType="branching" onClose={() => setShowTutorial(false)} />
            )}
        </>
    );
}
