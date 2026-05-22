import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function ProgressBar() {
    const progressPercent = useStore(appStore, (state) => state.progressPercent);
    const target = document.getElementById('progress');
    const widthValue = typeof progressPercent === 'string' && progressPercent.endsWith('%')
        ? progressPercent
        : progressPercent + '%';

    return target ? createPortal(
        <div className="progress-bar" role="progressbar"
            style={{ width: widthValue }}
            aria-valuenow={parseInt(progressPercent)} aria-valuemin="0" aria-valuemax="100">
        </div>,
        target
    ) : null;
}
