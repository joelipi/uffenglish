import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import NotificationsBell from '../homescreen/NotificationsBell.web.jsx';

export default function ActivityStats() {
    const dayCount = useStore(appStore, (state) => state.dayCount);
    const currentStreak = useStore(appStore, (state) => state.currentStreak);
    const isLoggedIn = useStore(appStore, (state) => state.isLoggedIn);
    const userId = useStore(appStore, (state) => state.userData?.$id);
    const lang = useNativeLanguage();
    // Same gate as the home screen: guests have no inbox, so the row stays
    // exactly as before for them.
    const showBell = isLoggedIn && userId && userId !== 'guest';

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
            {showBell && (
                <div title="Notifications" className="d-flex align-items-center">
                    <NotificationsBell userId={userId} lang={lang} compact />
                </div>
            )}
        </div>
    );
}
