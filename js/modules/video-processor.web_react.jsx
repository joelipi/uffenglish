import React, { useRef, useEffect } from 'react';

/**
 * React transition for video-processor.web.js
 * In Vanilla, this manipulated an off-screen <canvas> and <video> to extract
 * frames and calculate math for smooth scrolling or processing.
 * In React, we still need a canvas to do visual math if required, but we
 * map refs rather than using document.createElement.
 */
export const useVideoProcessor = () => {
    const canvasRef = useRef(null);
    const contextRef = useRef(null);

    useEffect(() => {
        // Initialize an off-screen canvas if one doesn't exist
        if (!canvasRef.current) {
            canvasRef.current = document.createElement('canvas');
            contextRef.current = canvasRef.current.getContext('2d', { willReadFrequently: true });
        }

        return () => {
            // Cleanup
            canvasRef.current = null;
            contextRef.current = null;
        };
    }, []);

    const extractFrameData = (videoElement) => {
        if (!videoElement || !canvasRef.current || !contextRef.current) return null;

        try {
            // Match canvas size to video size
            canvasRef.current.width = videoElement.videoWidth;
            canvasRef.current.height = videoElement.videoHeight;

            // Draw video frame to canvas
            contextRef.current.drawImage(videoElement, 0, 0, canvasRef.current.width, canvasRef.current.height);

            // Return raw image data or a data URL
            return canvasRef.current.toDataURL('image/jpeg', 0.8);
        } catch (e) {
            console.error("Error extracting frame:", e);
            return null;
        }
    };

    return {
        extractFrameData
    };
};
