import React, { useEffect, useRef, useState, useCallback } from 'react';
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
    const scoreUpdateTrigger = useStore(appStore, (state) => state.scoreUpdateTrigger);
    const inputFocusTrigger = useStore(appStore, (state) => state.inputFocusTrigger);

    const [inputValue, setInputValue] = useState('');
    const inputFieldRef = useRef(null);
    const submitBtnRef = useRef(null);
    const containerRef = useRef(null);

    // Score update CSS animation trigger
    const prevScoreUpdateTrigger = useRef(scoreUpdateTrigger);
    useEffect(() => {
        if (scoreUpdateTrigger === prevScoreUpdateTrigger.current) return;
        prevScoreUpdateTrigger.current = scoreUpdateTrigger;
        const el = containerRef.current;
        if (el) {
            el.classList.remove('score-update');
            void el.offsetWidth;
            el.classList.add('score-update');
            setTimeout(() => el.classList.remove('score-update'), 300);
        }
    }, [scoreUpdateTrigger]);

    // Input focus trigger
    const prevInputFocusTrigger = useRef(inputFocusTrigger);
    useEffect(() => {
        if (inputFocusTrigger === prevInputFocusTrigger.current) return;
        prevInputFocusTrigger.current = inputFocusTrigger;
        const field = inputFieldRef.current;
        if (field) {
            field.disabled = !!inputDisabled;
            if (!inputDisabled) {
                field.classList.remove('disabled');
                setTimeout(() => field.focus(), 100);
            }
        }
    }, [inputFocusTrigger, inputDisabled]);

    const handleSubmit = useCallback(() => {
        const value = inputValue.trim();
        if (value && textInputSubmitCallback) {
            textInputSubmitCallback(value, submitBtnRef.current);
        }
    }, [inputValue, textInputSubmitCallback]);

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            handleSubmit();
        }
    }, [handleSubmit]);

    useEffect(() => {
        setInputValue('');
    }, [textInputSubmitCallback]);

    useEffect(() => {
        if (answerErrorMessage) {
            const timer = setTimeout(() => {
                appStore.getState().setAnswerErrorMessage(null);
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [answerErrorMessage]);

    useEffect(() => {
        if (textInputVisible && inputFieldRef.current) {
            setTimeout(() => {
                inputFieldRef.current.focus();
            }, 100);
        }
    }, [textInputVisible]);

    useEffect(() => {
        appStore.getState().setOnMicClickCallback(speechInputToggleCallback || null);
        return () => {
            appStore.getState().setOnMicClickCallback(null);
        };
    }, [speechInputToggleCallback]);

    if (!textInputVisible) return null;

    return (
        <div ref={containerRef} className="position-absolute w-100 p-3" style={{ zIndex: 9999 }}>
            <div className="card bg-dark border-secondary shadow-lg">
                <div className="card-body p-2 d-flex align-items-center gap-2">
                    <div className="flex-grow-1 d-flex flex-column">
                        <textarea
                            ref={inputFieldRef}
                            className="form-control bg-dark text-white border-secondary"
                            rows="2"
                            placeholder={textInputPlaceholder || 'Type your answer...'}
                            disabled={inputDisabled}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                        {answerErrorMessage && (
                            <div id="answer-error-message" className="text-danger small mt-1">{answerErrorMessage}</div>
                        )}
                    </div>
                    <button
                        ref={submitBtnRef}
                        id="answer-submit-button"
                        disabled={submitBtnDisabled}
                        onClick={handleSubmit}
                    >
                        <i className="bi bi-send-fill"></i>
                    </button>
                </div>
            </div>
        </div>
    );
}
