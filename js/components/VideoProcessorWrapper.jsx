import React, { useEffect, useRef } from 'react';
import { initVideoProcessor, cleanupVideoProcessor } from '../modules/video-processor.js';

export default function VideoProcessorWrapper() {
    const containerRef = useRef(null);

    useEffect(() => {
        if (containerRef.current) {
            // Pass the React-controlled node to the vanilla script
            initVideoProcessor(containerRef.current);
        }

        return () => {
            // Free memory when the step unmounts
            cleanupVideoProcessor();
        };
    }, []);

    return <div ref={containerRef} className="video-processor-wrapper"></div>;
}
