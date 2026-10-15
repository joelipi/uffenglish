// SuccessButtons.test.jsx
// Wiring tests for the friend-row delayed Continue (story 061, Task 4).
// Renders the real VideoButton with fake timers: tapping Share on a
// friend success row schedules the fixed-delay reveal through the pure
// scheduler, whatever the (here absent) delivery settles as.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../modules/utils/posthog.js', () => ({ trackEvent: vi.fn() }));
vi.mock('../../modules/api/api.js', () => ({
    useAddFriendLinkMutation: () => ({ mutateAsync: vi.fn() }),
    useRecordFriendResponseMutation: () => ({ mutateAsync: vi.fn() }),
}));

import { VideoButton, ContinueButton } from './SuccessButtons.jsx';
import { appStore } from '../../modules/store/store.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUCCESS_CONTINUE_REVEAL_DELAY_MS } from '../../modules/lesson/success-continue-logic.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRIEND_CONFIG = {
    lessons: [
        { lessonId: 'a', recapOverlay: 'shareCta' },
        { lessonId: 'b', recapOverlay: 'shareCta' },
    ],
};
const PLAIN_CONFIG = { lessons: [{ lessonId: 'm-g' }] };

describe('VideoButton delayed Continue', () => {
    let container;
    let root;
    let client;

    function seedSuccess({ configData, lessonId }) {
        appStore.setState({
            successVideoButton: { visible: true, loading: false, state: 'ready' },
            successLessonId: lessonId,
            successFluencyData: { total: 80 },
            successContinueButton: { visible: false, loading: false },
            successRepeatButton: { visible: false },
            successCanvasVisible: false,
            afterVideoActive: null,
            configData,
            currentLessonIndex: 0,
            userData: { native_language: 'en' },
        });
    }

    beforeEach(() => {
        vi.useFakeTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
        client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        appStore.getState().hideSuccessScreen();
        appStore.setState({ configData: null, userData: null });
        vi.useRealTimers();
    });

    async function renderShare() {
        root = createRoot(container);
        await act(async () => {
            root.render(
                React.createElement(QueryClientProvider, { client },
                    React.createElement(VideoButton, { canvasRef: { current: null } })
                )
            );
        });
        const button = container.querySelector('#createVideoButton');
        expect(button).not.toBeNull();
        return button;
    }

    async function tapShare(button) {
        await act(async () => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
    }

    async function advance(ms) {
        await act(async () => {
            vi.advanceTimersByTime(ms);
        });
    }

    function continueVisible() {
        return appStore.getState().successContinueButton.visible === true;
    }

    it('reveals Continue 3s after the Share tap on a friend row (delivery absent = fail-open)', async () => {
        seedSuccess({ configData: FRIEND_CONFIG, lessonId: 'b' });
        const button = await renderShare();
        await tapShare(button);
        // Not instantly: the reveal waits out the fixed delay.
        expect(continueVisible()).toBe(false);
        await advance(SUCCESS_CONTINUE_REVEAL_DELAY_MS - 1);
        expect(continueVisible()).toBe(false);
        await advance(1);
        expect(continueVisible()).toBe(true);
    });

    it('never reveals on a non-friend row, however long the wait', async () => {
        seedSuccess({ configData: PLAIN_CONFIG, lessonId: 'm-g' });
        const button = await renderShare();
        await tapShare(button);
        await advance(10000);
        expect(continueVisible()).toBe(false);
    });

    it('first tap wins: a re-tap never pushes the reveal out', async () => {
        seedSuccess({ configData: FRIEND_CONFIG, lessonId: 'b' });
        const button = await renderShare();
        await tapShare(button);
        await advance(1000);
        await tapShare(button);
        // 3s after the FIRST tap (2s after the second): already revealed.
        await advance(1999);
        expect(continueVisible()).toBe(false);
        await advance(1);
        expect(continueVisible()).toBe(true);
    });

    it('cancels the pending reveal on unmount', async () => {
        seedSuccess({ configData: FRIEND_CONFIG, lessonId: 'b' });
        const button = await renderShare();
        await tapShare(button);
        act(() => root.unmount());
        root = null;
        await advance(10000);
        expect(continueVisible()).toBe(false);
    });

    it('a lesson change clears the pending reveal so the new lesson can schedule', async () => {
        const threeLessons = {
            lessons: [
                { lessonId: 'a', recapOverlay: 'shareCta' },
                { lessonId: 'b', recapOverlay: 'shareCta' },
                { lessonId: 'c', recapOverlay: 'shareCta' },
            ],
        };
        seedSuccess({ configData: threeLessons, lessonId: 'b' });
        const button = await renderShare();
        await tapShare(button);
        // Move to the next friend lesson before the timer fires.
        await act(async () => {
            appStore.setState({
                successLessonId: 'c',
                successContinueButton: { visible: false, loading: false },
            });
        });
        await advance(10000);
        expect(continueVisible()).toBe(false);
        // The cleared ref allows scheduling for the new lesson.
        await tapShare(button);
        await advance(SUCCESS_CONTINUE_REVEAL_DELAY_MS);
        expect(continueVisible()).toBe(true);
    });
});

describe('success Continue matches Share styling', () => {
    let container;
    let root;
    let client;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        appStore.setState({
            successVideoButton: { visible: true, loading: false, state: 'ready' },
            successLessonId: 'b',
            successFluencyData: { total: 80 },
            successContinueButton: { visible: true, loading: false },
            successRepeatButton: { visible: false },
            successCanvasVisible: false,
            afterVideoActive: null,
            configData: FRIEND_CONFIG,
            currentLessonIndex: 0,
            userData: { native_language: 'en' },
        });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        appStore.getState().hideSuccessScreen();
        appStore.setState({ configData: null, userData: null });
    });

    it('gives Continue the same wrapper and button classes as Share (icon differs)', async () => {
        root = createRoot(container);
        await act(async () => {
            root.render(
                React.createElement(QueryClientProvider, { client },
                    React.createElement('div', null,
                        React.createElement(VideoButton, { canvasRef: { current: null } }),
                        React.createElement(ContinueButton, { onLoadNextLesson: () => {} })
                    )
                )
            );
        });
        const shareBtn = container.querySelector('#createVideoButton');
        const continueBtn = container.querySelector('#continueButtonSuccess');
        expect(shareBtn).not.toBeNull();
        expect(continueBtn).not.toBeNull();
        expect(continueBtn.className).toBe(shareBtn.className);
        expect(continueBtn.closest('.ivp-choice-col').className)
            .toBe(shareBtn.closest('.ivp-choice-col').className);
        // Same styling except the icon.
        expect(continueBtn.querySelector('i').className)
            .not.toBe(shareBtn.querySelector('i').className);
    });

    it('does not suppress the Continue glow in CSS', async () => {
        const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/css/app.css');
        const css = readFileSync(cssPath, 'utf8');
        expect(css).not.toContain('continueButtonSuccess');
    });
});
