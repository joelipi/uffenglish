import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function TutorChatInput() {
    const tutorChatVisible = useStore(appStore, (state) => state.tutorChatVisible);
    const tutorChatSubmitCallback = useStore(appStore, (state) => state.tutorChatSubmitCallback);
    const [inputValue, setInputValue] = useState('');
    const textareaRef = useRef(null);
    const callbackRef = useRef(tutorChatSubmitCallback);

    callbackRef.current = tutorChatSubmitCallback;

    const handleSend = useCallback(() => {
        const text = inputValue.trim();
        if (text && callbackRef.current) {
            setInputValue('');
            callbackRef.current(text);
        }
    }, [inputValue]);

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    if (!tutorChatVisible) return null;

    return (
        <div className="card-footer bg-white border-top-0 w-100">
            <div className="input-group">
                <textarea
                    ref={textareaRef}
                    className="form-control"
                    rows="2"
                    placeholder="Ask your tutor a question..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <button className="btn btn-primary" type="button" onClick={handleSend}>
                    <i className="bi bi-send-fill"></i>
                </button>
            </div>
        </div>
    );
}
