import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function VideoBubble({ avatarUrl, userName }) {
    const videoRef = useRef(null);
    const blob = useStore(appStore, (s) => s.playbackBlob);
    const [muted, setMuted] = useState(true);

    const toggleMute = () => {
        const video = videoRef.current;
        if (!video) return;
        const next = !video.muted;
        video.muted = next;
        setMuted(next);
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !blob) return;
        const url = URL.createObjectURL(blob);
        video.src = url;
        video.play().catch(() => {});
        return () => {
            URL.revokeObjectURL(url);
        };
    }, [blob]);

    return (
        <div className="chat-message-row chat-message-row--user" style={{ animation: 'popIn 0.3s ease-out forwards' }}>
            <img src={avatarUrl} alt={userName} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--user p-1" style={{ backgroundColor: '#000', border: '2px solid #4facfe', overflow: 'hidden', minWidth: '0', width: 'max-content' }}>
                <div style={{ position: 'relative', width: '100px', height: '178px' }}>
                    <video ref={videoRef} playsInline loop muted={muted} onClick={toggleMute}
                        style={{ display: 'block', width: '100%', height: '100%', borderRadius: '8px', objectFit: 'cover', cursor: 'pointer' }} />
                </div>
            </div>
        </div>
    );
}
