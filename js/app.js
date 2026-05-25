// --- app.js ---
// Retained solely for:
// 1. Global console.log filter (window.enabledLogs) — imported as side effect
// 2. Test exports: submitAnswerPrecheck, handleAnswer
//
// Full app bootstrap has been migrated to React (see js/App.jsx and
// js/hooks/useAppBootstrap.js). This module is no longer loaded as an
// application entry point (the <script> tag has been removed from index.html).

// --- SMART LOG SWITCH ---
// This overrides console.log to prevent console clutter.
// To see logs for a specific module, change its value to true in the window.enabledLogs object below.
const originalConsoleLog = console.log;
window.enabledLogs = {
    whisper: false,
    recording: false,
    speech: false,
    api: false,
    'tanstack query': false,
    toggle: false,
    ai: false,
    analytics: false,
    ui: false,
    hesitation: false,
    success: false,
    scoring: false,
    video: false,
    router: false,
    pipeline: false,
    app: false,
    storage: false,
    gamification: false,
    all: false
};

console.log = (msg, ...args) => {
    if (typeof msg === 'string') {
        const match = msg.match(/^\[(.*?)\]/i);
        if (match) {
            const namespace = match[1].toLowerCase();
            if (window.enabledLogs[namespace]) {
                originalConsoleLog(msg, ...args);
                return;
            }
            if (window.enabledLogs.hasOwnProperty(namespace)) return;
        }
    }
    if (window.enabledLogs.all) {
        originalConsoleLog(msg, ...args);
    }
};

import { submitAnswerPrecheck as submitAnswerPrecheckImpl, handleAnswer as handleAnswerImpl } from './modules/answer-pipeline.jsx';
import { loadStep } from './components/step-loader.web.js';

// Re-export answer pipeline wrappers for Playwright tests.
// These inject the answerDeps that the answer pipeline needs at position 7.
const answerDeps = { loadNextStep: null };

export async function submitAnswerPrecheck(...args) {
    if (args.length < 11) {
        return submitAnswerPrecheckImpl(
            args[0], args[1], args[2], args[3], args[4], args[5], args[6],
            answerDeps,
            args[7], args[8], args[9]
        );
    }
    return submitAnswerPrecheckImpl(...args, answerDeps);
}

export async function handleAnswer(...args) {
    if (args.length < 11) {
        return handleAnswerImpl(
            args[0], args[1], args[2], args[3], args[4], args[5], args[6],
            answerDeps,
            args[7], args[8], args[9]
        );
    }
    return handleAnswerImpl(...args, answerDeps);
}
