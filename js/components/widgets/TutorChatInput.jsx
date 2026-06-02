import React, { useState, useCallback, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function TutorChatInput({ onSubmit }) {
    const tutorChatVisible = useStore(appStore, (state) => state.tutorChatVisible);
    const [inputValue, setInputValue] = useState('');
    const textareaRef = useRef(null);

    const handleSend = useCallback(() => {
        const text = inputValue.trim();
        if (text && onSubmit) {
            setInputValue('');
            onSubmit(text);
        }
    }, [inputValue, onSubmit]);

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
