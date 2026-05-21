import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function ProgressBar() {
    const progressPercent = useStore(appStore, (state) => state.progressPercent);
    const target = document.getElementById('react-root-progress');

    return target ? createPortal(
        <div className="progress-bar" role="progressbar"
            style={{ width: progressPercent + '%' }}
            aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100">
        </div>,
        target
    ) : null;
}
