import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';

export default function Hints() {
    const hintsVisible = useStore(appStore, (state) => state.hintsVisible);
    const hangmanOps = useStore(appStore, (state) => state.hangmanOps);
    const hangmanCue = useStore(appStore, (state) => state.hangmanCue);
    const lang = useNativeLanguage();

    if (!hintsVisible || !hangmanOps) {
        return null;
    }

    const Bilingual = ({ k }) => {
        const d = getBilingual(k, lang);
        return d.localized ? (
            <>{d.english}<br /><span lang={d.lang}>{d.localized}</span></>
        ) : (
            <>{d.english}</>
        );
    };

    return (
        <div className="card position-absolute" id="hint-hangman-card" style={{ top: '25%', left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
            <button
                type="button"
                className="hint-close"
                aria-label="Dismiss"
                onClick={() => appStore.getState().setHintsVisible(false)}
            >
                <i className="bi bi-x-lg"></i>
            </button>
            <div className="card-header info-header"><Bilingual k="hangman_try_again" /></div>
            <div className="card-body">
                {hangmanCue && (
                    <p className="info-content mb-3">
                        <Bilingual k="hangman_meant_to_say" /><br />
                        <i className="bi bi-check-circle-fill text-success me-1" aria-label="correct answer"></i> {hangmanCue}
                    </p>
                )}
                {hangmanOps && (
                    <p className="info-content mb-0">
                        <Bilingual k="hangman_you_said" /><br />
                        <i className="bi bi-x-circle-fill text-danger me-1" aria-label="your answer"></i> <HangmanDisplay ops={hangmanOps} />
                    </p>
                )}
            </div>
        </div>
    );
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
