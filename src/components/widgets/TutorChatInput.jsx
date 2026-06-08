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
        <div className="w-100">
            <div className="card bg-dark border-secondary shadow-lg">
                <div className="card-body p-2 d-flex align-items-center gap-2">
                    <div className="flex-grow-1 d-flex flex-column">
                        <textarea
                            ref={textareaRef}
                            className="form-control bg-dark text-white border-secondary"
                            rows="2"
                            placeholder="Ask your tutor a question..."
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                    </div>
                    <button id="answer-submit-button" type="button" onClick={handleSend}>
                        <i className="bi bi-send-fill"></i>
                    </button>
                </div>
            </div>
        </div>
    );
}
