import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';

export function useScoreUpdateEffects() {
    const scoreUpdateTrigger = useStore(appStore, (state) => state.scoreUpdateTrigger);
    const prevScoreUpdateTrigger = useRef(scoreUpdateTrigger);

    useEffect(() => {
        if (scoreUpdateTrigger === prevScoreUpdateTrigger.current) return;
        prevScoreUpdateTrigger.current = scoreUpdateTrigger;

        const area = document.getElementById('answer-input-area');
        if (area) {
            area.classList.remove('score-update');
            void area.offsetWidth;
            area.classList.add('score-update');
            setTimeout(() => area.classList.remove('score-update'), 300);
        }
    }, [scoreUpdateTrigger]);
}
