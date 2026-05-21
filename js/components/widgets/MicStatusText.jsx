import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function MicStatusText() {
    const micStatusText = useStore(appStore, (state) => state.micStatusText);
    const target = document.getElementById('react-root-micstatus');

    return target ? createPortal(
        <div className="d-flex justify-content-center align-items-center"
            dangerouslySetInnerHTML={{ __html: micStatusText }}>
        </div>,
        target
    ) : null;
}
