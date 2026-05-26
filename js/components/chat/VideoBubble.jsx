import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function VideoBubble({ avatarUrl, userName }) {
    const videoRef = useRef(null);
    const blob = useStore(appStore, (s) => s.playbackBlob);
    const [muted, setMuted] = useState(true);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !blob) return;
        const url = URL.createObjectURL(blob);
        video.src = url;
        video.muted = true;
        video.play().catch(() => {});
        const toggleMute = () => {
            const next = !video.muted;
            video.muted = next;
            setMuted(next);
        };
        video.addEventListener('click', toggleMute);
        return () => {
            URL.revokeObjectURL(url);
            video.removeEventListener('click', toggleMute);
        };
    }, [blob]);

    return (
        <div className="chat-message-row chat-message-row--user" style={{ animation: 'popIn 0.3s ease-out forwards' }}>
            <img src={avatarUrl} alt={userName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--user p-1" style={{ backgroundColor: '#000', border: '2px solid #4facfe', overflow: 'hidden', minWidth: '0', width: 'max-content' }}>
                <div style={{ position: 'relative', width: '100px', height: '178px' }}>
                    <video ref={videoRef} playsInline loop
                        style={{ display: 'block', width: '100%', height: '100%', borderRadius: '8px', objectFit: 'cover', cursor: 'pointer' }} />
                </div>
            </div>
        </div>
    );
}
