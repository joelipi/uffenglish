import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function ProgressBar() {
    const progressPercent = useStore(appStore, (state) => state.progressPercent);
    const widthValue = typeof progressPercent === 'string' && progressPercent.endsWith('%')
        ? progressPercent
        : progressPercent + '%';

    return (
        <div className="progress-bar" role="progressbar"
            style={{ width: widthValue }}
            aria-valuenow={parseInt(progressPercent)} aria-valuemin="0" aria-valuemax="100">
        </div>
    );
}
