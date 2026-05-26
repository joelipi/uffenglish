import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function MicStatusText() {
    const micStatusText = useStore(appStore, (state) => state.micStatusText);

    if (!micStatusText) return null;

    return (
        <div id="react-root-micstatus" className="d-flex justify-content-center align-items-center">
            <div id="micStatusText" dangerouslySetInnerHTML={{ __html: micStatusText }} />
        </div>
    );
}
