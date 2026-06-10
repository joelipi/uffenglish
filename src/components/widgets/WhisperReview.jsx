import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function WhisperReview() {
    const data = useStore(appStore, (s) => s.whisperReviewData);
    const timeLeft = useStore(appStore, (s) => s.whisperReviewTimeLeft);
    const chatModeActive = useStore(appStore, (s) => s.chatModeActive);

    if (!data || chatModeActive) return null;

    return (
        <div className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center p-4 text-white text-center" style={{ zIndex: 1050, pointerEvents: 'none' }}>
            <div className="whisper-review-box bg-dark p-4 rounded border border-secondary shadow-lg">
                <div className="mb-3 text-center fw-bold">Time remaining: {timeLeft}s</div>
                <div className="mb-3 text-center">{`\"${data.transcript}\"`}</div>
                <div className="progress whisper-progress mb-4" style={{ maxWidth: '300px', width: '100%' }}>
                    <div
                        className="progress-bar bg-success"
                        role="progressbar"
                        style={{ width: `${timeLeft > 0 ? (timeLeft / 7) * 100 : 0}%`, transition: timeLeft > 0 ? 'width 1s linear' : 'none' }}
                    ></div>
                </div>
            </div>
        </div>
    );
}
