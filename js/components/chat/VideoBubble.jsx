import React, { useEffect, useRef } from 'react';
import { appStore } from '../../modules/store.js';

export default function VideoBubble({ avatarUrl, userName }) {
    const containerRef = useRef(null);

    useEffect(() => {
        const videoWrapper = document.getElementById('playback-video-wrapper');
        const video = document.getElementById('playback-video');
        if (containerRef.current && videoWrapper) {
            containerRef.current.appendChild(videoWrapper);

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

            if (video) {
                video.style.setProperty('display', 'block', 'important');
                video.style.setProperty('opacity', '1', 'important');
                video.style.width = '100%';
                video.style.height = '100%';
                video.style.maxHeight = 'none';
                video.style.borderRadius = '8px';
                video.style.objectFit = 'cover';
                video.muted = appStore.getState().isPlaybackMuted;
                video.play().catch(e => console.warn('[VideoBubble] Playback failed:', e));
            }
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