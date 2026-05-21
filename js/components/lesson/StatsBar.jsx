import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import ScoreBoard from '../widgets/ScoreBoard.jsx';

export default function StatsBar() {
    const statsVisible = useStore(appStore, (state) => state.statsVisible);
    const statsRootEl = document.getElementById('react-root-stats');

    useEffect(() => {
        if (statsRootEl) {
            if (statsVisible) statsRootEl.classList.remove('d-none');
            else statsRootEl.classList.add('d-none');
        }
    }, [statsVisible, statsRootEl]);

    return (
        <div className="react-lesson-statsbar">
            {statsRootEl && createPortal(<ScoreBoard />, statsRootEl)}
        </div>
    );
}
