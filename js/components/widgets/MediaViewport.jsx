import React, { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function MediaViewport() {
    const mediaVisible = useStore(appStore, (state) => state.mediaVisible);

    useEffect(() => {
        const el = document.getElementById('media-viewport');
        if (el) {
            el.classList.toggle('d-none', !mediaVisible);
        }
    }, [mediaVisible]);

    return null;
}
