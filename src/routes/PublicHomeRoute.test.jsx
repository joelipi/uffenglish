import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// The route imports the preloader hook (store-backed), the landing container
// (Supabase graph), and must NOT render the dashboard. Mock all three so the
// route's own behavior — mount, preloader completion, which child renders — is
// what is under test.
const finishPreloader = vi.fn();
vi.mock('../hooks/usePreloader.js', () => ({
    usePreloader: () => ({ finishPreloader }),
}));
vi.mock('../components/homescreen/HomeLandingContainer.jsx', () => ({
    default: () => React.createElement('div', { 'data-testid': 'landing-container-stub' }, 'landing'),
}));
const homeScreenSpy = vi.fn();
vi.mock('../components/homescreen/HomeScreen.jsx', () => ({
    default: () => { homeScreenSpy(); return React.createElement('div', { 'data-testid': 'home-screen-stub' }, 'home'); },
}));

import PublicHomeRoute from './PublicHomeRoute.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('PublicHomeRoute', () => {
    let container;
    let root;

    beforeEach(() => {
        finishPreloader.mockClear();
        homeScreenSpy.mockClear();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
    });

    const render = () => {
        root = createRoot(container);
        act(() => { root.render(React.createElement(PublicHomeRoute)); });
    };

    it('renders the landing container and not HomeScreen', () => {
        render();
        expect(container.querySelector('[data-testid="landing-container-stub"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="home-screen-stub"]')).toBeNull();
        expect(homeScreenSpy).not.toHaveBeenCalled();
    });

    it('finishes the preloader exactly once on mount', () => {
        render();
        expect(finishPreloader).toHaveBeenCalledTimes(1);
    });
});
