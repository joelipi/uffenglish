import React, { useEffect, useRef } from 'react';
import { simpleVideoPlayer } from './simple-video-player.js';

export default function SimpleVideoWrapper({ videoUrl, config }) {
    const containerRef = useRef(null);
    const playerInstance = useRef(null);

    useEffect(() => {
        if (containerRef.current && !playerInstance.current) {
            const uniqueId = `svp-container-${Math.random().toString(36).substr(2, 9)}`;
            containerRef.current.id = uniqueId;

            const mergedConfig = {
                ...config,
                videoUrl,
                containerSelector: `#${uniqueId}`
            };

            // Mount the vanilla class into the React-controlled DOM node
            playerInstance.current = new simpleVideoPlayer(mergedConfig);
        }

        return () => {
            if (playerInstance.current) {
                if (typeof playerInstance.current.destroy === 'function') {
                    playerInstance.current.destroy();
                }
                playerInstance.current = null;
            }
        };
    }, [videoUrl, config]);

    return <div ref={containerRef} className="video-wrapper"></div>;
}
