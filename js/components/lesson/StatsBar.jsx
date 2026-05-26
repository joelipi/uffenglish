import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import ScoreBoard from '../widgets/ScoreBoard.jsx';

export default function StatsBar() {
    const statsVisible = useStore(appStore, (state) => state.statsVisible);

    if (!statsVisible) return null;

    return (
        <div className="react-lesson-statsbar">
            <ScoreBoard />
        </div>
    );
}
