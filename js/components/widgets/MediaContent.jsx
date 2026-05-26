import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function MediaContent() {
    const praiseImageUrl = useStore(appStore, (s) => s.praiseImageUrl);
    const youtubeVideoId = useStore(appStore, (s) => s.youtubeVideoId);

    if (!praiseImageUrl && !youtubeVideoId) return null;

    return (
        <>
            {praiseImageUrl && (
                <div className="text-center mb-3 praise-image-wrapper">
                    <img
                        src={praiseImageUrl}
                        className="img-fluid rounded"
                        alt="Praise"
                        style={{ maxHeight: 250, border: '3px solid #00f2fe', boxShadow: '0 0 15px rgba(0,242,254,0.5)' }}
                    />
                </div>
            )}
            {youtubeVideoId && (
                <div className="text-center mb-3">
                    <iframe
                        width="315"
                        height="560"
                        src={`https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&rel=0&modestbranding=1&controls=0&disablekb=1&fs=0&playsinline=1&short=1&playback_rate=0.8`}
                        title="Intro"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
                        referrerPolicy="strict-origin-when-cross-origin"
                    />
                </div>
            )}
        </>
    );
}
