import React, { useRef, useEffect } from 'react';

/**
 * React transition for intro-background-video.js
 * Plays a silent looping background video for landing pages or menus.
 */
export default function IntroBackgroundVideo({ videoSrc, posterSrc, overlayColor = 'rgba(0,0,0,0.6)' }) {
    const videoRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;
        if (video) {
            // Attempt autoplay
            video.play().catch(e => {
                console.warn("Autoplay prevented by browser:", e);
            });
        }
    }, [videoSrc]);

    return (
        <div className="intro-bg-video-wrapper position-absolute top-0 start-0 w-100 h-100 overflow-hidden z-n1">
            <video
                ref={videoRef}
                src={videoSrc}
                poster={posterSrc}
                className="w-100 h-100 object-fit-cover"
                autoPlay
                muted
                loop
                playsInline
                crossOrigin="anonymous"
            />
            {/* Dark overlay to ensure text readability */}
            <div
                className="position-absolute top-0 start-0 w-100 h-100"
                style={{ backgroundColor: overlayColor }}
            ></div>
        </div>
    );
}
