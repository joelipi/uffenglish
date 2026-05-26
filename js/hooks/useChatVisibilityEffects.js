import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';

export function useChatVisibilityEffects() {
    const chatModeActive = useStore(appStore, (state) => state.chatModeActive);
    const prevChatModeActive = useRef(undefined);
    const isFirstRun = useRef(true);

    useEffect(() => {
        const active = chatModeActive;

        if (isFirstRun.current) {
            isFirstRun.current = false;
            prevChatModeActive.current = active;
        } else if (active === prevChatModeActive.current) {
            return;
        }
        prevChatModeActive.current = active;

        const bottomOverlay = document.querySelector('.bottom-overlay');
        const whisperEl = document.getElementById('whisperReviewContainer');
        const videoWrapper = document.getElementById('playback-video-wrapper');

        if (active) {
            if (bottomOverlay) {
                bottomOverlay.style.setProperty('display', 'none', 'important');
            }
            document.body.classList.add('chat-mode-active');
            if (whisperEl) whisperEl.classList.add('d-none');
        } else {
            if (bottomOverlay) {
                bottomOverlay.style.removeProperty('display');
            }
            document.body.classList.remove('chat-mode-active');
            if (whisperEl) whisperEl.classList.add('d-none');
            if (videoWrapper) {
                videoWrapper.style.display = 'none';
                document.body.appendChild(videoWrapper);
            }
        }
    }, [chatModeActive]);
}
