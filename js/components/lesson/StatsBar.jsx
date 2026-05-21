import React from 'react';
import { createPortal } from 'react-dom';
import ScoreBoard from '../widgets/ScoreBoard.jsx';

export default function StatsBar() {
    const statsRootEl = document.getElementById('react-root-stats');

    return (
        <div className="react-lesson-statsbar">
            {statsRootEl && createPortal(<ScoreBoard />, statsRootEl)}
        </div>
    );
}
