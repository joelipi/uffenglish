import React from 'react';

// Single-source for the video play affordance: the Material play-arrow
// triangle, used by the simple + interactive players and the homepage
// showcase carousel. `fill` defaults to white (the players' dark overlay);
// pass `currentColor` on light buttons so the glyph follows the button text
// color (the app's dark-glyph-on-white-button convention).
export default function VideoPlayIcon({ className, fill = 'white' }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={fill} aria-hidden="true" className={className}>
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}
