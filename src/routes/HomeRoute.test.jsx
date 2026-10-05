import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// The dashboard route imported the preloader hook (store-backed) and HomeScreen
// (Supabase graph). Mock both so the route's own behavior is under test — the
// landing container must not be rendered here.
const finishPreloader = vi.fn();
vi.mock('../hooks/usePreloader.js', () => ({
    usePreloader: () => ({ finishPreloader }),
}));
vi.mock('../components/homescreen/HomeScreen.jsx', () => ({
    default: () => React.createElement('div', { 'data-testid': 'home-screen-stub' }, 'home'),
}));
const landingSpy = vi.fn();
vi.mock('../components/homescreen/HomeLandingContainer.jsx', () => ({
    default: () => { landingSpy(); return React.createElement('div', { 'data-testid': 'landing-container-stub' }, 'landing'); },
}));

import HomeRoute from './HomeRoute.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('HomeRoute', () => {
    let container;
    let root;

    beforeEach(() => {
        finishPreloader.mockClear();
        landingSpy.mockClear();
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
        act(() => { root.render(React.createElement(HomeRoute)); });
    };

    it('renders HomeScreen and not the landing container', () => {
        render();
        expect(container.querySelector('[data-testid="home-screen-stub"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="landing-container-stub"]')).toBeNull();
        expect(landingSpy).not.toHaveBeenCalled();
    });

    it('finishes the preloader exactly once on mount', () => {
        render();
        expect(finishPreloader).toHaveBeenCalledTimes(1);
    });
});
