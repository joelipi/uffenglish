// The friend's share code has to be captured on EVERY location change, not
// once at start-up: the profile's friend-practice link is a client-side
// navigation (react-router's <Link>), so the app is already mounted when the
// visitor clicks it. A one-shot start-up capture would miss the code, and the
// lesson would then play the learner's own take instead of the friend's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

import { appStore } from '../modules/store/store.js';
import { useShareCodeFromLocation } from './use-share-code.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Drives the hook inside a router and exposes the two navigations the test
// needs: one that carries a share code, one that does not.
function Harness() {
    useShareCodeFromLocation();
    const navigate = useNavigate();
    const location = useLocation();
    return (
        <div>
            <span data-testid="where">{location.pathname}{location.search}</span>
            <button type="button" data-testid="with-code"
                onClick={() => navigate('/course/friend/lesson/b?shareCode=zz9')}>with code</button>
            <button type="button" data-testid="without-code"
                onClick={() => navigate('/course/friend/lesson/c')}>without code</button>
        </div>
    );
}

function renderHarness(container, initialEntry) {
    const root = createRoot(container);
    act(() => {
        root.render(
            React.createElement(
                MemoryRouter,
                { initialEntries: [initialEntry] },
                React.createElement(
                    Routes,
                    null,
                    React.createElement(Route, { path: '*', element: React.createElement(Harness) })
                )
            )
        );
    });
    return root;
}

describe('useShareCodeFromLocation', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        appStore.getState().setFriendCode(null);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
        appStore.getState().setFriendCode(null);
    });

    it('captures the share code from the query string on mount', () => {
        root = renderHarness(container, '/course/friend/lesson/b?shareCode=ab12');
        expect(appStore.getState().friendCode).toBe('ab12');
    });

    it('captures a share code that arrives with a CLIENT-SIDE navigation', () => {
        // The regression this hook exists for: the profile link is a
        // react-router <Link>, so the app is already mounted when the visitor
        // clicks it and a start-up-only capture would never see the code.
        root = renderHarness(container, '/owner1');
        expect(appStore.getState().friendCode).toBeNull();

        act(() => {
            container.querySelector('[data-testid="with-code"]').click();
        });

        expect(container.querySelector('[data-testid="where"]').textContent)
            .toBe('/course/friend/lesson/b?shareCode=zz9');
        expect(appStore.getState().friendCode).toBe('zz9');
    });

    it('normalises the code the way the rest of the app does (trimmed, lowercased)', () => {
        root = renderHarness(container, '/course/friend/lesson/b?shareCode=%20AB12%20');
        expect(appStore.getState().friendCode).toBe('ab12');
    });

    it('keeps the captured code when the next location carries none', () => {
        // The lesson advances to the next lesson with a client-side navigation
        // that has no query string. Clearing the code there would drop the
        // friend's clip the moment the learner moves on.
        root = renderHarness(container, '/course/friend/lesson/b?shareCode=ab12');
        expect(appStore.getState().friendCode).toBe('ab12');

        act(() => {
            container.querySelector('[data-testid="without-code"]').click();
        });

        expect(appStore.getState().friendCode).toBe('ab12');
    });

    it('leaves the store untouched when the location carries no share code', () => {
        root = renderHarness(container, '/owner1');
        expect(appStore.getState().friendCode).toBeNull();
    });
});
