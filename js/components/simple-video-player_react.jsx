import React, { useRef, useState, useEffect } from 'react';
import { appStore } from '../modules/store';

export default function SimpleVideoPlayer({ videoSrc, initialSubtitleMode, isCameraOff, activeLessonId, onVideoEnd }) {
    const videoRef = useRef(null);
    const subtitleContainerRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    // Subtitle logic
    const [subtitles, setSubtitles] = useState([]);
    const [activeSubtitleIndex, setActiveSubtitleIndex] = useState(-1);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => {
            setCurrentTime(video.currentTime);
            // Example logic for finding active subtitle based on time
            const activeIdx = subtitles.findIndex(sub =>
                video.currentTime >= sub.startTime && video.currentTime <= sub.endTime
            );
            if (activeIdx !== activeSubtitleIndex) {
                setActiveSubtitleIndex(activeIdx);
            }
        };

        const handleLoadedMetadata = () => {
            setDuration(video.duration);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            if (onVideoEnd) onVideoEnd();
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('ended', handleEnded);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('ended', handleEnded);
        };
    }, [subtitles, activeSubtitleIndex, onVideoEnd]);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    return (
        <div className="simple-video-player-container position-relative bg-dark rounded overflow-hidden shadow">
            <video
                ref={videoRef}
                src={videoSrc}
                className="w-100 h-100 object-fit-cover"
                playsInline
                crossOrigin="anonymous"
                style={{ maxHeight: '70vh' }}
            />

            {/* Custom Controls Overlay */}
            <div className="video-controls position-absolute bottom-0 start-0 end-0 p-3 bg-dark bg-opacity-50 d-flex justify-content-between align-items-center">
                <button
                    onClick={togglePlay}
                    className="btn btn-primary rounded-circle"
                    style={{ width: '50px', height: '50px' }}
                >
                    <i className={`bi ${isPlaying ? 'bi-pause-fill' : 'bi-play-fill'} fs-4`}></i>
                </button>

                {/* Progress Bar */}
                <div className="flex-grow-1 mx-3 progress bg-secondary" style={{ height: '8px', cursor: 'pointer' }}>
                    <div
                        className="progress-bar bg-info"
                        role="progressbar"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                    />
                </div>
            </div>

            {/* Subtitles Overlay */}
            {subtitles.length > 0 && activeSubtitleIndex !== -1 && (
                <div
                    ref={subtitleContainerRef}
                    className="subtitles-overlay position-absolute start-0 end-0 text-center px-4"
                    style={{ bottom: '80px', zIndex: 10 }}
                >
                    <span className="bg-dark bg-opacity-75 text-white p-2 rounded fs-4 fw-bold text-shadow">
                        {subtitles[activeSubtitleIndex].text}
                    </span>
                </div>
            )}

            {/* Placeholder for Camera Off Mode */}
            {isCameraOff && (
                <div className="position-absolute top-0 start-0 end-0 bottom-0 bg-black bg-opacity-75 d-flex align-items-center justify-content-center z-3">
                    <div className="text-center text-white">
                        <i className="bi bi-camera-video-off display-1 mb-3"></i>
                        <h3>Camera Disabled</h3>
                        <p>Audio is still active</p>
                    </div>
                </div>
            )}
        </div>
    );
}
