import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function WhisperReview() {
    const data = useStore(appStore, (s) => s.whisperReviewData);
    const timeLeft = useStore(appStore, (s) => s.whisperReviewTimeLeft);
    const chatModeActive = useStore(appStore, (s) => s.chatModeActive);

    if (!data || chatModeActive) return null;

    return (
        <div className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center p-4 text-white text-center" style={{ zIndex: 1050 }}>
            <div className="whisper-review-box bg-dark p-4 rounded border border-secondary shadow-lg">
                <WhisperReviewBody
                    transcript={data.transcript}
                    timeLeft={timeLeft}
                    onAccept={data.onAccept}
                    onReject={data.onReject}
                />
            </div>
        </div>
    );
}

function WhisperReviewBody({ transcript, timeLeft, onAccept, onReject }) {
    const [barWidth, setBarWidth] = useState(100);
    const [animating, setAnimating] = useState(false);

    useEffect(() => {
        setBarWidth(100);
        setAnimating(false);
        requestAnimationFrame(() => setAnimating(true));
    }, [transcript]);

    useEffect(() => {
        if (animating) {
            setBarWidth(0);
        }
    }, [animating]);

    const handleAccept = () => {
        appStore.getState().setWhisperReviewData(null);
        appStore.getState().setWhisperReviewTimeLeft(null);
        onAccept();
    };

    const handleReject = () => {
        appStore.getState().setWhisperReviewData(null);
        appStore.getState().setWhisperReviewTimeLeft(null);
        onReject();
    };

    return (
        <>
            <div className="mb-3">
                <div className="mb-3">{`"${transcript}"`}</div>
            </div>
            <div className="progress whisper-progress mb-4">
                <div className="progress-bar bg-success" role="progressbar" style={{ width: `${barWidth}%`, transition: animating ? 'width 7s linear' : 'none' }}></div>
            </div>
            <div className="d-flex justify-content-center gap-3">
                <button className="btn btn-outline-danger px-4 rounded-pill" onClick={handleReject}>
                    <i className="bi bi-arrow-counterclockwise"></i> Re-record
                </button>
                <button className="btn btn-primary px-4 rounded-pill" onClick={handleAccept}>
                    <i className="bi bi-check2"></i> Accept ({timeLeft}s)
                </button>
            </div>
        </>
    );
}
