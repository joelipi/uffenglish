// --- components/ui-effects.js ---
// Web-only store subscriber for DOM side effects.
// Replaces direct document.getElementById calls that were removed from
// shared business-logic modules (answer-pipeline.js, lesson-progression.js).
// This file is imported only by web entry points (app.js, LessonContainer.jsx).

import { appStore } from '../modules/store.js';
import { pointLoss } from './point-loss-animation.js';
import { clearPlaybackVideo } from './playback.js';
import { State } from '../modules/state.js';

let prevVideoPlayTrigger = 0;
let prevVideoClearTrigger = 0;
let prevPointLossTrigger = 0;
let prevScoreUpdateTrigger = 0;
let prevInputFocusTrigger = 0;
let prevCompletionMessage = null;

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
    });
}
