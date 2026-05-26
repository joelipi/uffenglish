import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';

export function useInputFocusEffects() {
    const inputFocusTrigger = useStore(appStore, (state) => state.inputFocusTrigger);
    const inputDisabled = useStore(appStore, (state) => state.inputDisabled);
    const prevInputFocusTrigger = useRef(inputFocusTrigger);

    useEffect(() => {
        if (inputFocusTrigger === prevInputFocusTrigger.current) return;
        prevInputFocusTrigger.current = inputFocusTrigger;

        const field = document.getElementById('answer-input-field');
        if (field) {
            field.disabled = !!inputDisabled;
            if (!inputDisabled) {
                field.classList.remove('disabled');
                setTimeout(() => field.focus(), 100);
            }
        }
    }, [inputFocusTrigger, inputDisabled]);
}
