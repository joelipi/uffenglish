/**
 * CriticalErrorModal — displays critical error messages
 * Pure React component, no DOM manipulation.
 */

import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function CriticalErrorModal() {
    const criticalErrorMessage = useStore(appStore, (state) => state.criticalErrorMessage);

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
            <button className="btn btn-primary px-4 rounded-pill" onClick={() => appStore.getState().clearCriticalError()}>
                <i className="bi bi-arrow-clockwise"></i> Try Again
            </button>
        </div>
    );
}
