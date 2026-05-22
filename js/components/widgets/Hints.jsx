import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function Hints() {
    const hintsVisible = useStore(appStore, (state) => state.hintsVisible);
    const hangmanHintHTML = useStore(appStore, (state) => state.hangmanHintHTML);
    const speechInputContent = useStore(appStore, (state) => state.speechInputContent);
    const speechInputRevealCallback = useStore(appStore, (state) => state.speechInputRevealCallback);
    const target = document.getElementById('react-root-hints');

    useEffect(() => {
        if (!speechInputContent || !speechInputRevealCallback) return;
        const pulseDots = document.querySelectorAll('.pulse-dot');
        pulseDots.forEach(span => {
            span.addEventListener('click', speechInputRevealCallback);
        });
        return () => {
            document.querySelectorAll('.pulse-dot').forEach(span => {
                span.removeEventListener('click', speechInputRevealCallback);
            });
        };
    }, [speechInputContent, speechInputRevealCallback]);

    const hasContent = hangmanHintHTML || speechInputContent;

    return target ? createPortal(
        <div className={'card' + (hintsVisible && hasContent ? '' : ' d-none')}>
            {speechInputContent && (
                <p className="info-content" id="hintUncommonWords" dangerouslySetInnerHTML={{ __html: speechInputContent }}></p>
            )}
            {hangmanHintHTML && (
                <p className="info-content" dangerouslySetInnerHTML={{ __html: hangmanHintHTML }}></p>
            )}
        </div>,
        target
    ) : null;
}
