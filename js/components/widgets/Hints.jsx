import React, { useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function Hints() {
    const hintsVisible = useStore(appStore, (state) => state.hintsVisible);
    const hangmanHintHTML = useStore(appStore, (state) => state.hangmanHintHTML);
    const speechInputContent = useStore(appStore, (state) => state.speechInputContent);
    const speechInputRevealCallback = useStore(appStore, (state) => state.speechInputRevealCallback);

    const hasContent = hangmanHintHTML || speechInputContent;

    const handleClick = useCallback((e) => {
        if (speechInputRevealCallback && e.target.classList.contains('pulse-dot')) {
            speechInputRevealCallback(e);
        }
    }, [speechInputRevealCallback]);

    if (!hintsVisible || !hasContent) {
        return null;
    }

    return (
        <div className="card position-absolute" id="hint-hangman-card" style={{ top: '25%', left: '50%', transform: 'translateX(-50%)' }} onClick={handleClick}>
            {speechInputContent && (
                <p
                    className="info-content"
                    id="hintUncommonWords"
                    dangerouslySetInnerHTML={{ __html: speechInputContent }}
                />
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
