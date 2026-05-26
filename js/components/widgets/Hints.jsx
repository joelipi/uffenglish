import React, { useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { formatBilingualText } from '../../modules/bilingual-display.js';

export default function Hints() {
    const hintsVisible = useStore(appStore, (state) => state.hintsVisible);
    const hangmanHintHTML = useStore(appStore, (state) => state.hangmanHintHTML);
    const speechCue = useStore(appStore, (state) => state.speechCue);
    const speechPossibleAnswer = useStore(appStore, (state) => state.speechPossibleAnswer);
    const userData = useStore(appStore, (state) => state.userData);
    const speechInputRevealCallback = useStore(appStore, (state) => state.speechInputRevealCallback);

    const hasContent = hangmanHintHTML || speechCue;

    const handleClick = useCallback((e) => {
        if (speechInputRevealCallback && e.target.classList.contains('pulse-dot')) {
            speechInputRevealCallback(e);
        }
    }, [speechInputRevealCallback]);

    if (!hintsVisible || !hasContent) {
        return null;
    }

    const userLang = userData?.native_language;

    return (
        <div className="card position-absolute" id="hint-hangman-card" style={{ top: '25%', left: '50%', transform: 'translateX(-50%)' }} onClick={handleClick}>
            {speechCue && (
                <p className="info-content" id="hintUncommonWords">
                    <CueDisplay cue={speechCue} userLang={userLang} />
                    {speechPossibleAnswer && (
                        <>
                            <br />
                            <strong>Possible response</strong>
                            <br />
                            {speechPossibleAnswer}
                        </>
                    )}
                </p>
            )}
            {hangmanHintHTML && (
                <p
                    className="info-content"
                    dangerouslySetInnerHTML={{ __html: hangmanHintHTML }}
                />
            )}
        </div>
    );
}

function CueDisplay({ cue, userLang }) {
    const b = formatBilingualText(cue, userLang);
    if (!b.english) return null;
    if (b.shouldShowLocalized) {
        return <>{b.english} <span lang={b.lang}>/ {b.localized}</span></>;
    }
    return <>{b.english}</>;
}
