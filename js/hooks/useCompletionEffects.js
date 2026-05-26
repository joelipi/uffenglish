import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';

export function useCompletionEffects() {
    const completionMessage = useStore(appStore, (state) => state.completionMessage);
    const prevCompletionMessage = useRef(completionMessage);

    useEffect(() => {
        if (!completionMessage || completionMessage === prevCompletionMessage.current) return;
        prevCompletionMessage.current = completionMessage;

        const container = document.getElementById('steps-container');
        if (container) {
            container.innerHTML = `<div class="text-center">${completionMessage}</div>`;
        }
    }, [completionMessage]);
}
