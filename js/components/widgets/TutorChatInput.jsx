import React, { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function TutorChatInput() {
    const tutorChatVisible = useStore(appStore, (state) => state.tutorChatVisible);
    const tutorChatSubmitCallback = useStore(appStore, (state) => state.tutorChatSubmitCallback);

    useEffect(() => {
        const el = document.getElementById('chat-input-area');
        if (!el) return;
        if (tutorChatVisible) {
            el.style.setProperty('display', 'block', 'important');
        } else {
            el.style.removeProperty('display');
        }
    }, [tutorChatVisible]);

    useEffect(() => {
        const textarea = document.getElementById('chat-input-field');
        const sendBtn = document.getElementById('chat-send-button');
        if (!textarea || !sendBtn || !tutorChatSubmitCallback) return;

        const handleSend = () => {
            const text = textarea.value;
            if (text && text.trim().length > 0) {
                textarea.value = '';
                tutorChatSubmitCallback(text);
            }
        };

        const handleKeydown = (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                handleSend();
            }
        };

        sendBtn.addEventListener('click', handleSend);
        textarea.addEventListener('keydown', handleKeydown);

        return () => {
            sendBtn.removeEventListener('click', handleSend);
            textarea.removeEventListener('keydown', handleKeydown);
        };
    }, [tutorChatSubmitCallback]);

    return null;
}
