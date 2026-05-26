import { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';

export function useMediaViewportVisibility() {
    const mediaVisible = useStore(appStore, (state) => state.mediaVisible);

    useEffect(() => {
        const mv = document.getElementById('media-viewport');
        if (mv) {
            mv.classList.toggle('d-none', !mediaVisible);
        }
    }, [mediaVisible]);
}
