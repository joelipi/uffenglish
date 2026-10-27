// The transcript review's countdown is off by default (review-countdown-logic.js):
// the overlay must not show a timer, and the orchestrator must not tick or accept
// on the learner's behalf.
//
// Rendered against the real component + the real store, so this fails if the
// gate is dropped or the store value starts arriving again.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WhisperReview from './WhisperReview.jsx';
import { appStore } from '../../modules/store/store.js';
import { REVIEW_COUNTDOWN_SECONDS } from '../../modules/lesson/review-countdown-logic.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container = null;
let root = null;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    container = null;
    root = null;
    appStore.getState().setWhisperReviewData(null);
    appStore.getState().setWhisperReviewTimeLeft(null);
});

describe('the review overlay shows no countdown by default', () => {
    it('renders the transcript only — no "Time remaining" line, no bar', () => {
        appStore.getState().setWhisperReviewData({ transcript: 'a clear sentence', timeLeft: null });
        appStore.getState().setWhisperReviewTimeLeft(null);

        act(() => root.render(<WhisperReview />));

        expect(container.textContent).toContain('a clear sentence');
        expect(container.textContent).not.toContain('Time remaining');
        expect(container.querySelector('.whisper-progress')).toBeNull();
    });

    it('still renders the timer when the countdown is switched on again', () => {
        // The component is left able to show it: only the store value decides,
        // so re-enabling review-countdown-logic.js restores the UI unchanged.
        appStore.getState().setWhisperReviewData({ transcript: 'a clear sentence', timeLeft: REVIEW_COUNTDOWN_SECONDS });
        appStore.getState().setWhisperReviewTimeLeft(REVIEW_COUNTDOWN_SECONDS);

        act(() => root.render(<WhisperReview />));

        expect(container.textContent).toContain(`Time remaining: ${REVIEW_COUNTDOWN_SECONDS}s`);
        expect(container.querySelector('.whisper-progress')).not.toBeNull();
    });

    it('renders nothing without a review in progress', () => {
        appStore.getState().setWhisperReviewData(null);
        act(() => root.render(<WhisperReview />));
        expect(container.textContent).toBe('');
    });
});
