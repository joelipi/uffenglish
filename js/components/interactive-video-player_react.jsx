import React, { useRef, useState, useEffect } from 'react';
import { appStore } from '../modules/store';

/**
 * React transition for interactive-video-player.js
 * Handles the branching logic and user interactions for roleplay videos.
 */
export default function InteractiveVideoPlayer({ stepData, isCameraOff, onInteractionComplete }) {
    const videoRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [showInteractionPrompt, setShowInteractionPrompt] = useState(false);
    const [clipSrc, setClipSrc] = useState(null);

    // Derived from stepData
    useEffect(() => {
        if (stepData && stepData.videoUrl) {
            setClipSrc(stepData.videoUrl);
        }
    }, [stepData]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => {
            setCurrentTime(video.currentTime);
            // Example trigger: show prompt 1 second before video ends
            if (video.duration > 0 && video.currentTime > video.duration - 1 && !showInteractionPrompt) {
                setShowInteractionPrompt(true);
            }
        };

        const handleEnded = () => {
            setIsPlaying(false);
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('ended', handleEnded);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('ended', handleEnded);
        };
    }, [showInteractionPrompt]);

    const handlePlayPause = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
                setShowInteractionPrompt(false); // Hide prompt if user replays
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleInteractionResponse = (response) => {
        setShowInteractionPrompt(false);
        if (onInteractionComplete) {
            onInteractionComplete(response);
        }
    };

    return (
        <div className="interactive-video-player position-relative rounded overflow-hidden shadow-lg bg-black">
            <video
                ref={videoRef}
                src={clipSrc}
                className="w-100 h-100 object-fit-contain"
                playsInline
                style={{ maxHeight: '70vh' }}
            />

            {/* Play/Pause Overlay Button (shows when paused) */}
            {!isPlaying && !showInteractionPrompt && (
                <div
                    className="position-absolute top-50 start-50 translate-middle text-white z-2"
                    style={{ cursor: 'pointer' }}
                    onClick={handlePlayPause}
                >
                    <i className="bi bi-play-circle-fill text-opacity-75" style={{ fontSize: '5rem' }}></i>
                </div>
            )}

            {/* Interaction Prompt Overlay */}
            {showInteractionPrompt && (
                <div className="interaction-overlay position-absolute bottom-0 start-0 end-0 p-4 bg-dark bg-opacity-75 d-flex flex-column align-items-center justify-content-center z-3">
                    <h3 className="text-white mb-4 animate__animated animate__fadeInUp">Your Turn! What do you say?</h3>
                    <div className="d-flex gap-3 animate__animated animate__zoomIn">
                        <button
                            className="btn btn-lg btn-success rounded-pill px-4"
                            onClick={() => handleInteractionResponse('positive')}
                        >
                            <i className="bi bi-mic-fill me-2"></i> Speak Now
                        </button>
                        <button
                            className="btn btn-lg btn-secondary rounded-pill px-4"
                            onClick={() => handlePlayPause()}
                        >
                            <i className="bi bi-arrow-counterclockwise me-2"></i> Replay
                        </button>
                    </div>
                </div>
            )}

            {/* Camera Off Overlay */}
            {isCameraOff && (
                <div className="camera-off-overlay position-absolute top-0 start-0 end-0 bottom-0 bg-dark z-1 d-flex flex-column align-items-center justify-content-center text-white">
                    <i className="bi bi-camera-video-off display-1 mb-3 text-muted"></i>
                    <h4 className="fw-light">Audio Only Mode</h4>
                </div>
            )}
        </div>
    );
}
