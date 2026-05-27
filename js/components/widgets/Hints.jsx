import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { formatBilingualText } from '../../modules/bilingual-display.js';

export default function Hints() {
    const hintsVisible = useStore(appStore, (state) => state.hintsVisible);
    const hangmanOps = useStore(appStore, (state) => state.hangmanOps);
    const speechCue = useStore(appStore, (state) => state.speechCue);
    const speechPossibleAnswer = useStore(appStore, (state) => state.speechPossibleAnswer);
    const userData = useStore(appStore, (state) => state.userData);

    const hasContent = hangmanOps || speechCue;

    if (!hintsVisible || !hasContent) {
        return null;
    }

    const userLang = userData?.native_language;

    return (
        <div className="card position-absolute" id="hint-hangman-card" style={{ top: '25%', left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
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
            {hangmanOps && (
                <p className="info-content">
                    <HangmanDisplay ops={hangmanOps} />
                </p>
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

function HangmanDisplay({ ops }) {
    const isWordChar = (s) => /\w/.test(s);
    const elements = ops.map((op, i) => {
        if (op.type === 'eq') {
            return <span key={i}>{op.val}</span>;
        }
        if (op.type === 'ins') {
            if (isWordChar(op.val)) {
                return <span key={i} className="hangman-placeholder">&nbsp;&nbsp;&nbsp;</span>;
            }
            return <span key={i}>{op.val}</span>;
        }
        if (op.type === 'del') {
            if (isWordChar(op.val)) {
                return <span key={i} className="hangman-incorrect">{op.val}</span>;
            }
            return null;
        }
        return null;
    }).filter(Boolean);
    return <>{elements}</>;
}
