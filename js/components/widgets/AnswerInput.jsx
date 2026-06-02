import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { getTextInputSubmitCallback, getSpeechInputToggleCallback, getCallbackVersion } from '../../modules/lesson/step-loader-callbacks.js';

export default function AnswerInput() {
    const textInputVisible = useStore(appStore, (state) => state.textInputVisible);
    const textInputPlaceholder = useStore(appStore, (state) => state.textInputPlaceholder);
    const answerErrorMessage = useStore(appStore, (state) => state.answerErrorMessage);
    const submitBtnDisabled = useStore(appStore, (state) => state.submitBtnDisabled);
    const submitBtnIcon = useStore(appStore, (state) => state.submitBtnIcon);
    const submitBtnDanger = useStore(appStore, (state) => state.submitBtnDanger);
    const inputDisabled = useStore(appStore, (state) => state.inputDisabled);
    const scoreUpdateTrigger = useStore(appStore, (state) => state.scoreUpdateTrigger);
    const inputFocusTrigger = useStore(appStore, (state) => state.inputFocusTrigger);
    const [inputValue, setInputValue] = useState('');
    const [scoreAnimating, setScoreAnimating] = useState(false);
    const inputFieldRef = useRef(null);
    const submitBtnRef = useRef(null);
    const containerRef = useRef(null);

    // Reset input on callback version change (new step loaded)
    const prevCbVersion = useRef(getCallbackVersion());
    useEffect(() => {
        const v = getCallbackVersion();
        if (v !== prevCbVersion.current) {
            prevCbVersion.current = v;
            setInputValue('');
        }
    });

    // Score update CSS animation trigger
    const prevScoreUpdateTrigger = useRef(scoreUpdateTrigger);
    useEffect(() => {
        if (scoreUpdateTrigger === prevScoreUpdateTrigger.current) return;
        prevScoreUpdateTrigger.current = scoreUpdateTrigger;
        setScoreAnimating(true);
        setTimeout(() => setScoreAnimating(false), 300);
    }, [scoreUpdateTrigger]);

    // Input focus trigger
    const prevInputFocusTrigger = useRef(inputFocusTrigger);
    useEffect(() => {
        if (inputFocusTrigger === prevInputFocusTrigger.current) return;
        prevInputFocusTrigger.current = inputFocusTrigger;
        if (inputFieldRef.current && !inputDisabled) {
            setTimeout(() => inputFieldRef.current.focus(), 100);
        }
    }, [inputFocusTrigger, inputDisabled]);

    const handleSubmit = useCallback(() => {
        const value = inputValue.trim();
        const cb = getTextInputSubmitCallback();
        if (value && cb) {
            cb(value, submitBtnRef.current);
        }
    }, [inputValue]);

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            handleSubmit();
        }
    }, [handleSubmit]);

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
                inputFieldRef.current?.focus();
            }, 100);
        }
    }, [textInputVisible]);

    if (!textInputVisible) return null;

    return (
        <div ref={containerRef} className={`position-absolute w-100 p-3${scoreAnimating ? ' score-update' : ''}`} style={{ zIndex: 9999 }}>
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