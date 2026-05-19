import React, { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function CriticalErrorModal() {
    const criticalErrorMessage = useStore(appStore, (state) => state.criticalErrorMessage);

    useEffect(() => {
        if (criticalErrorMessage) {
            const mediaViewport = document.getElementById('media-viewport');
            if (mediaViewport) {
                mediaViewport.classList.remove('d-none');
            }
            console.error("[UI] Critical Error Shown:", criticalErrorMessage);
        }
    }, [criticalErrorMessage]);

    if (!criticalErrorMessage) return null;

    return (
        <div
            id="criticalErrorContainer"
            className="w-100 h-100 d-flex flex-column align-items-center justify-content-center p-4 text-white text-center"
        >
            <i className="bi bi-exclamation-triangle-fill text-warning mb-3"></i>
            <h4 className="mb-2">Lesson Load Error</h4>
            <p id="criticalErrorMessage" className="text-secondary mb-4">
                {criticalErrorMessage}
            </p>
            <button className="btn btn-primary px-4 rounded-pill" onClick={() => window.location.reload()}>
                <i className="bi bi-arrow-clockwise"></i> Try Again
            </button>
        </div>
    );
}
