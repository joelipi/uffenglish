import React, { useRef, useEffect } from 'react';
import { appStore } from './store';

/**
 * React transition for video-loader.web.js
 * In Vanilla JS, this initialized components based on global state.
 * In React, this is better handled as a conditional rendering wrapper component.
 */
export default function VideoLoaderWrapper({ children }) {
    const isTextMode = appStore(state => state.isTextMode);
    const activeLessonId = appStore(state => state.activeLessonId);

    // If text mode is active, we don't render the video players.
    // If we have an active lesson, we render the children (which should be the specific Video Player components).
    // The specific player (Simple vs Interactive) should be determined by the lesson config
    // passed down from a higher level component.

    if (isTextMode) {
        return <div className="text-mode-active-placeholder p-5 text-center">Video disabled in Text Mode</div>;
    }

    if (!activeLessonId) {
        return null;
    }

    return (
        <div className="video-loader-wrapper">
            {children}
        </div>
    );
}
