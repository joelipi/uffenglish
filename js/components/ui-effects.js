// --- components/ui-effects.js ---
// Web-only store subscriber for DOM side effects.
// Replaces direct document.getElementById calls that were removed from
// shared business-logic modules (answer-pipeline.js, lesson-progression.js).
// This file is imported only by web entry points (app.js, LessonContainer.jsx).

import { appStore } from '../modules/store.js';
import { pointLoss } from './point-loss-animation.js';
import { clearPlaybackVideo } from './playback.js';

let prevVideoPlayTrigger = 0;
let prevVideoClearTrigger = 0;
let prevPointLossTrigger = 0;
let prevScoreUpdateTrigger = 0;
let prevInputFocusTrigger = 0;
let prevCompletionMessage = null;
let prevChatModeActive = false;

const SCORE_SPAN_MAP = {
    pronunciationScore: 'chat-score-pronunciation',
    listeningScore: 'chat-score-listening',
    flowScore: 'chat-score-flow',
    vocabularyScore: 'chat-score-vocabulary',
    grammarScore: 'chat-score-grammar',
    formalityScore: 'chat-score-formality',
    nativeLikeScore: 'chat-score-nativelike',
    understandingScore: 'chat-score-understanding',
    fluencyScore: 'chat-score-fluency',
};

const SCORE_SPAN_LIST = Object.values(SCORE_SPAN_MAP);

let prevScoreValues = {};

export function initUiEffects() {
    appStore.subscribe((state) => {
        if (state.videoPlayTrigger !== prevVideoPlayTrigger) {
            prevVideoPlayTrigger = state.videoPlayTrigger;
            const video = document.getElementById('playback-video');
            if (video) {
                video.muted = state.videoPlayMuted;
                video.play().catch(e => console.warn('[ui-effects] Playback resume failed:', e));
            }
        }

        if (state.videoClearTrigger !== prevVideoClearTrigger) {
            prevVideoClearTrigger = state.videoClearTrigger;
            clearPlaybackVideo();
        }

        if (state.pointLossTrigger !== prevPointLossTrigger && state.pointLossData) {
            prevPointLossTrigger = state.pointLossTrigger;
            const data = state.pointLossData;
            const targetEl = document.getElementById(
                data.target === 'pronunciation' ? 'pronunciationScore' : 'react-root-micstatus'
            );
            if (targetEl) {
                pointLoss.show(targetEl, data.points);
            }
            appStore.getState().clearPointLoss();
        }

        if (state.scoreUpdateTrigger !== prevScoreUpdateTrigger) {
            prevScoreUpdateTrigger = state.scoreUpdateTrigger;
            const area = document.getElementById('answer-input-area');
            if (area) {
                area.classList.remove('score-update');
                void area.offsetWidth;
                area.classList.add('score-update');
                setTimeout(() => area.classList.remove('score-update'), 300);
            }
        }

        if (state.inputFocusTrigger !== prevInputFocusTrigger) {
            prevInputFocusTrigger = state.inputFocusTrigger;
            const field = document.getElementById('answer-input-field');
            if (field) {
                field.disabled = !!state.inputDisabled;
                if (!state.inputDisabled) {
                    field.classList.remove('disabled');
                    setTimeout(() => field.focus(), 100);
                }
            }
        }

        if (state.completionMessage && state.completionMessage !== prevCompletionMessage) {
            prevCompletionMessage = state.completionMessage;
            const container = document.getElementById('steps-container');
            if (container) {
                container.innerHTML = `<div class="text-center">${state.completionMessage}</div>`;
            }
        }

        // --- Chat visibility ---
        if (state.chatModeActive !== prevChatModeActive) {
            prevChatModeActive = state.chatModeActive;
            if (state.chatModeActive) {
                const chatWindow = document.getElementById('chat-window-container');
                if (chatWindow) {
                    chatWindow.classList.remove('d-none');
                    chatWindow.style.setProperty('display', 'flex', 'important');
                }
                const bottomOverlay = document.querySelector('.bottom-overlay');
                if (bottomOverlay) {
                    bottomOverlay.style.setProperty('display', 'none', 'important');
                }
                document.body.classList.add('chat-mode-active');
                // Hide whisper container when chat opens
                const whisperEl = document.getElementById('whisperReviewContainer');
                if (whisperEl) whisperEl.classList.add('d-none');
            } else {
                const chatWindow = document.getElementById('chat-window-container');
                if (chatWindow) {
                    chatWindow.classList.add('d-none');
                    chatWindow.style.removeProperty('display');
                }
                const bottomOverlay = document.querySelector('.bottom-overlay');
                if (bottomOverlay) {
                    bottomOverlay.style.removeProperty('display');
                }
                document.body.classList.remove('chat-mode-active');
                const videoWrapper = document.getElementById('playback-video-wrapper');
                if (videoWrapper) {
                    videoWrapper.style.display = 'none';
                    document.body.appendChild(videoWrapper);
                }
                const whisperEl = document.getElementById('whisperReviewContainer');
                if (whisperEl) whisperEl.classList.add('d-none');
                // Clear score spans
                SCORE_SPAN_LIST.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = '';
                });
            }
        }

        // --- Chat header score spans ---
        if (state.chatModeActive) {
            Object.entries(SCORE_SPAN_MAP).forEach(([storeKey, spanId]) => {
                const score = state[storeKey];
                if (score !== undefined && score !== prevScoreValues[storeKey]) {
                    prevScoreValues[storeKey] = score;
                    const el = document.getElementById(spanId);
                    if (el) el.textContent = score === 100 ? '\uD83D\uDC4D' : String(Math.round(score));
                }
            });
        }
    });
}
