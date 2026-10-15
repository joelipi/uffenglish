import React, { memo } from 'react';
import { buildVideoSpeedToggleView } from '../modules/video/video-speed-logic.js';

// Render-only speed toggle. Every rule (steps, labels, next rate) comes
// from video-speed-logic.js — this file holds no rate math. The glyph is
// the app's standard white Bootstrap speedometer (bootstrap-icons ships no
// snail); it inherits the button's white color like every other app icon.
// Memoized: parents like SimpleVideoPlayer re-render on every timeupdate,
// and the toggle must not re-render with them.
//
// `inline` renders the pill as a flex child (the SimpleVideoPlayer scrubber
// row) instead of an absolutely-positioned overlay (TutorialModal,
// PlaybackVideo, SuccessVideo, and SimpleVideoPlayer before metadata loads).
function VideoSpeedToggle({ rate = 1, onCycle, inline = false }) {
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
            className={`video-speed-toggle${view.slowed ? ' video-speed-toggle-active' : ''}${inline ? ' video-speed-toggle-inline' : ''}`}
        >
            <span aria-hidden="true" className="video-speed-toggle-icon"><i className="bi bi-speedometer"></i></span>
            <span className="video-speed-toggle-label">{view.label}</span>
        </button>
    );
}

export default memo(VideoSpeedToggle);
