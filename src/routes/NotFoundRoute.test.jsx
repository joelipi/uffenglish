import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Strings from '../data/strings.js';
import { appStore } from '../modules/store/store.js';

const finishPreloader = vi.fn();
vi.mock('../hooks/usePreloader.js', () => ({
    usePreloader: () => ({ finishPreloader }),
}));

import NotFoundRoute from './NotFoundRoute.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('NotFoundRoute', () => {
    let container;
    let root;
    let previousGuestLanguage;

    beforeEach(() => {
        finishPreloader.mockClear();
        previousGuestLanguage = appStore.getState().guestNativeLanguage;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        appStore.setState({ guestNativeLanguage: previousGuestLanguage });
    });

    const render = (lang = 'en') => {
        appStore.setState({ guestNativeLanguage: lang });
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, { initialEntries: ['/nonsense'] },
                    React.createElement(NotFoundRoute)),
            );
        });
    };

    it('finishes the preloader exactly once on mount', () => {
        render();
        expect(finishPreloader).toHaveBeenCalledTimes(1);
    });

    it('links to the course list and the homepage', () => {
        render();
        const courses = container.querySelector('[data-testid="not-found-courses-link"]');
        const home = container.querySelector('[data-testid="not-found-home-link"]');
        expect(courses).not.toBeNull();
        expect(courses.getAttribute('href')).toBe('/courses');
        expect(home).not.toBeNull();
        expect(home.getAttribute('href')).toBe('/');
    });

    it('renders the English copy by default', () => {
        render();
        expect(container.textContent).toContain('Page not found');
        expect(container.textContent).toContain("We couldn't find that page.");
        expect(container.textContent).toContain('Browse courses');
        expect(container.textContent).toContain('Go home');
    });

    it('renders Hindi copy (not English) when the guest language is hi', () => {
        render('hi');
        expect(container.textContent).toContain(Strings.get('not_found_heading', 'hi'));
        expect(container.textContent).toContain(Strings.get('not_found_body', 'hi'));
        expect(container.textContent).toContain(Strings.get('not_found_courses', 'hi'));
        expect(container.textContent).toContain(Strings.get('not_found_home', 'hi'));
        expect(container.textContent).not.toContain('Page not found');
        expect(container.textContent).toMatch(/[\u0900-\u097F]/); // Devanagari
    });
});
