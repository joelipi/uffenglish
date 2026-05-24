import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function AnswerInput() {
    const textInputVisible = useStore(appStore, (state) => state.textInputVisible);
    const textInputPlaceholder = useStore(appStore, (state) => state.textInputPlaceholder);
    const textInputSubmitCallback = useStore(appStore, (state) => state.textInputSubmitCallback);
    const speechInputToggleCallback = useStore(appStore, (state) => state.speechInputToggleCallback);
    const answerErrorMessage = useStore(appStore, (state) => state.answerErrorMessage);
    const submitBtnDisabled = useStore(appStore, (state) => state.submitBtnDisabled);
    const submitBtnIcon = useStore(appStore, (state) => state.submitBtnIcon);
    const submitBtnDanger = useStore(appStore, (state) => state.submitBtnDanger);
    const inputDisabled = useStore(appStore, (state) => state.inputDisabled);

    const answerInputAreaRef = useRef(null);
    const answerInputFieldRef = useRef(null);
    const answerSubmitBtnRef = useRef(null);

    // Handle text input submission
    const handleSubmit = () => {
        console.log('[AnswerInput] handleSubmit called');
        console.log('answerInputFieldRef.current:', answerInputFieldRef.current);
        console.log('textInputSubmitCallback:', textInputSubmitCallback);
        if (answerInputFieldRef.current && textInputSubmitCallback) {
            const value = answerInputFieldRef.current.value.trim();
            console.log('[AnswerInput] Submitting value:', value);
            if (value) {
                textInputSubmitCallback(value, answerSubmitBtnRef.current);
            }
        }
    };

    // Toggle d-none on the portal target element when visibility changes
    useEffect(() => {
        const el = document.getElementById('answer-input-area');
        if (el) {
            el.classList.toggle('d-none', !textInputVisible);
        }
    }, [textInputVisible]);

    // Clear textarea when a new step's submit callback is bound
    useEffect(() => {
        if (answerInputFieldRef.current) {
            answerInputFieldRef.current.value = '';
        }
    }, [textInputSubmitCallback]);

    // Auto-clear answer error after 4 seconds
    useEffect(() => {
        if (answerErrorMessage) {
            const timer = setTimeout(() => {
                appStore.getState().setAnswerErrorMessage(null);
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [answerErrorMessage]);

    // Focus the input field when it becomes visible
    useEffect(() => {
        if (textInputVisible && answerInputFieldRef.current) {
            setTimeout(() => {
                answerInputFieldRef.current.focus();
            }, 100);
        }
    }, [textInputVisible]);

    // Bind global mic click handler
    useEffect(() => {
        if (speechInputToggleCallback) {
            window.onMicClick = speechInputToggleCallback;
        }
        return () => {
            window.onMicClick = null;
        };
    }, [speechInputToggleCallback]);

    const answerInputAreaEl = document.getElementById('answer-input-area');

    if (!answerInputAreaEl) {
        // If the element doesn't exist yet, don't render anything
        return null;
    }

    return createPortal(
        <div>
            <div className="card bg-dark border-secondary shadow-lg">
                <div className="card-body p-2 d-flex align-items-center gap-2">
                    <div className="flex-grow-1 d-flex flex-column">
                    <textarea
                        ref={answerInputFieldRef}
                        id="answer-input-field"
                        className="form-control bg-dark text-white border-secondary"
                        rows="2"
                        placeholder={textInputPlaceholder || 'Type your answer...'}
                        disabled={!textInputVisible || inputDisabled}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.ctrlKey) {
                                e.preventDefault();
                                handleSubmit();
                            }
                        }}
                    />
                    {answerErrorMessage && (
                        <div id="answer-error-message" className="text-danger small mt-1">{answerErrorMessage}</div>
                    )}
                    </div>
                    <button
                        ref={answerSubmitBtnRef}
                        id="answer-submit-button"
                        disabled={!textInputVisible || submitBtnDisabled}
                        onClick={handleSubmit}
                    >
                        <i className="bi bi-send-fill"></i>
                    </button>
                </div>
            </div>
        </div>,
        answerInputAreaEl
    );
}