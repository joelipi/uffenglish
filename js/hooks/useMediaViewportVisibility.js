import { useLayoutEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';

export function useMediaViewportVisibility() {
    const mediaVisible = useStore(appStore, (state) => state.mediaVisible);

    useLayoutEffect(() => {
        const mv = document.getElementById('media-viewport');
        if (mv) mv.classList.toggle('d-none', !mediaVisible);
    }, [mediaVisible]);
}
