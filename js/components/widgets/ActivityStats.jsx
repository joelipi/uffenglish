import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function ActivityStats() {
    const dayCount = useStore(appStore, (state) => state.dayCount);
    const currentStreak = useStore(appStore, (state) => state.currentStreak);

    return (
        <div className="d-flex align-items-center text-white gap-2 stats-container ms-1 pe-2">
            <div title="Total Days Learned" className="d-flex align-items-center">
                <i className="bi bi-trophy-fill"></i>
                <span id="dayCountSpan">{dayCount}</span>
            </div>
            <div title="Current Daily Streak" className="d-flex align-items-center">
                <i className="bi bi-fire"></i>
                <span id="streakCountSpan">{currentStreak}</span>
            </div>
        </div>
    );
}
