import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function Hints() {
    const hintsVisible = useStore(appStore, (state) => state.hintsVisible);
    const hangmanOps = useStore(appStore, (state) => state.hangmanOps);

    if (!hintsVisible || !hangmanOps) {
        return null;
    }

    return (
        <div className="card position-absolute" id="hint-hangman-card" style={{ top: '25%', left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
            {hangmanOps && (
                <p className="info-content">
                    <HangmanDisplay ops={hangmanOps} />
                </p>
            )}
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
