import React, { useEffect, useRef } from 'react';

export default function VideoBubble({ avatarUrl, userName }) {
    const containerRef = useRef(null);

    useEffect(() => {
        const videoWrapper = document.getElementById('playback-video-wrapper');
        if (containerRef.current && videoWrapper) {
            containerRef.current.appendChild(videoWrapper);

            // Replicate the inline styles originally set in ui.js showPlaybackVideo
            videoWrapper.classList.remove('d-none', 'mb-2');
            videoWrapper.style.setProperty('display', 'block', 'important');
            videoWrapper.style.setProperty('visibility', 'visible', 'important');
            videoWrapper.style.setProperty('opacity', '1', 'important');
            videoWrapper.style.width = '100px';
            videoWrapper.style.height = '178px';
            videoWrapper.style.position = 'relative';
            videoWrapper.style.top = '';
            videoWrapper.style.left = '';
            videoWrapper.style.right = '';
        }
    }, []);

    return (
        <div className="chat-message-row chat-message-row--user" style={{ animation: 'popIn 0.3s ease-out forwards' }}>
            <img src={avatarUrl} alt={userName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--user p-1" style={{ backgroundColor: '#000', border: '2px solid #4facfe', overflow: 'hidden', minWidth: '0', width: 'max-content' }}>
                <div ref={containerRef}></div>
            </div>
        </div>
    );
}