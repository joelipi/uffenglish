import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function Hints() {
    const hintsVisible = useStore(appStore, (state) => state.hintsVisible);
    const hangmanHintHTML = useStore(appStore, (state) => state.hangmanHintHTML);
    const target = document.getElementById('react-root-hints');

    return target ? createPortal(
        <div className={'card' + (hintsVisible ? '' : ' d-none')}>
            <p className="info-content" dangerouslySetInnerHTML={{ __html: hangmanHintHTML }}></p>
        </div>,
        target
    ) : null;
}
