import React, { memo } from 'react';
import { buildVideoSpeedToggleView } from '../modules/video/video-speed-logic.js';

// Render-only snail speed toggle. Every rule (steps, labels, next rate)
// comes from video-speed-logic.js — this file holds no rate math.
// Memoized: parents like SimpleVideoPlayer re-render on every timeupdate,
// and the toggle must not re-render (or re-log) with them.
function VideoSpeedToggle({ rate = 1, onCycle }) {
    const view = buildVideoSpeedToggleView({ rate });
    const handleClick = (e) => {
        e.stopPropagation();
        console.log(`[VideoSpeedToggle] toggle ${view.label} -> ${view.nextLabel}`);
        onCycle?.(view.next);
    };
    return (
        <button
            type="button"
            data-testid={view.testId}
            aria-label={view.ariaLabel}
            aria-pressed={view.slowed}
            title={view.ariaLabel}
            onClick={handleClick}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            className={`video-speed-toggle${view.slowed ? ' video-speed-toggle-active' : ''}`}
        >
            <span aria-hidden="true" className="video-speed-toggle-snail">🐌</span>
            <span className="video-speed-toggle-label">{view.label}</span>
        </button>
    );
}

export default memo(VideoSpeedToggle);
